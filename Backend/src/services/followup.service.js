/**
 * Follow-up obligation service — the clinical loop-closure engine.
 *
 * Responsibilities:
 *   • turn report text into tracked obligations (via the extractor)
 *   • enforce the lifecycle state machine on every transition
 *   • auto-close obligations when a satisfying record arrives
 *   • surface overdue obligations to any treating provider under consent
 *
 * SECURITY POSTURE
 * Every read and write here is scoped by an ownership predicate baked into
 * the query itself (`{ _id, patient }`), never by a post-hoc `if` on a
 * document fetched by id alone. That shape makes IDOR structurally hard
 * rather than merely absent — you cannot forget the check because there is
 * no code path that fetches without it.
 */
const mongoose = require('mongoose');
const FollowUpObligation = require('../models/FollowUpObligation');
const MedicalRecord = require('../models/MedicalRecord');
const ConsentGrant = require('../models/ConsentGrant');
const HospitalPatient = require('../models/HospitalPatient');
const User = require('../models/User');
const { extractFollowUps } = require('./extractors');
const auditService = require('./audit.service');
const emailService = require('./email.service');
const { emitToUser } = require('../socket');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const {
  CONFIDENCE,
  LIMITS,
  ACTIVE_STATUSES,
  CATEGORY_CLOSING_RECORD_TYPES,
} = require('../constants/followUp');

// ─── Helpers ─────────────────────────────────────────────

const asObjectId = (id) => new mongoose.Types.ObjectId(String(id));

/**
 * Assemble the text an extractor should read from a record. Titles carry
 * recommendations surprisingly often ("CT chest — repeat in 6 months"), so
 * they are included rather than assumed to be labels.
 */
const textFromRecord = (record) =>
  [record.title, record.condition, record.description]
    .filter(Boolean)
    .join('. ')
    .slice(0, LIMITS.MAX_TEXT_CHARS);

/**
 * Fetch an obligation the given patient actually owns, or throw 404.
 * Deliberately returns 404 (not 403) for someone else's obligation — a 403
 * would confirm the id exists, which leaks the shape of other patients' data
 * to anyone willing to enumerate.
 */
const ownedByPatient = async (patientId, followUpId) => {
  const followUp = await FollowUpObligation.findOne({
    _id: followUpId,
    patient: patientId,
  });
  if (!followUp) throw ApiError.notFound('Follow-up not found.');
  return followUp;
};

/** Apply a guarded status transition, or throw a helpful 400. */
const transition = (followUp, next) => {
  if (!followUp.canTransitionTo(next)) {
    throw ApiError.badRequest(
      `Cannot move a follow-up from "${followUp.status}" to "${next}".`
    );
  }
  followUp.status = next;
};

// ─── Creation ────────────────────────────────────────────

/**
 * Persist extractor candidates as obligations.
 *
 * Confidence decides the entry state, never whether we keep the candidate:
 *   ≥ AUTO_OPEN  → 'open'            (live obligation, clock running)
 *   otherwise    → 'pending_confirm' (patient is asked first)
 *
 * Duplicates collapse on the unique (patient, dedupeKey) index, so
 * re-scanning the same report is idempotent instead of additive.
 */
