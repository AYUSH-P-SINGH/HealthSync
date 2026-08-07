/**
 * Rule-based follow-up recommendation extractor.
 *
 * Reads free-text report prose and returns the future actions it promises.
 * Deterministic, offline, zero external dependencies — the same input always
 * yields the same output, which matters because this drives a clinical
 * reminder. A non-deterministic safety net is not a safety net.
 *
 * PIPELINE
 *   1. normalize      — unwrap PDF line breaks, collapse whitespace
 *   2. segment        — split into sentences (abbreviation-aware)
 *   3. gate           — keep sentences carrying a recommendation trigger
 *   4. reject         — drop negated / already-satisfied / hypothetical ones
 *   5. interpret      — parse timeframe, action category, severity, finding
 *   6. score          — confidence from converging evidence
 *   7. dedupe         — collapse restatements of the same recommendation
 *
 * ON REGEX SAFETY
 * Every pattern here uses bounded quantifiers over disjoint character
 * classes. There is no nested unbounded quantifier anywhere, so none of these
 * can backtrack catastrophically on hostile input — which matters because
 * this runs on text a user uploaded. Input length is capped separately by the
 * caller via LIMITS.MAX_TEXT_CHARS.
 */
const { LIMITS, CONFIDENCE } = require('../../constants/followUp');

// ─── 1. Normalization ────────────────────────────────────

/**
 * PDF text extraction hard-wraps mid-sentence. Rejoin those breaks without
 * destroying real paragraph boundaries, so "recommend interval CT in 6\nmonths"
 * is still one parseable sentence.
 */
const normalize = (raw) => {
  let text = String(raw || '').slice(0, LIMITS.MAX_TEXT_CHARS);

  text = text
    .replace(/\r\n?/g, '\n')
    // de-hyphenate words split across a line break: "recom-\nmend" -> "recommend"
    .replace(/([a-z])-\n([a-z])/gi, '$1$2')
    // a newline that isn't a paragraph break is a soft wrap
    .replace(/([^.\n])\n(?![\n\s*•\-–])/g, '$1 ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n');

  return text.trim();
};

// ─── 2. Sentence segmentation ────────────────────────────

/** Abbreviations whose trailing period must not end a sentence. */
const ABBREVIATIONS = [
  'dr', 'mr', 'mrs', 'ms', 'prof', 'approx', 'vs', 'etc', 'e.g', 'i.e',
  'no', 'fig', 'dept', 'ref', 'wt', 'ht', 'hx', 'dx', 'tx', 'rx', 'f/u',
];

const segmentSentences = (text) => {
  // Protect decimals ("6.5 mm") and abbreviations from the splitter
  let guarded = text.replace(/(\d)\.(\d)/g, '$1<DEC>$2');
  for (const abbr of ABBREVIATIONS) {
    const rx = new RegExp(`\\b${abbr.replace(/[.]/g, '\\.')}\\.`, 'gi');
    guarded = guarded.replace(rx, (m) => m.replace('.', '<ABBR>'));
  }

  return guarded
    .split(/(?<=[.!?;])\s+|\n+/)
    .map((s) => s.replace(/<DEC>/g, '.').replace(/<ABBR>/g, '.').trim())
    .filter((s) => s.length >= 8 && s.length <= 1200)
    .slice(0, 600); // bound the work regardless of document size
};

// ─── 3. Recommendation triggers ──────────────────────────

/**
 * Split into strong and weak because they carry different evidential weight.
 * "Recommend" is an instruction; "consider" is a radiologist hedging, and the
 * confidence score should reflect that difference honestly.
 */
const STRONG_TRIGGERS = /\b(recommend(?:ed|s|ation)?|advis(?:e|ed|able)|should\s+(?:be|have|undergo)|needs?\s+(?:to\s+be\s+)?|requires?|is\s+indicated|are\s+indicated|warrant(?:ed|s)?)\b/i;

const WEAK_TRIGGERS = /\b(consider(?:ed)?|suggest(?:ed|s)?|may\s+benefit|could\s+be\s+(?:considered|obtained)|option(?:al)?)\b/i;

