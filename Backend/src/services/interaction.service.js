/**
 * Drug interaction + allergy checking service.
 *
 * When a prescription is created, the new medicines are checked against:
 *   1. The patient's recorded allergies            (local, critical)
 *   2. A curated table of well-known dangerous
 *      drug-drug interactions                      (local, works offline)
 *   3. openFDA drug labels — the official
 *      `drug_interactions` section of one drug is
 *      searched for mentions of the other drug     (network, best-effort)
 *
 * External lookups are best-effort: short timeout, failures are swallowed,
 * and the check NEVER blocks or fails prescription creation.
 */
const MedicalRecord = require('../models/MedicalRecord');
const User = require('../models/User');
const logger = require('../utils/logger');

const OPENFDA_TIMEOUT_MS = 4000;

/**
 * Curated, well-documented interaction pairs. Each side is a list of
 * generic-name keywords; a match on any keyword from BOTH sides fires.
 * Sources: standard clinical references (informational, not medical advice).
 */
const KNOWN_INTERACTIONS = [
  {
    a: ['warfarin'],
    b: ['aspirin', 'ibuprofen', 'naproxen', 'diclofenac', 'ketorolac'],
    severity: 'critical',
    note: 'Combining warfarin with NSAIDs/aspirin significantly increases bleeding risk.',
  },
  {
    a: ['warfarin'],
    b: ['metronidazole', 'fluconazole', 'ciprofloxacin'],
    severity: 'warning',
    note: 'This antimicrobial can potentiate warfarin and raise INR/bleeding risk.',
  },
  {
    a: ['sildenafil', 'tadalafil', 'vardenafil'],
    b: ['nitroglycerin', 'isosorbide', 'nitrate'],
    severity: 'critical',
    note: 'PDE5 inhibitors with nitrates can cause severe, dangerous hypotension.',
  },
  {
    a: ['methotrexate'],
    b: ['ibuprofen', 'naproxen', 'diclofenac', 'aspirin'],
    severity: 'critical',
    note: 'NSAIDs reduce methotrexate clearance and can cause serious toxicity.',
  },
  {
    a: ['lisinopril', 'enalapril', 'ramipril', 'losartan', 'telmisartan'],
    b: ['spironolactone', 'potassium', 'amiloride'],
    severity: 'warning',
    note: 'ACE inhibitors/ARBs with potassium-sparing agents risk hyperkalemia.',
  },
  {
    a: ['simvastatin', 'atorvastatin', 'lovastatin'],
    b: ['clarithromycin', 'erythromycin', 'itraconazole', 'ketoconazole'],
    severity: 'warning',
    note: 'CYP3A4 inhibitors raise statin levels — increased risk of myopathy/rhabdomyolysis.',
  },
  {
    a: ['tramadol'],
    b: ['sertraline', 'fluoxetine', 'paroxetine', 'escitalopram', 'citalopram', 'venlafaxine', 'duloxetine'],
    severity: 'warning',
    note: 'Tramadol with serotonergic antidepressants increases serotonin-syndrome and seizure risk.',
  },
  {
    a: ['clopidogrel'],
    b: ['omeprazole', 'esomeprazole'],
    severity: 'warning',
    note: 'These PPIs can reduce clopidogrel activation and its antiplatelet effect.',
  },
  {
    a: ['digoxin'],
    b: ['amiodarone', 'verapamil', 'clarithromycin'],
    severity: 'warning',
    note: 'This combination raises digoxin levels — monitor for digoxin toxicity.',
  },
  {
    a: ['metformin'],
    b: ['contrast', 'iodinated contrast'],
    severity: 'warning',
    note: 'Metformin around iodinated contrast increases lactic-acidosis risk.',
  },
  {
    a: ['levothyroxine'],
    b: ['calcium', 'iron', 'ferrous'],
    severity: 'info',
    note: 'Calcium/iron reduce levothyroxine absorption — separate doses by 4 hours.',
  },
  {
    a: ['linezolid'],
    b: ['sertraline', 'fluoxetine', 'paroxetine', 'escitalopram', 'venlafaxine'],
    severity: 'critical',
    note: 'Linezolid (an MAOI) with SSRIs/SNRIs risks serotonin syndrome.',
  },
  {
    a: ['ciprofloxacin', 'levofloxacin'],
    b: ['tizanidine'],
    severity: 'critical',
    note: 'Fluoroquinolones sharply raise tizanidine levels — severe hypotension/sedation.',
  },
  {
    a: ['amiodarone'],
    b: ['sotalol', 'moxifloxacin', 'ondansetron'],
    severity: 'warning',
    note: 'Additive QT prolongation — risk of torsades de pointes.',
  },
  {
    a: ['insulin', 'glimepiride', 'glipizide', 'gliclazide'],
    b: ['propranolol', 'atenolol', 'metoprolol'],
    severity: 'info',
    note: 'Beta-blockers can mask hypoglycemia symptoms in patients on insulin/sulfonylureas.',
  },
];

const normalize = (name) =>
  String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const matchesAny = (medName, keywords) => {
  const n = normalize(medName);
  return keywords.some((k) => n.includes(k));
};

/** Local curated-table check between one new medicine and one existing one. */
const checkPairLocally = (newMed, existingMed) => {
  for (const rule of KNOWN_INTERACTIONS) {
    const hit =
      (matchesAny(newMed, rule.a) && matchesAny(existingMed, rule.b)) ||
      (matchesAny(newMed, rule.b) && matchesAny(existingMed, rule.a));
    if (hit) {
      return {
        kind: 'interaction',
        severity: rule.severity,
        message: `Possible interaction: ${newMed} + ${existingMed}. ${rule.note}`,
        source: 'HealthSync',
      };
    }
  }
  return null;
};