const persistCandidates = async ({
  patientId,
  candidates,
  sourceRecord = null,
  sourceHospital = null,
  actorId,
  actorRole,
  ip,
  userAgent,
}) => {
  if (!candidates.length) return { created: [], duplicates: 0 };

  // Storage-exhaustion guard: a patient with 200 open loops has a broken
  // extractor, not a broken care plan.
  const openCount = await FollowUpObligation.countDocuments({
    patient: patientId,
    status: { $in: ACTIVE_STATUSES },
  });
  if (openCount >= LIMITS.MAX_OPEN_PER_PATIENT) {
    throw ApiError.badRequest(
      'You already have the maximum number of tracked follow-ups. Please resolve some before adding more.'
    );
  }

  const created = [];
  let duplicates = 0;

  for (const candidate of candidates.slice(0, LIMITS.MAX_PER_RECORD)) {
    const dedupeKey = FollowUpObligation.buildDedupeKey({
      patient: patientId,
      sourceRecord,
      action: candidate.action,
      dueAt: candidate.dueAt,
    });

    try {
      const doc = await FollowUpObligation.create({
        patient: patientId,
        sourceRecord,
        sourceHospital,
        finding: candidate.finding,
        action: candidate.action,
        category: candidate.category,
        severity: candidate.severity,
        sourceText: candidate.sourceText,
        dueAt: candidate.dueAt,
        anchorDate: candidate.anchorDate,
        confidence: candidate.confidence,
        extractedBy: candidate.extractedBy,
        dedupeKey,
        status:
          candidate.confidence >= CONFIDENCE.AUTO_OPEN ? 'open' : 'pending_confirm',
        lastActorRole: actorRole === 'hospital' ? 'hospital' : 'system',
        lastActorId: actorId || null,
      });
      created.push(doc);
    } catch (err) {
      // 11000 = duplicate key: this obligation already exists. That is the
      // dedupe index doing its job, not an error worth surfacing.
      if (err.code === 11000) {
        duplicates += 1;
        continue;
      }
      throw err;
    }
  }

  if (created.length) {
    auditService.logAuthEvent({
      userId: actorId,
      action: 'FOLLOWUP_CREATED',
      ip,
      userAgent,
      success: true,
      metadata: {
        patientId: String(patientId),
        count: created.length,
        duplicates,
        sourceRecord: sourceRecord ? String(sourceRecord) : null,
        autoOpened: created.filter((c) => c.status === 'open').length,
      },
    });

    emitToUser(patientId, 'followup:new', {
      count: created.length,
      needsConfirmation: created.filter((c) => c.status === 'pending_confirm').length,
    });

    logger.info('Follow-up obligations created', {
      patientId: String(patientId),
      count: created.length,
      duplicates,
    });
  }

  return { created, duplicates };
};

/**
 * Scan arbitrary report text and create obligations from it.
 * Used by the manual "Scan report" flow on both dashboards.
 */
const scanText = async ({
  patientId,
  text,
  anchorDate = new Date(),
  sourceRecord = null,
  sourceHospital = null,
  actorId,
  actorRole,
  ip,
  userAgent,
  dryRun = false,
}) => {
  const { candidates, engine, stats } = await extractFollowUps(text, { anchorDate });

  auditService.logAuthEvent({
    userId: actorId,
    action: 'FOLLOWUP_EXTRACTED',
    ip,
    userAgent,
    success: true,
    metadata: { patientId: String(patientId), engine, found: candidates.length, stats, dryRun },
  });

  // Preview mode: show the patient what we found before anything is stored.
  if (dryRun) {
    return {
      candidates,
      engine,
      created: [],
      duplicates: 0,
      message:
        candidates.length === 0
          ? 'No follow-up recommendations were found in this report.'
          : `Found ${candidates.length} possible follow-up${candidates.length > 1 ? 's' : ''}. Review before saving.`,
    };
  }

  const { created, duplicates } = await persistCandidates({
    patientId,
    candidates,
    sourceRecord,
    sourceHospital,
    actorId,
    actorRole,
    ip,
    userAgent,
  });

  const needsConfirm = created.filter((c) => c.status === 'pending_confirm').length;

  return {
    candidates,
    engine,
    created: created.map((c) => c.toJSON()),
    duplicates,
    message:
      created.length === 0
        ? duplicates > 0
          ? 'These follow-ups are already being tracked.'
          : 'No follow-up recommendations were found in this report.'
        : `${created.length} follow-up${created.length > 1 ? 's' : ''} now tracked${
            needsConfirm ? ` — ${needsConfirm} need your confirmation.` : '.'
          }`,
  };
};

/**
 * Hook called after any MedicalRecord is created. Does two things:
 *   1. extracts new obligations from the record's text
 *   2. checks whether this record SATISFIES an existing obligation
 *
 * Never throws into the caller: a failure here must not prevent a doctor
 * from filing a record. A missed extraction is recoverable via manual scan;
 * a blocked record write is not recoverable at all.
 */
const onRecordCreated = async ({ record, actorId, actorRole, ip, userAgent }) => {
  try {
    const text = textFromRecord(record);

    const [scan, closed] = await Promise.all([
      text.length >= 12
        ? scanText({
            patientId: record.patient,
            text,
            anchorDate: record.recordDate || record.createdAt || new Date(),
            sourceRecord: record._id,
            sourceHospital: record.hospital || null,
            actorId,
            actorRole,
            ip,
            userAgent,
          })
        : Promise.resolve({ created: [], candidates: [] }),
      autoCloseMatching({ record, ip, userAgent }),
    ]);

    return { extracted: scan.created?.length || 0, autoClosed: closed.length };
  } catch (err) {
    logger.error('Follow-up processing failed for record (record itself is unaffected)', {
      recordId: String(record?._id),
      error: err.message,
    });
    return { extracted: 0, autoClosed: 0 };
  }
};