/** Actions that imply a future obligation even without an explicit verb. */
const ACTION_TRIGGERS = /\b(follow[\s-]?up|followup|f\/u|repeat|re-?evaluat(?:e|ion)|re-?assess(?:ment)?|surveillance|monitor(?:ing)?|interval\s+(?:imaging|scan|study)|serial\s+(?:imaging|scans?)|re-?imag(?:e|ing)|re-?check|recall)\b/i;

// ─── 4. Rejection filters ────────────────────────────────

/**
 * Sentences that mention follow-up only to rule it out, or to report one that
 * already happened. Missing these is how you generate false obligations, and
 * false obligations are how alert fatigue kills a safety system.
 */
const NEGATION = /\b(no\s+(?:further|additional|specific|routine)?\s*(?:follow[\s-]?up|imaging|action|investigation)|not\s+(?:recommend|indicated|required|necessary|warranted)|does\s+not\s+(?:require|warrant|need)|without\s+(?:the\s+)?need|unremarkable|no\s+evidence\s+of|nil\s+significant|discharge[d]?\s+without)\b/i;

/** Already-completed action described in the past tense. */
const ALREADY_DONE = /\b(?:was|were|has\s+been|have\s+been|is)\s+(?:already\s+)?(?:performed|obtained|done|completed|carried\s+out|undertaken|reviewed)\b/i;

/** Boilerplate that mentions follow-up generically without owing anything. */
const BOILERPLATE = /\b(?:results?\s+(?:were\s+)?discussed|thank\s+you\s+for|this\s+report\s+was|electronically\s+signed|dictated\s+by|please\s+contact\s+(?:us|the)|standard\s+(?:of\s+)?care|as\s+per\s+protocol\s+only)\b/i;

// ─── 5a. Timeframe parsing ───────────────────────────────

const UNIT_DAYS = { day: 1, week: 7, month: 30, year: 365 };

/**
 * Ranges ("3 to 6 months", "3-6 months") resolve to the EARLIER bound.
 * When a clinician gives a window, the safe reminder fires at the start of
 * that window, not the end — a nudge you can act on beats one that arrives
 * after the opportunity closed.
 */
const TIMEFRAME_PATTERNS = [
  // "in 3 to 6 months", "in 3-6 months", "within 2–4 weeks"
  {
    rx: /\b(?:in|within|after|at|over)\s+(\d{1,2})\s*(?:-|–|to|or)\s*(\d{1,2})\s*(day|week|month|year)s?\b/i,
    parse: (m) => ({ value: Math.min(Number(m[1]), Number(m[2])), unit: m[3].toLowerCase(), explicit: true, ranged: true }),
  },
  // "in 6 months", "within 2 weeks", "after 1 year", "at 12 months"
  {
    rx: /\b(?:in|within|after|at|by)\s+(\d{1,3})\s*(day|week|month|year)s?\b/i,
    parse: (m) => ({ value: Number(m[1]), unit: m[2].toLowerCase(), explicit: true }),
  },
  // "6-month follow-up", "3 month interval", "12-month surveillance"
  {
    rx: /\b(\d{1,3})[\s-]*(day|week|month|year)s?\s+(?:follow[\s-]?up|interval|surveillance|repeat|review|scan|imaging)\b/i,
    parse: (m) => ({ value: Number(m[1]), unit: m[2].toLowerCase(), explicit: true }),
  },
  // "follow-up in six months" (spelled-out numerals)
  {
    rx: /\b(?:in|within|after|at)\s+(one|two|three|four|five|six|seven|eight|nine|ten|twelve|eighteen|twenty[\s-]four)\s+(day|week|month|year)s?\b/i,
    parse: (m) => {
      const words = {
        one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
        eight: 8, nine: 9, ten: 10, twelve: 12, eighteen: 18,
      };
      const key = m[1].toLowerCase().replace(/[\s-]/g, '');
      return { value: words[key] ?? (key === 'twentyfour' ? 24 : 6), unit: m[2].toLowerCase(), explicit: true };
    },
  },
  // "annually", "every 6 months", "6 monthly"
  {
    rx: /\b(?:annual(?:ly)?|yearly|every\s+year)\b/i,
    parse: () => ({ value: 1, unit: 'year', explicit: true, recurring: true }),
  },
  {
    rx: /\b(?:every|each)\s+(\d{1,2})\s*(day|week|month|year)s?\b/i,
    parse: (m) => ({ value: Number(m[1]), unit: m[2].toLowerCase(), explicit: true, recurring: true }),
  },
  // Qualitative urgency — no number, but a clear intent
  {
    rx: /\b(?:immediate(?:ly)?|urgent(?:ly)?|emergent(?:ly)?|stat|as\s+soon\s+as\s+possible|asap|without\s+delay)\b/i,
    parse: () => ({ value: 3, unit: 'day', explicit: false, qualitative: 'critical' }),
  },
  {
    rx: /\b(?:short[\s-]interval|promptly?|expedite[d]?|soon|near[\s-]term|shortly)\b/i,
    parse: () => ({ value: 2, unit: 'week', explicit: false, qualitative: 'urgent' }),
  },
];

