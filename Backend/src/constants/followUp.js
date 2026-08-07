/**
 * Follow-up obligation constants — the single source of truth shared by the
 * FollowUpObligation model, the extractor, validators and the scheduler.
 *
 * WHY THIS EXISTS
 * ───────────────
 * A MedicalRecord is a *fact* ("a CT was performed, here is what it showed").
 * A FollowUpObligation is a *promise that comes due* ("…and someone must
 * re-image this nodule in 6 months"). Facts need storage; promises need an
 * owner, a clock and an escalation path. Nothing in the existing schema could
 * represent the second kind, which is precisely why these recommendations get
 * lost between institutions.
 */

/**
 * Lifecycle. Only these transitions are legal (enforced in the model's
 * `canTransitionTo` and again in the service layer):
 *
 *   pending_confirm ─► open ─► scheduled ─► completed
 *          │            │         │
 *          │            ├─────────┴──► overdue ──► scheduled | completed
 *          └────────────┴────────────► dismissed   (terminal, reason required)
 *
 * `pending_confirm` exists because a low-confidence extraction must never
 * silently become a clinical obligation. The patient confirms it first.
 */
const FOLLOWUP_STATUSES = Object.freeze([
  'pending_confirm',
  'open',
  'scheduled',
  'completed',
  'overdue',
  'dismissed',
]);

/** Statuses that still represent an unmet obligation (the "open loop" set). */
const ACTIVE_STATUSES = Object.freeze(['open', 'scheduled', 'overdue']);

/** Statuses no clock should ever touch again. */
const TERMINAL_STATUSES = Object.freeze(['completed', 'dismissed']);

/** Legal state transitions, keyed by current status. */
const ALLOWED_TRANSITIONS = Object.freeze({
  pending_confirm: Object.freeze(['open', 'dismissed']),
  open: Object.freeze(['scheduled', 'completed', 'overdue', 'dismissed']),
  scheduled: Object.freeze(['completed', 'overdue', 'dismissed']),
  overdue: Object.freeze(['scheduled', 'completed', 'dismissed']),
  completed: Object.freeze([]),
  dismissed: Object.freeze([]),
});

/**
 * Clinical urgency. Drives the escalation ladder and the colour of the
 * hospital-side banner. Deliberately coarse — this is a routing signal, not
 * a triage score, and we should not pretend to more precision than a regex
 * over a report's prose can justify.
 */
const FOLLOWUP_SEVERITY = Object.freeze(['routine', 'urgent', 'critical']);

/**
 * What kind of action is owed. Kept separate from RECORD_TYPES because a
 * follow-up is not a record type — it is an action that will *produce* a
 * record later, and that produced record is what closes the loop.
 */
const FOLLOWUP_CATEGORIES = Object.freeze([
  'imaging',       // repeat CT / MRI / ultrasound / X-ray
  'lab',           // repeat bloodwork, biopsy, culture
  'consult',       // referral to a specialist
  'procedure',     // endoscopy, biopsy, intervention
  'medication',    // titrate / review / stop a drug
  'other',
]);

/**
 * Which MedicalRecord types can satisfy which obligation category. Used by
 * the auto-close matcher: an obligation is only ever closed by a record of a
 * plausible type, so an unrelated prescription can never silently satisfy a
 * pending cancer-surveillance scan.
 */
const CATEGORY_CLOSING_RECORD_TYPES = Object.freeze({
  imaging: Object.freeze(['lab_report', 'diagnosis', 'visit']),
  lab: Object.freeze(['lab_report', 'diagnosis']),
  consult: Object.freeze(['visit', 'diagnosis']),
  procedure: Object.freeze(['visit', 'diagnosis', 'lab_report']),
  medication: Object.freeze(['prescription', 'visit']),
  other: Object.freeze(['visit', 'diagnosis', 'lab_report', 'prescription']),
});

/**
 * Escalation ladder, in days relative to `dueAt` (negative = before due).
 * The scheduler fires each tier at most once — `notifications[]` on the
 * document is the idempotency ledger, so a restarted or double-running
 * worker cannot spam a patient.
 *
 * `providerVisible` is the crucial one: once an obligation is past due, it
 * stops being a patient reminder and becomes a clinical safety net that any
 * treating provider sees on the chart.
 */
const ESCALATION_TIERS = Object.freeze([
  Object.freeze({ key: 'T-30', offsetDays: -30, channel: 'email', label: 'Due in 30 days' }),
  Object.freeze({ key: 'T-7', offsetDays: -7, channel: 'email', label: 'Due in 7 days' }),
  Object.freeze({ key: 'T-0', offsetDays: 0, channel: 'email', label: 'Due today' }),
  Object.freeze({ key: 'T+1', offsetDays: 1, channel: 'email', label: 'Overdue', providerVisible: true }),
  Object.freeze({ key: 'T+30', offsetDays: 30, channel: 'email', label: 'Overdue by a month', providerVisible: true }),
]);

/**
 * Urgent and critical findings compress the ladder — a 30-day-out nudge is
 * meaningless for something due in a week.
 */
const SEVERITY_ESCALATION_OVERRIDE = Object.freeze({
  critical: Object.freeze(['T-7', 'T-0', 'T+1', 'T+30']),
  urgent: Object.freeze(['T-7', 'T-0', 'T+1', 'T+30']),
  routine: Object.freeze(['T-30', 'T-7', 'T-0', 'T+1', 'T+30']),
});

/**
 * Extraction confidence gate.
 *  ≥ AUTO_OPEN            → becomes a live obligation immediately
 *  ≥ MIN_SUGGEST (< above) → surfaced to the patient as "did your doctor mean this?"
 *  <  MIN_SUGGEST          → discarded, never shown
 *
 * Both failure modes are harmful and they are NOT symmetric: inventing an
 * obligation erodes trust in every other alert (alarm fatigue is how safety
 * systems die), while dropping one is the exact failure we set out to fix.
 * Hence: never silently discard anything plausible, but never silently
 * *assert* anything uncertain either. The middle band goes to the patient.
 */
const CONFIDENCE = Object.freeze({
  AUTO_OPEN: 0.8,
  MIN_SUGGEST: 0.45,
});

/** Hard ceilings — defensive bounds against absurd or hostile extractions. */
const LIMITS = Object.freeze({
  MAX_DUE_DAYS: 365 * 5,        // a 20-year "follow-up" is a parse error, not a plan
  MIN_DUE_DAYS: 0,
  MAX_PER_RECORD: 10,           // one report yielding 40 obligations means the regex misfired
  MAX_TEXT_CHARS: 100_000,      // extractor input ceiling (DoS guard)
  MAX_OPEN_PER_PATIENT: 200,    // storage-exhaustion guard
  AUTOCLOSE_WINDOW_DAYS: 120,   // a scan this far either side of dueAt may close it
});

module.exports = {
  FOLLOWUP_STATUSES,
  ACTIVE_STATUSES,
  TERMINAL_STATUSES,
  ALLOWED_TRANSITIONS,
  FOLLOWUP_SEVERITY,
  FOLLOWUP_CATEGORIES,
  CATEGORY_CLOSING_RECORD_TYPES,
  ESCALATION_TIERS,
  SEVERITY_ESCALATION_OVERRIDE,
  CONFIDENCE,
  LIMITS,
};
