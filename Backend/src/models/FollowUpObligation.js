/**
 * FollowUpObligation — a clinical promise that comes due.
 *
 * Created when a report recommends future action ("recommend interval CT in
 * 6 months") that no existing entity can hold: the MedicalRecord stores what
 * *happened*, not what must happen next. The ordering physician moves on, the
 * patient gets a PDF they cannot parse, and nobody owns the clock. Studies put
 * non-completion of recommended radiology follow-up as high as 70%.
 *
 * Design decisions worth knowing:
 *
 *  • The obligation belongs to the PATIENT, not the issuing hospital. That is
 *    the whole point — Hospital A creates it, the patient walks out, and the
 *    obligation must still be visible when they present at Hospital B months
 *    later. A hospital-owned row dies at the institutional boundary, which is
 *    exactly how the current failure happens.
 *
 *  • `sourceText` is the verbatim sentence the extractor matched. It is kept
 *    so a clinician can always audit *why* the system made a claim, and it is
 *    never editable. Provenance beats cleverness in anything safety-adjacent.
 *
 *  • Nothing here is a diagnosis. This model tracks an ADMINISTRATIVE promise.
 *    We deliberately do not infer, re-stage, or interpret.
 */
const mongoose = require('mongoose');
const {
  FOLLOWUP_STATUSES,
  FOLLOWUP_SEVERITY,
  FOLLOWUP_CATEGORIES,
  ALLOWED_TRANSITIONS,
  ACTIVE_STATUSES,
  TERMINAL_STATUSES,
} = require('../constants/followUp');

/**
 * Idempotency ledger for the escalation ladder. The scheduler writes one
 * entry per tier per obligation; a restarted or concurrently-running worker
 * checks this before sending, so a patient can never be notified twice for
 * the same tier.
 */
const notificationSchema = new mongoose.Schema(
  {
    tier: { type: String, required: true },     // 'T-30' | 'T-7' | 'T-0' | 'T+1' | 'T+30'
    channel: { type: String, required: true },  // 'email' | 'socket' | 'in_app'
    sentAt: { type: Date, default: Date.now },
    success: { type: Boolean, default: true },
  },
  { _id: false }
);

const followUpObligationSchema = new mongoose.Schema(
  {
    // ─── Ownership ─────────────────────────────────────
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    /** The record whose text produced this obligation. Immutable provenance. */
    sourceRecord: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MedicalRecord',
      default: null,
      index: true,
    },

    /** Hospital that issued the source report (null = patient self-reported). */
    sourceHospital: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Hospital',
      default: null,
      index: true,
    },

    // ─── Clinical content ──────────────────────────────
    /** What was found. e.g. "6 mm pulmonary nodule, right lower lobe" */
    finding: { type: String, required: true, trim: true, maxlength: 500 },

    /** What is owed. e.g. "interval chest CT" */
    action: { type: String, required: true, trim: true, maxlength: 300 },

    category: {
      type: String,
      enum: FOLLOWUP_CATEGORIES,
      default: 'other',
      index: true,
    },

    severity: {
      type: String,
      enum: FOLLOWUP_SEVERITY,
      default: 'routine',
      index: true,
    },

    /**
     * Verbatim sentence from the report. Never edited, never regenerated —
     * this is the audit trail that lets a clinician judge the extraction.
     */
    sourceText: { type: String, trim: true, maxlength: 2000, default: '' },

    // ─── The clock ─────────────────────────────────────
    dueAt: { type: Date, required: true, index: true },

    /** Anchor the interval was computed from (usually the record's date). */
    anchorDate: { type: Date, required: true },

    // ─── Lifecycle ─────────────────────────────────────
    status: {
      type: String,
      enum: FOLLOWUP_STATUSES,
      default: 'pending_confirm',
      index: true,
    },

    /** Required when status becomes 'dismissed' — no silent disappearances. */
    dismissReason: { type: String, trim: true, maxlength: 500, default: null },

    /**
     * Who last moved this forward. Recorded for accountability: a provider
     * dismissing a cancer-surveillance obligation is a consequential act and
     * must be attributable.
     */
    lastActorRole: {
      type: String,
      enum: ['patient', 'hospital', 'system', null],
      default: null,
    },
    lastActorId: { type: mongoose.Schema.Types.ObjectId, default: null },

    scheduledFor: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    dismissedAt: { type: Date, default: null },

    /** The record that satisfied this obligation (set by the auto-close matcher). */
    closedByRecord: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MedicalRecord',
      default: null,
    },

    /** True when auto-close matched it rather than a human confirming. */
    autoClosed: { type: Boolean, default: false },

    // ─── Extraction metadata ───────────────────────────
    confidence: { type: Number, min: 0, max: 1, default: 0 },

    /** Which engine produced this: 'rules' | 'llm:<model>' | 'manual'. */
    extractedBy: { type: String, default: 'rules', maxlength: 100 },

    /**
     * Deduplication key — SHA-256 over (patient + sourceRecord + normalized
     * action + dueAt bucket). Prevents a re-scanned or re-uploaded report from
     * producing duplicate obligations, which would be worse than useless:
     * duplicate alerts are how clinicians learn to ignore alerts.
     */
    dedupeKey: { type: String, required: true, index: true },

    // ─── Escalation bookkeeping ────────────────────────
    notifications: { type: [notificationSchema], default: [] },

    /** Set by the scheduler once past due — gates hospital-side visibility. */
    providerVisible: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