/**
 * Returns null when NO timeframe is stated, and `{ outOfRange: true }` when
 * one is stated but implausible ("in 600 months" — almost always an OCR or
 * parse artifact).
 *
 * The distinction matters. Collapsing both to null would make the extractor
 * quietly substitute a default 90-day window for a date the report actually
 * stated, i.e. invent a due date. Keeping them separate lets us do the honest
 * thing: keep the recommendation (it is real), refuse to guess its deadline,
 * and route it to the patient to supply the correct date.
 */
const parseTimeframe = (sentence) => {
  for (const { rx, parse } of TIMEFRAME_PATTERNS) {
    const m = sentence.match(rx);
    if (m) {
      const tf = parse(m);
      const days = tf.value * (UNIT_DAYS[tf.unit] || 30);
      if (days < LIMITS.MIN_DUE_DAYS || days > LIMITS.MAX_DUE_DAYS) {
        return { outOfRange: true, matched: m[0], rejectedDays: days };
      }
      return { ...tf, days, matched: m[0] };
    }
  }
  return null;
};

// ─── 5b. Action category ─────────────────────────────────

/**
 * NOTE ON THE MISSING TRAILING \b
 * These alternations are word PREFIXES ("biops" for biopsy/biopsies,
 * "mammogra" for mammogram/mammography). A trailing \b after the group would
 * require a boundary immediately after the prefix and silently fail on every
 * real word — so word boundaries are attached to individual alternatives that
 * need them (`ct\b`, `psa\b`) rather than to the group as a whole.
 */
const CATEGORY_PATTERNS = [
  {
    category: 'procedure',
    rx: /\b(biops|endoscop|colonoscop|bronchoscop|gastroscop|egd\b|cystoscop|aspirat|fna\b|excision|resect|catheteri|angioplast|drainage)/i,
  },
  {
    category: 'imaging',
    rx: /\b(ct\b|cect|hrct|mri\b|ultrasound|ultrasonograph|usg\b|sonograph|doppler|x-?ray|radiograph|mammogra|pet[\s-]?ct|dexa|bone\s+scan|echocardiogra|echo\b|angiogra|fluoroscop|scan\b|imaging)/i,
  },
  {
    category: 'lab',
    rx: /\b(blood\s+(?:test|work|count)|cbc\b|hba1c|haemoglobin|hemoglobin|creatinine|urea\b|lft\b|kft\b|rft\b|tsh\b|lipid|urine|culture|serolog|psa\b|electrolyte|panel\b|assay|titre|titer|inr\b|d-?dimer|troponin|biomarker|(?:renal|liver|thyroid|pulmonary)\s+function|function\s+tests?)/i,
  },
  {
    category: 'consult',
    rx: /\b(refer(?:ral|red)?|consult(?:ation)?|specialist|second\s+opinion|oncolog|cardiolog|pulmonolog|neurolog|nephrolog|gastroenterolog|endocrinolog|dermatolog|surgeon|surgical\s+opinion|clinic\s+review|opd\s+review)/i,
  },
  {
    category: 'medication',
    rx: /\b(titrat|adjust\s+(?:the\s+)?dos|dose\s+adjust|taper|discontinu|review\s+(?:the\s+)?medicat|initiate\s+therap|drug\s+level|medication\s+review)/i,
  },
];