// ─── Auto-close ──────────────────────────────────────────

/**
 * Close obligations that this new record plausibly satisfies.
 *
 * Matching is deliberately conservative — three independent conditions must
 * all hold:
 *   1. record type is clinically capable of satisfying the category
 *   2. the record falls inside the obligation's time window
 *   3. the record's text shares a distinctive term with the obligation
 *
 * A false auto-close is the worst outcome this feature can produce: it turns
 * an open loop green while the patient still has an unmet obligation, which
 * is strictly more dangerous than never having tracked it. When conditions
 * are only partially met we leave it open rather than guess.
 */
const autoCloseMatching = async ({ record, ip, userAgent }) => {
  const openOnes = await FollowUpObligation.find({
    patient: record.patient,
    status: { $in: ACTIVE_STATUSES },
  }).limit(LIMITS.MAX_OPEN_PER_PATIENT);

  if (!openOnes.length) return [];

  const recordText = textFromRecord(record).toLowerCase();
  const recordTime = new Date(record.recordDate || record.createdAt).getTime();
  const windowMs = LIMITS.AUTOCLOSE_WINDOW_DAYS * 86_400_000;

  const closed = [];

  for (const followUp of openOnes) {
    // 1. Could a record of this type ever satisfy this obligation?
    const closers = CATEGORY_CLOSING_RECORD_TYPES[followUp.category] || [];
    if (!closers.includes(record.type)) continue;

    // 2. Is it near enough to the due date to be the intended action?
    if (Math.abs(recordTime - followUp.dueAt.getTime()) > windowMs) continue;

    // 3. Does the record actually mention the thing that was owed?
    //    Stop-words removed so "follow" or "test" alone can never match.
    const actionTerms = followUp.action
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4 && !['repeat', 'follow', 'test', 'scan', 'review', 'tests'].includes(w));

    const findingTerms = followUp.finding
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 5);

    const matches =
      actionTerms.some((t) => recordText.includes(t)) ||
      findingTerms.some((t) => recordText.includes(t));

    if (!matches) continue;

    followUp.status = 'completed';
    followUp.completedAt = new Date();
    followUp.closedByRecord = record._id;
    followUp.autoClosed = true;
    followUp.providerVisible = false;
    followUp.lastActorRole = 'system';
    await followUp.save();

    closed.push(followUp);

    auditService.logAuthEvent({
      userId: record.patient,
      action: 'FOLLOWUP_AUTO_CLOSED',
      ip,
      userAgent,
      success: true,
      metadata: {
        followUpId: String(followUp._id),
        closedByRecord: String(record._id),
        action: followUp.action,
      },
    });
  }

  if (closed.length) {
    emitToUser(record.patient, 'followup:closed', { count: closed.length });
    logger.info('Follow-ups auto-closed by new record', {
      recordId: String(record._id),
      count: closed.length,
    });
  }

  return closed;
};

// ─── Patient-side reads ──────────────────────────────────

/**
 * List a patient's obligations, newest obligations first by urgency.
 * `status` may be a single status or the pseudo-filter 'active'.
 */
const listForPatient = async (patientId, { status, includeResolved = false } = {}) => {
  const query = { patient: patientId };

  if (status === 'active') query.status = { $in: ACTIVE_STATUSES };
  else if (status) query.status = status;
  else if (!includeResolved) {
    query.status = { $in: [...ACTIVE_STATUSES, 'pending_confirm'] };
  }

  const followUps = await FollowUpObligation.find(query)
    .sort({ dueAt: 1 })
    .limit(300)
    .populate('sourceHospital', 'name hospitalType city')
    .populate('sourceRecord', 'title type recordDate');

  const now = Date.now();
  const counts = {
    pendingConfirm: 0,
    open: 0,
    scheduled: 0,
    overdue: 0,
    dueSoon: 0, // active and due within 30 days
  };

  for (const f of followUps) {
    if (f.status === 'pending_confirm') counts.pendingConfirm += 1;
    if (f.status === 'open') counts.open += 1;
    if (f.status === 'scheduled') counts.scheduled += 1;
    if (f.status === 'overdue' || (ACTIVE_STATUSES.includes(f.status) && f.dueAt.getTime() < now)) {
      counts.overdue += 1;
    } else if (
      ACTIVE_STATUSES.includes(f.status) &&
      f.dueAt.getTime() - now < 30 * 86_400_000
    ) {
      counts.dueSoon += 1;
    }
  }

  return { followUps: followUps.map((f) => f.toJSON()), counts, total: followUps.length };
};