// ─── Indexes ─────────────────────────────────────────────
// Patient dashboard: "my open loops, soonest first"
followUpObligationSchema.index({ patient: 1, status: 1, dueAt: 1 });
// Scheduler sweep: "everything active and due"
followUpObligationSchema.index({ status: 1, dueAt: 1 });
// Hard dedupe guarantee at the storage layer, not just in application code
followUpObligationSchema.index({ patient: 1, dedupeKey: 1 }, { unique: true });

// ─── Instance helpers ────────────────────────────────────

/** Is this obligation still an unmet promise? */
followUpObligationSchema.methods.isActive = function () {
  return ACTIVE_STATUSES.includes(this.status);
};

followUpObligationSchema.methods.isTerminal = function () {
  return TERMINAL_STATUSES.includes(this.status);
};

/** Past due and not yet resolved. */
followUpObligationSchema.methods.isPastDue = function () {
  return this.isActive() && this.dueAt.getTime() < Date.now();
};

/**
 * Guard every status change through the declared state machine. Without this,
 * a stray PATCH could resurrect a completed obligation or skip confirmation
 * on a low-confidence extraction.
 */
followUpObligationSchema.methods.canTransitionTo = function (next) {
  const allowed = ALLOWED_TRANSITIONS[this.status] || [];
  return allowed.includes(next);
};

/** Has a given escalation tier already fired? (idempotency check) */
followUpObligationSchema.methods.hasNotified = function (tier) {
  return this.notifications.some((n) => n.tier === tier && n.success);
};

/** Whole days until due; negative once overdue. */
followUpObligationSchema.methods.daysUntilDue = function () {
  return Math.ceil((this.dueAt.getTime() - Date.now()) / 86_400_000);
};

/**
 * Build the stable dedupe key. Bucketing dueAt to the day means two
 * extractions of the same sentence that differ by a few hours still collapse
 * into one obligation.
 */
followUpObligationSchema.statics.buildDedupeKey = function ({
  patient,
  sourceRecord,
  action,
  dueAt,
}) {
  const crypto = require('crypto');
  const normalizedAction = String(action || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const dayBucket = new Date(dueAt).toISOString().slice(0, 10);
  return crypto
    .createHash('sha256')
    .update(`${patient}|${sourceRecord || 'none'}|${normalizedAction}|${dayBucket}`)
    .digest('hex');
};

/**
 * Projection safe to hand to a HOSPITAL under a consent grant.
 *
 * A treating clinician needs to know an obligation exists, what it is, and
 * how late it is. They do not need the patient's notification history, the
 * extractor's confidence score, or internal bookkeeping — none of that is
 * clinically actionable, and every extra field is avoidable disclosure. This
 * is minimum-necessary applied at the serialization boundary rather than
 * left to whatever the controller happens to spread into a response.
 */
followUpObligationSchema.methods.toProviderJSON = function () {
  return {
    _id: this._id,
    finding: this.finding,
    action: this.action,
    category: this.category,
    severity: this.severity,
    dueAt: this.dueAt,
    status: this.status,
    daysOverdue: Math.max(0, -this.daysUntilDue()),
    sourceHospital: this.sourceHospital,
    sourceText: this.sourceText,
    issuedOn: this.anchorDate,
  };
};

followUpObligationSchema.methods.toJSON = function () {
  const obj = this.toObject({ virtuals: true });
  delete obj.__v;
  delete obj.dedupeKey; // internal bookkeeping, never useful to a client
  return obj;
};

module.exports = mongoose.model('FollowUpObligation', followUpObligationSchema);