const detectCategory = (sentence) => {
  for (const { category, rx } of CATEGORY_PATTERNS) {
    const m = sentence.match(rx);
    if (m) return { category, evidence: m[0] };
  }
  return { category: 'other', evidence: null };
};

/**
 * Build a short human-readable action label ("interval chest CT") rather than
 * echoing the whole sentence back at the patient.
 */
const MODALITY_LABELS = [
  [/\bhrct\b/i, 'HRCT scan'],
  [/\bcect\b/i, 'contrast CT scan'],
  [/\bct\b/i, 'CT scan'],
  [/\bmri\b/i, 'MRI scan'],
  [/\b(?:ultrasound|usg|sonograph)/i, 'ultrasound'],
  [/\bmammogra/i, 'mammogram'],
  [/\bpet[\s-]?ct\b/i, 'PET-CT scan'],
  [/\bx-?ray|radiograph/i, 'X-ray'],
  [/\becho(?:cardiogra)?\b/i, 'echocardiogram'],
  [/\bcolonoscop/i, 'colonoscopy'],
  [/\bendoscop/i, 'endoscopy'],
  [/\bbiops/i, 'biopsy'],
  [/\bhba1c/i, 'HbA1c test'],
  [/\bcbc\b/i, 'complete blood count'],
  [/\bpsa\b/i, 'PSA test'],
  [/\bcreatinine\b/i, 'creatinine test'],
  [/\btsh\b/i, 'thyroid function test'],
  [/\blipid/i, 'lipid profile'],
  [/\bculture\b/i, 'culture'],
  [/\burine\b/i, 'urine test'],
  [/\b(?:renal|kidney)\s+function/i, 'renal function test'],
  [/\bliver\s+function/i, 'liver function test'],
];

const sentenceCase = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const buildActionLabel = (sentence, category) => {
  for (const [rx, label] of MODALITY_LABELS) {
    if (rx.test(sentence)) {
      return /\b(?:repeat|interval|serial|re-?imag)/i.test(sentence)
        ? `Repeat ${label}`
        : sentenceCase(label);
    }
  }
  const fallback = {
    imaging: 'Follow-up imaging',
    lab: 'Follow-up blood test',
    consult: 'Specialist consultation',
    procedure: 'Follow-up procedure',
    medication: 'Medication review',
    other: 'Follow-up review',
  };
  return fallback[category];
};

// ─── 5c. Finding extraction ──────────────────────────────

const LESION_TERMS = /\b(nodule|lesion|mass|cyst|opacity|opacit|calcification|plaque|stenosis|aneurysm|polyp|fracture|effusion|thickening|hypodensity|hyperdensity|granuloma|adenopathy|lymphadenopathy|tumou?r|growth|infiltrate|consolidation|dilat|hernia|stone|calculus|fibroid|abnormalit)\w*/i;

const MEASUREMENT = /\b\d{1,3}(?:\.\d{1,2})?\s*(?:mm|cm)\b/i;

const ANATOMY = /\b(lung|pulmonary|hepatic|liver|renal|kidney|thyroid|breast|brain|cerebral|cardiac|adrenal|pancrea\w*|splenic|spleen|ovarian|uterine|prostate|colon|gastric|bowel|lymph|bone|spinal|vertebral|aortic|carotid|right\s+lower\s+lobe|left\s+lower\s+lobe|rll|lll|rul|lul)\b/i;