/** Compact counts for the dashboard summary card. */
const countsForPatient = async (patientId) => {
  const now = new Date();
  const [openLoops, overdue, needsConfirm] = await Promise.all([
    FollowUpObligation.countDocuments({ patient: patientId, status: { $in: ACTIVE_STATUSES } }),
    FollowUpObligation.countDocuments({
      patient: patientId,
      status: { $in: ACTIVE_STATUSES },
      dueAt: { $lt: now },
    }),
    FollowUpObligation.countDocuments({ patient: patientId, status: 'pending_confirm' }),
  ]);
  return { openLoops, overdue, needsConfirm };
};

// ─── Patient-side writes ─────────────────────────────────

/** Patient confirms a low-confidence extraction: pending_confirm -> open. */
const confirm = async (patientId, followUpId, { dueAt } = {}, ip, userAgent) => {
  const followUp = await ownedByPatient(patientId, followUpId);
  transition(followUp, 'open');

  // The patient may correct a mis-parsed date at confirmation time — they
  // are holding the report and we are not.
  if (dueAt) {
    const parsed = new Date(dueAt);
    const days = (parsed.getTime() - Date.now()) / 86_400_000;
    if (Number.isNaN(parsed.getTime()) || days > LIMITS.MAX_DUE_DAYS) {
      throw ApiError.badRequest('Please provide a valid follow-up date.');
    }
    followUp.dueAt = parsed;
  }

  followUp.lastActorRole = 'patient';
  followUp.lastActorId = asObjectId(patientId);
  await followUp.save();

  auditService.logAuthEvent({
    userId: patientId,
    action: 'FOLLOWUP_CONFIRMED',
    ip,
    userAgent,
    success: true,
    metadata: { followUpId: String(followUp._id), dueAt: followUp.dueAt },
  });

  return { followUp: followUp.toJSON(), message: 'Follow-up confirmed and now being tracked.' };
};

/** Patient (or provider) marks the appointment as booked. */
const markScheduled = async ({ patientId, followUpId, scheduledFor, actorRole, actorId, ip, userAgent }) => {
  const followUp = await ownedByPatient(patientId, followUpId);
  transition(followUp, 'scheduled');

  if (scheduledFor) {
    const parsed = new Date(scheduledFor);
    if (Number.isNaN(parsed.getTime())) {
      throw ApiError.badRequest('Please provide a valid appointment date.');
    }
    followUp.scheduledFor = parsed;
  }

  followUp.lastActorRole = actorRole;
  followUp.lastActorId = actorId ? asObjectId(actorId) : null;
  await followUp.save();

  auditService.logAuthEvent({
    userId: actorId,
    action: 'FOLLOWUP_SCHEDULED',
    ip,
    userAgent,
    success: true,
    metadata: { followUpId: String(followUp._id), patientId: String(patientId), actorRole },
  });

  emitToUser(patientId, 'followup:updated', { followUpId: String(followUp._id) });

  return { followUp: followUp.toJSON(), message: 'Marked as scheduled.' };
};

/** Mark the obligation as met. */
const markCompleted = async ({ patientId, followUpId, actorRole, actorId, ip, userAgent }) => {
  const followUp = await ownedByPatient(patientId, followUpId);
  transition(followUp, 'completed');

  followUp.completedAt = new Date();
  followUp.providerVisible = false;
  followUp.lastActorRole = actorRole;
  followUp.lastActorId = actorId ? asObjectId(actorId) : null;
  await followUp.save();

  auditService.logAuthEvent({
    userId: actorId,
    action: 'FOLLOWUP_COMPLETED',
    ip,
    userAgent,
    success: true,
    metadata: { followUpId: String(followUp._id), patientId: String(patientId), actorRole },
  });

  emitToUser(patientId, 'followup:updated', { followUpId: String(followUp._id) });

  return { followUp: followUp.toJSON(), message: 'Follow-up marked as completed.' };
};