/**
 * openFDA best-effort check: fetch the official label of `drugA` and see if
 * its `drug_interactions` section mentions `drugB` (or vice versa).
 */
const fetchLabelInteractionText = async (drug) => {
  if (typeof fetch !== 'function') return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENFDA_TIMEOUT_MS);
  try {
    const term = encodeURIComponent(`"${normalize(drug)}"`);
    const url = `https://api.fda.gov/drug/label.json?search=openfda.generic_name:${term}+openfda.brand_name:${term}&limit=1`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const json = await res.json();
    const sections = json?.results?.[0]?.drug_interactions;
    return Array.isArray(sections) ? normalize(sections.join(' ')) : null;
  } catch {
    return null; // network failure / timeout / not found — fail silently
  } finally {
    clearTimeout(timer);
  }
};

const checkPairViaOpenFda = async (newMed, existingMed, labelCache) => {
  const lookup = async (a, b) => {
    const key = normalize(a);
    if (!(key in labelCache)) {
      labelCache[key] = await fetchLabelInteractionText(a);
    }
    const text = labelCache[key];
    if (!text) return false;
    const other = normalize(b);
    // Require a reasonably specific token to avoid false positives
    return other.length >= 4 && text.includes(other);
  };

  if ((await lookup(newMed, existingMed)) || (await lookup(existingMed, newMed))) {
    return {
      kind: 'interaction',
      severity: 'warning',
      message: `openFDA: the official drug label mentions a potential interaction between ${newMed} and ${existingMed}. Review before co-prescribing.`,
      source: 'openFDA',
    };
  }
  return null;
};

/** All medicine names the patient is actively taking (active prescriptions). */
const getActiveMedicines = async (patientId, excludeRecordId = null) => {
  const query = {
    patient: patientId,
    type: 'prescription',
    isActivePrescription: true,
  };
  if (excludeRecordId) query._id = { $ne: excludeRecordId };

  const records = await MedicalRecord.find(query).select('medicines').lean();
  const names = [];
  for (const rec of records) {
    for (const med of rec.medicines || []) {
      if (med.name) names.push(med.name);
    }
  }
  return [...new Set(names.map((n) => n.trim()).filter(Boolean))];
};

/**
 * Run the full safety check for a set of newly prescribed medicines.
 * Returns an array of alert objects ({ kind, severity, message, source }).
 * Never throws.
 */
const checkPrescription = async (patientId, newMedicines, excludeRecordId = null) => {
  const alerts = [];
  const seen = new Set();
  const push = (alert) => {
    if (!alert) return;
    const key = `${alert.kind}:${alert.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      alerts.push(alert);
    }
  };

  try {
    const newNames = [...new Set((newMedicines || []).map((m) => m.name).filter(Boolean))];
    if (newNames.length === 0) return alerts;

    const [user, activeMeds] = await Promise.all([
      User.findById(patientId).select('allergies').lean(),
      getActiveMedicines(patientId, excludeRecordId),
    ]);

    // 1. Allergy check (critical)
    const allergies = (user?.allergies || []).map(normalize).filter(Boolean);
    for (const med of newNames) {
      const medNorm = normalize(med);
      for (const allergy of allergies) {
        if (medNorm.includes(allergy) || allergy.includes(medNorm)) {
          push({
            kind: 'allergy',
            severity: 'critical',
            message: `ALLERGY ALERT: patient has a recorded allergy matching "${med}". Do not administer without specialist review.`,
            source: 'HealthSync',
          });
        }
      }
    }

    // 2. Local curated interaction table (new vs active, and new vs new)
    const existingPlusNew = [...activeMeds];
    for (const newMed of newNames) {
      for (const existing of existingPlusNew) {
        if (normalize(newMed) !== normalize(existing)) {
          push(checkPairLocally(newMed, existing));
        }
      }
      existingPlusNew.push(newMed);
    }

    // Duplicate-therapy check: same medicine already active
    for (const newMed of newNames) {
      if (activeMeds.some((m) => normalize(m) === normalize(newMed))) {
        push({
          kind: 'info',
          severity: 'info',
          message: `${newMed} is already on the patient's active medication list — check for duplicate therapy.`,
          source: 'HealthSync',
        });
      }
    }

    // 3. openFDA label check (best-effort, capped to avoid slow requests)
    const labelCache = {};
    const pairs = [];
    for (const newMed of newNames) {
      for (const existing of activeMeds) {
        if (normalize(newMed) !== normalize(existing)) pairs.push([newMed, existing]);
      }
    }
    for (const [a, b] of pairs.slice(0, 6)) {
      // Skip pairs the local table already flagged
      const alreadyFlagged = alerts.some(
        (al) => al.kind === 'interaction' && al.message.includes(a) && al.message.includes(b)
      );
      if (!alreadyFlagged) {
        // eslint-disable-next-line no-await-in-loop
        push(await checkPairViaOpenFda(a, b, labelCache));
      }
    }
  } catch (error) {
    logger.warn('Prescription safety check failed (non-blocking)', { error: error.message });
  }

  // Sort: critical first
  const order = { critical: 0, warning: 1, info: 2 };
  alerts.sort((x, y) => (order[x.severity] ?? 3) - (order[y.severity] ?? 3));
  return alerts;
};

module.exports = { checkPrescription, getActiveMedicines };