/**
 * An out-of-range lab value is a "finding" too, it just does not look like a
 * lesion. Without this, every lab follow-up falls through to the raw-clause
 * fallback and scores as weak evidence — which would push clear instructions
 * like "advise repeat HbA1c in 3 months" into needless patient confirmation.
 * The bounded lazy gap keeps this linear-time.
 */
// The negative lookahead is load-bearing: without it, "repeat HbA1c in 3
// months" captures the interval "3" as if it were the lab value.
const LAB_VALUE = /\b(hba1c|creatinine|h(?:a)?emoglobin|tsh|psa|ldl|hdl|cholesterol|glucose|potassium|sodium|bilirubin|alt|ast|inr|wbc|platelet|urea|ferritin|vitamin\s?d)\b[^.]{0,40}?(\d{1,4}(?:\.\d{1,2})?)(?!\s*(?:day|week|month|year))/i;

const ABNORMAL_MARKER = /\b(elevated|raised|high|low|reduced|deranged|abnormal|borderline|out\s+of\s+range|positive)\b/i;

/**
 * Prefer the finding stated in the recommendation sentence itself; fall back
 * to the nearest preceding sentence that describes something measurable.
 * Radiology prose almost always states the finding first and the plan second.
 */
const extractFinding = (sentence, previousSentences) => {
  const candidates = [sentence, ...previousSentences.slice(-2).reverse()];

  // Pass 1 — a lesion described anywhere in the local context
  for (const cand of candidates) {
    const lesion = cand.match(LESION_TERMS);
    if (!lesion) continue;

    const measure = cand.match(MEASUREMENT);
    const anatomy = cand.match(ANATOMY);

    const parts = [];
    if (measure) parts.push(measure[0].replace(/\s+/g, ' '));
    if (anatomy) parts.push(anatomy[0].toLowerCase());
    parts.push(lesion[0].toLowerCase());

    return {
      text: parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 500),
      hasMeasurement: Boolean(measure),
      hasLesionTerm: true,
      hasLabValue: false,
    };
  }

  // Pass 2 — an abnormal lab value. Sentences that also carry an abnormality
  // marker win, because "HbA1c is elevated at 8.1" is the finding while
  // "repeat HbA1c" is merely the plan restating the analyte.
  const labMatches = candidates
    .map((cand) => ({ cand, lab: cand.match(LAB_VALUE) }))
    .filter((x) => x.lab);

  const best =
    labMatches.find((x) => ABNORMAL_MARKER.test(x.cand)) || labMatches[0];

  if (best) {
    const { cand, lab } = best;
    const abnormal = cand.match(ABNORMAL_MARKER);
    const raw = lab[1].toLowerCase();
    // Conventional clinical casing — "HBA1C" reads like shouting on a chart.
    const CANONICAL = {
      hba1c: 'HbA1c', tsh: 'TSH', psa: 'PSA', ldl: 'LDL', hdl: 'HDL',
      inr: 'INR', alt: 'ALT', ast: 'AST', wbc: 'WBC',
    };
    const analyte = CANONICAL[raw] || raw;

    return {
      text: `${analyte}${abnormal ? ` ${abnormal[0].toLowerCase()}` : ''} at ${lab[2]}`.slice(0, 500),
      hasMeasurement: false,
      hasLesionTerm: false,
      hasLabValue: true,
    };
  }

  // Pass 3 — nothing structured. Keep a trimmed clause so the obligation is
  // still legible, and let the confidence score reflect the weaker evidence.
  const clause = sentence.replace(/\s+/g, ' ').trim();
  return {
    text: clause.slice(0, 300),
    hasMeasurement: false,
    hasLesionTerm: false,
    hasLabValue: false,
  };
};

// ─── 5d. Severity ────────────────────────────────────────

const CRITICAL_MARKERS = /\b(malignan|carcinom|cancer|metasta|highly\s+suspicious|critical|life[\s-]threatening|emergent|immediate(?:ly)?|stat\b)\b/i;
const URGENT_MARKERS = /\b(suspicious|concerning|worrisome|significant|prompt|expedite|short[\s-]interval|atypical|indeterminate)\b/i;