/**
 * Dismiss an obligation. A reason is mandatory and the actor is recorded.
 *
 * Dismissal is the one action that makes a safety alert disappear, so it is
 * the one that most needs to be attributable. Requiring a written reason
 * also imposes a small deliberate friction: it is easy to click a warning
 * away, and slightly harder to write down why you did.
 */
const dismiss = async ({ patientId, followUpId, reason, actorRole, actorId, ip, userAgent }) => {
  const trimmed = String(reason || '').trim();
  if (trimmed.length < 5) {
    throw ApiError.badRequest('Please give a reason for dismissing this follow-up (at least 5 characters).');
  }

  const followUp = await ownedByPatient(patientId, followUpId);
  transition(followUp, 'dismissed');

  followUp.dismissReason = trimmed.slice(0, 500);
  followUp.dismissedAt = new Date();
  followUp.providerVisible = false;
  followUp.lastActorRole = actorRole;
  followUp.lastActorId = actorId ? asObjectId(actorId) : null;
  await followUp.save();

  auditService.logAuthEvent({
    userId: actorId,
    action: 'FOLLOWUP_DISMISSED',
    ip,
    userAgent,
    success: true,
    metadata: {
      followUpId: String(followUp._id),
      patientId: String(patientId),
      actorRole,
      reason: followUp.dismissReason,
      wasOverdue: followUp.dueAt.getTime() < Date.now(),
    },
  });

  emitToUser(patientId, 'followup:updated', { followUpId: String(followUp._id) });

  return { followUp: followUp.toJSON(), message: 'Follow-up dismissed.' };
};

// ─── Hospital-side (the safety net) ──────────────────────

/**
 * Resolve which patient a hospital may currently see, and under what scope.
 *
 * Two legitimate paths exist and both are honoured here:
 *   • an ACTIVE HospitalPatient link (the hospital treats this patient)
 *   • a claimed, unexpired, unrevoked ConsentGrant (scoped QR/OTP access)
 *
 * Anything else throws. This is the function that stops a hospital from
 * reading follow-ups for a patient who merely once walked past the building.
 */
const resolveHospitalAccess = async (hospitalId, { linkId, consentId }) => {
  if (linkId) {
    const link = await HospitalPatient.findOne({ _id: linkId, hospital: hospitalId });
    if (!link) throw ApiError.notFound('Patient link not found.');
    if (link.status !== 'active') {
      throw ApiError.forbidden('This patient link is not active.');
    }
    return { patientId: link.patient, via: 'link' };
  }

  if (consentId) {
    const consent = await ConsentGrant.findOne({ _id: consentId, hospital: hospitalId });
    if (!consent) throw ApiError.notFound('Consent grant not found.');
    if (consent.status === 'revoked') {
      throw ApiError.forbidden('The patient has revoked this access grant.');
    }
    if (consent.isExpired()) {
      throw ApiError.forbidden('This access grant has expired.');
    }
    return { patientId: consent.patient, via: 'consent', consent };
  }

  throw ApiError.badRequest('A patient link or consent grant is required.');
};

/**
 * The demo moment, and the clinically important one: a provider opening this
 * patient's chart sees unmet follow-ups issued by ANY hospital.
 *
 * Two deliberate narrowings:
 *  • only `providerVisible` obligations appear. Until an obligation is past
 *    due it is the patient's business, not every clinic's — surfacing a
 *    six-months-out reminder to an unrelated dermatologist is disclosure
 *    without a clinical purpose.
 *  • the projection is `toProviderJSON()`, which omits notification history
 *    and extractor internals.
 */
const listForProvider = async (hospitalId, { linkId, consentId }, ip, userAgent) => {
  const access = await resolveHospitalAccess(hospitalId, { linkId, consentId });

  const followUps = await FollowUpObligation.find({
    patient: access.patientId,
    status: { $in: ACTIVE_STATUSES },
    providerVisible: true,
  })
    .sort({ dueAt: 1 })
    .limit(50)
    .populate('sourceHospital', 'name city');

  if (followUps.length) {
    auditService.logAuthEvent({
      userId: hospitalId,
      action: 'FOLLOWUP_VIEWED_BY_PROVIDER',
      ip,
      userAgent,
      success: true,
      metadata: {
        patientId: String(access.patientId),
        via: access.via,
        count: followUps.length,
      },
    });

    // The patient can see, in real time, that a provider saw their open loop.
    emitToUser(access.patientId, 'followup:viewed', { count: followUps.length });
  }

  return {
    followUps: followUps.map((f) => {
      const json = f.toProviderJSON();
      json.sourceHospital = f.sourceHospital
        ? { name: f.sourceHospital.name, city: f.sourceHospital.city || null }
        : null;
      return json;
    }),
    total: followUps.length,
  };
};

