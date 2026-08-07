const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    action: {
      type: String,
      required: true,
      enum: [
        'REGISTER',
        'LOGIN',
        'LOGIN_FAILED',
        'LOGOUT',
        'LOGOUT_ALL',
        'TOKEN_REFRESH',
        'EMAIL_VERIFIED',
        'PASSWORD_CHANGED',
        'PASSWORD_RESET_REQUESTED',
        'PASSWORD_RESET_COMPLETED',
        'ACCOUNT_LOCKED',
        'ACCOUNT_UNLOCKED',
        'PROFILE_UPDATED',
        'PROFILE_PICTURE_UPLOADED',
        'PROFILE_PICTURE_DELETED',
        // Hospital <-> Patient linking (consent-based)
        'PATIENT_LOOKUP',
        'PATIENT_LINK_REQUESTED',
        'PATIENT_LINK_APPROVED',
        'PATIENT_LINK_REJECTED',
        'PATIENT_LINK_REVOKED',
        'PATIENT_DISCHARGED',
        // Insurance & Claims (consent-based)
        'INSURANCE_ACCESS_REQUESTED',
        'INSURANCE_CONSENT_APPROVED',
        'INSURANCE_CONSENT_REJECTED',
        'INSURANCE_CONSENT_REVOKED',
        'INSURANCE_VIEWED_RECORDS',
        'INSURANCE_POLICY_ISSUED',
        'CLAIM_SUBMITTED',
        'CLAIM_STATUS_UPDATED',

        // Medical records
        'RECORD_CREATED',
        'RECORD_UPDATED',
        'RECORD_DELETED',
        // Time-bound consent grants (OTP/QR scoped access)
        'CONSENT_ISSUED',
        'CONSENT_CLAIMED',
        'CONSENT_REVOKED',
        'CONSENT_RECORDS_ACCESSED',
        // Health advisories
        'ADVISORY_PUBLISHED',
        'ADVISORY_UPDATED',
        'ADVISORY_DELETED',

        // Follow-up obligations (clinical loop closure)
        // Every transition is logged because an unmet follow-up is exactly
        // the kind of thing that gets litigated years later — "who knew what,
        // and when" must be answerable from the record, not reconstructed.
        'FOLLOWUP_EXTRACTED',        // scan produced candidate obligations
        'FOLLOWUP_CREATED',
        'FOLLOWUP_CONFIRMED',        // patient promoted pending_confirm -> open
        'FOLLOWUP_SCHEDULED',
        'FOLLOWUP_COMPLETED',
        'FOLLOWUP_AUTO_CLOSED',      // satisfied by a matching new record
        'FOLLOWUP_DISMISSED',        // reason is mandatory; actor is recorded
        'FOLLOWUP_OVERDUE',          // system escalation
        'FOLLOWUP_NOTIFIED',
        'FOLLOWUP_VIEWED_BY_PROVIDER',
        'FOLLOWUP_SCAN_UPLOADED',
      ],
      index: true,
    },
    success: {
      type: Boolean,
      default: true,
    },
    ip: {
      type: String,
      default: null,
    },
    browser: {
      type: String,
      default: null,
    },
    device: {
      type: String,
      default: null,
    },
    location: {
      type: String,
      default: 'Unknown',
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: { createdAt: 'timestamp', updatedAt: false }, // Use 'timestamp' for createdAt as specified in the roadmap
  }
);

// Compound index for querying by user + action
auditLogSchema.index({ userId: 1, action: 1 });
// Index for time-based queries
auditLogSchema.index({ timestamp: 1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