const detectSeverity = (sentence, timeframe, contextText) => {
  if (timeframe?.qualitative) return timeframe.qualitative;

  const haystack = `${sentence} ${contextText}`;
  if (CRITICAL_MARKERS.test(haystack)) return 'critical';
  if (URGENT_MARKERS.test(haystack)) return 'urgent';

  // A very short interval is itself an urgency signal, whatever the wording.
  if (timeframe && timeframe.days <= 14) return 'urgent';
  if (timeframe && timeframe.days <= 45) return 'routine';
  return 'routine';
};

// ─── 6. Confidence scoring ───────────────────────────────

/** Radiologist hedges that make an obligation conditional, not scheduled. */
const HEDGES = /\b(if\s+clinically\s+(?:indicated|warranted|appropriate)|as\s+clinically\s+(?:indicated|warranted)|at\s+the\s+discretion|if\s+symptoms\s+(?:persist|worsen)|may\s+be\s+considered|optional)\b/i;

/**
 * Confidence is the sum of independent converging signals. Each term answers
 * a different question, so agreement between them is real evidence rather
 * than the same observation counted twice.
 *
 * Calibrated so a textbook recommendation ("Recommend interval follow-up
 * chest CT in 6 months" alongside a measured nodule) lands near 0.90, and the
 * ceiling is 0.95. The extractor never returns 1.0: a regex over prose has
 * not earned certainty, and a score that reads as certain would invite
 * downstream code to stop treating this as an estimate.
 */
const scoreConfidence = ({ sentence, strongTrigger, actionTrigger, timeframe, categoryEvidence, finding }) => {
  let score = 0.22; // a gated sentence already cleared several filters

  if (strongTrigger) score += 0.18;        // an instruction, not a musing
  else score += 0.04;                      // weak trigger only

  if (actionTrigger) score += 0.07;        // names a repeatable action

  if (timeframe?.explicit) score += 0.22;  // a real, parseable deadline
  else if (timeframe) score += 0.08;       // qualitative urgency only

  if (categoryEvidence) score += 0.10;     // a recognized modality/test

  // Evidence that a concrete abnormality is being tracked. Imaging findings
  // and lab findings present differently; both count, neither double-counts.
  if (finding.hasMeasurement) score += 0.06;
  if (finding.hasLesionTerm) score += 0.05;
  if (finding.hasLabValue) score += 0.08;

  if (HEDGES.test(sentence)) score -= 0.20; // conditional, needs a human
  if (!timeframe) score -= 0.12;            // no deadline = we guessed one
  if (sentence.length > 400) score -= 0.05; // long sentence, weaker attribution

  score = Math.max(0, Math.min(0.95, score));

  /**
   * Floor: an unhedged instruction naming a recognized action ("Recommend
   * cardiology referral for the newly noted murmur") is credible even with
   * no stated deadline. Scored purely additively it falls below the suggest
   * floor and vanishes — and a silently dropped referral is the exact
   * failure this feature exists to prevent. Floor it just into the suggest
   * band so the patient is asked, never so high that it self-asserts.
   */
  if (strongTrigger && categoryEvidence && !HEDGES.test(sentence)) {
    score = Math.max(score, CONFIDENCE.MIN_SUGGEST + 0.02);
  }

  return Number(score.toFixed(3));
};

// ─── 7. Default windows when no timeframe is stated ──────

const DEFAULT_DAYS_BY_SEVERITY = { critical: 7, urgent: 30, routine: 90 };

// ─── Main entry point ────────────────────────────────────

/**
 * Extract follow-up obligations from report text.
 *
 * @param {string} rawText   Report prose (description, impression, findings).
 * @param {object} options
 * @param {Date}   options.anchorDate  Date intervals are measured from.
 * @returns {{ candidates: Array, stats: object }}
 */