/**
 * Provider-side action on someone else's obligation. Access is re-derived
 * from the link/consent on every call — never trusted from the request body.
 */
const providerAct = async ({ hospitalId, linkId, consentId, followUpId, action, reason, scheduledFor, ip, userAgent }) => {
  const access = await resolveHospitalAccess(hospitalId, { linkId, consentId });

  /**
   * A provider may only act on obligations it is actually entitled to SEE.
   *
   * Without this, a hospital holding a valid link could act on an obligation
   * still in `pending_confirm` — one the patient has not yet acknowledged and
   * which is deliberately never surfaced provider-side. Authorization to view
   * and authorization to mutate must be derived from the same predicate,
   * otherwise the narrower read scope is decorative.
   */
  const visible = await FollowUpObligation.findOne({
    _id: followUpId,
    patient: access.patientId,
    status: { $in: ACTIVE_STATUSES },
    providerVisible: true,
  }).select('_id');

  if (!visible) throw ApiError.notFound('Follow-up not found.');

  const shared = {
    patientId: access.patientId,
    followUpId,
    actorRole: 'hospital',
    actorId: hospitalId,
    ip,
    userAgent,
  };

  if (action === 'schedule') return markScheduled({ ...shared, scheduledFor });
  if (action === 'complete') return markCompleted(shared);
  if (action === 'dismiss') return dismiss({ ...shared, reason });

  throw ApiError.badRequest('Action must be one of: schedule, complete, dismiss.');
};

// ─── Notification bodies ─────────────────────────────────

/**
 * Patient-facing copy. Informative, not alarming: the goal is that someone
 * books an appointment, and frightening people about a nodule they cannot
 * interpret produces avoidance, not action.
 */
const buildNotification = (followUp, tier, hospitalName) => {
  const due = followUp.dueAt.toLocaleDateString('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
  const from = hospitalName ? ` from ${hospitalName}` : '';
  const overdue = tier.offsetDays > 0;

  const subject = overdue
    ? `Follow-up still open: ${followUp.action}`
    : `Reminder: ${followUp.action} recommended by ${due}`;

  const text = overdue
    ? `Your report${from} recommended ${followUp.action.toLowerCase()} by ${due}, and it is not yet marked as done.\n\nFinding noted: ${followUp.finding}\n\nIf you have already had this done, mark it complete in HealthSync so we stop reminding you. If not, this is a good time to book it.`
    : `Your report${from} recommended ${followUp.action.toLowerCase()} by ${due}.\n\nFinding noted: ${followUp.finding}\n\nYou can mark it as scheduled or completed in HealthSync.`;

  return { subject, text };
};

/**
 * Fire one escalation tier for one obligation. Idempotent: the notification
 * ledger is checked first and written after, so a double-running scheduler
 * cannot double-notify.
 */
const notifyTier = async (followUp, tier) => {
  if (followUp.hasNotified(tier.key)) return false;

  const patient = await User.findById(followUp.patient).select('email fullName');
  if (!patient?.email) return false;

  await followUp.populate('sourceHospital', 'name');
  const { subject, text } = buildNotification(followUp, tier, followUp.sourceHospital?.name);

  const sent = await emailService.sendEmail({
    to: patient.email,
    subject,
    text,
    html: `<p>${text.replace(/\n/g, '<br/>')}</p>`,
  });

  followUp.notifications.push({ tier: tier.key, channel: tier.channel, success: Boolean(sent) });

  emitToUser(followUp.patient, 'followup:reminder', {
    followUpId: String(followUp._id),
    tier: tier.key,
    action: followUp.action,
    dueAt: followUp.dueAt,
  });

  auditService.logAuthEvent({
    userId: followUp.patient,
    action: 'FOLLOWUP_NOTIFIED',
    success: Boolean(sent),
    metadata: { followUpId: String(followUp._id), tier: tier.key },
  });

  return true;
};

module.exports = {
  scanText,
  persistCandidates,
  onRecordCreated,
  autoCloseMatching,
  listForPatient,
  countsForPatient,
  confirm,
  markScheduled,
  markCompleted,
  dismiss,
  listForProvider,
  providerAct,
  resolveHospitalAccess,
  notifyTier,
  textFromRecord,
};