const extract = (rawText, { anchorDate = new Date() } = {}) => {
  const text = normalize(rawText);
  const stats = { sentences: 0, gated: 0, rejected: 0, produced: 0 };

  if (!text || text.length < 12) return { candidates: [], stats };

  const sentences = segmentSentences(text);
  stats.sentences = sentences.length;

  const candidates = [];
  const seen = new Set();

  for (let i = 0; i < sentences.length; i += 1) {
    const sentence = sentences[i];

    const strongTrigger = STRONG_TRIGGERS.test(sentence);
    const weakTrigger = WEAK_TRIGGERS.test(sentence);
    const actionTrigger = ACTION_TRIGGERS.test(sentence);

    // Gate: needs some indication that a future action is being described
    if (!strongTrigger && !weakTrigger && !actionTrigger) continue;
    stats.gated += 1;

    // Reject: negated, already done, or pure boilerplate
    if (NEGATION.test(sentence) || ALREADY_DONE.test(sentence) || BOILERPLATE.test(sentence)) {
      stats.rejected += 1;
      continue;
    }

    // An action word with no verb and no timeframe is usually a section
    // heading ("FOLLOW-UP:") rather than a recommendation.
    const timeframe = parseTimeframe(sentence);
    if (!strongTrigger && !weakTrigger && !timeframe) {
      stats.rejected += 1;
      continue;
    }

    const { category, evidence: categoryEvidence } = detectCategory(sentence);
    const previous = sentences.slice(Math.max(0, i - 2), i);
    const finding = extractFinding(sentence, previous);

    // An out-of-range interval is not a usable deadline. Treat it as absent
    // for every downstream purpose, but remember that one WAS stated so the
    // candidate can be flagged for correction rather than quietly defaulted.
    const usableTimeframe = timeframe && !timeframe.outOfRange ? timeframe : null;
    const severity = detectSeverity(sentence, usableTimeframe, previous.join(' '));

    const days = usableTimeframe ? usableTimeframe.days : DEFAULT_DAYS_BY_SEVERITY[severity];
    const dueAt = new Date(new Date(anchorDate).getTime() + days * 86_400_000);

    let confidence = scoreConfidence({
      sentence,
      strongTrigger,
      actionTrigger,
      timeframe: usableTimeframe,
      categoryEvidence,
      finding,
    });

    /**
     * A stated-but-unparseable interval must never auto-open. We are holding
     * a date we know is wrong, so the patient has to supply the real one.
     */
    if (timeframe?.outOfRange) {
      confidence = Math.min(confidence, CONFIDENCE.AUTO_OPEN - 0.05);
    }

    // Below the suggest floor we discard rather than bother the patient.
    if (confidence < CONFIDENCE.MIN_SUGGEST) {
      stats.rejected += 1;
      continue;
    }

    const action = buildActionLabel(sentence, category);

    // Collapse restatements ("Impression" repeating "Recommendation")
    const dedupe = `${category}|${action.toLowerCase()}|${Math.round(days / 7)}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    candidates.push({
      finding: finding.text,
      action,
      category,
      severity,
      dueAt,
      anchorDate: new Date(anchorDate),
      sourceText: sentence.slice(0, 2000),
      confidence,
      timeframeText: timeframe?.matched || null,
      // True whenever WE picked the date rather than the report — the UI says
      // "no date stated, we estimated one" so the user knows to check it.
      inferredWindow: !usableTimeframe,
      unparseableTimeframe: Boolean(timeframe?.outOfRange),
      recurring: Boolean(usableTimeframe?.recurring),
      extractedBy: 'rules',
    });

    if (candidates.length >= LIMITS.MAX_PER_RECORD) break;
  }

  stats.produced = candidates.length;

  // Most clinically urgent first, then soonest due
  const order = { critical: 0, urgent: 1, routine: 2 };
  candidates.sort((a, b) => (order[a.severity] - order[b.severity]) || (a.dueAt - b.dueAt));

  return { candidates, stats };
};

module.exports = {
  extract,
  // exported for unit tests
  _internals: { normalize, segmentSentences, parseTimeframe, detectCategory, detectSeverity, extractFinding },
};
