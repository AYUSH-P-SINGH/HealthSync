const mongoose = require('mongoose');
const crypto = require('crypto');
const { CONSENT_SCOPES } = require('../constants/recordTypes');

/**
 * ConsentGrant — a time-bound, scope-limited access grant a patient issues
 * to a hospital (ABDM/DPDP-style granular consent).
 *
 * Lifecycle:
 *   issued  -> patient generated a code/QR; no hospital attached yet
 *   claimed -> a hospital redeemed the code; scoped access is live
 *   revoked -> the patient revoked it early
 *   (expiry is computed from expiresAt — documents are kept for audit)
 *
 * Only a SHA-256 hash of the access code is stored; the plaintext code is
 * shown to the patient exactly once, at creation.
 */
const consentGrantSchema = new mongoose.Schema(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    // Set when a hospital claims the code
    hospital: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Hospital',
      default: null,
      index: true,
    },
    codeHash: {
      type: String,
      required: true,
      unique: true,
      select: false,
    },
    // Which record types the hospital may read ('all' = every type)
    scopes: {
      type: [{ type: String, enum: CONSENT_SCOPES }],
      required: true,
      validate: [(v) => v.length > 0, 'At least one scope is required'],
    },
    purpose: { type: String, trim: true, maxlength: 300, default: null },
    durationHours: { type: Number, required: true, min: 1, max: 168 },
    expiresAt: { type: Date, required: true, index: true },
    status: {
      type: String,
      enum: ['issued', 'claimed', 'revoked'],
      default: 'issued',
      index: true,
    },
    claimedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },

    // Usage audit
    accessCount: { type: Number, default: 0 },
    lastAccessedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

/** Hash an access code (normalized: uppercase, dashes stripped). */
consentGrantSchema.statics.hashCode = function (code) {
  const normalized = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return crypto.createHash('sha256').update(normalized).digest('hex');
};

/** Generate a readable 8-char code (no ambiguous chars), e.g. "K7DM-P3XW". */
consentGrantSchema.statics.generateCode = function () {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I, L, O, 0, 1
  let raw = '';
  for (let i = 0; i < 8; i += 1) {
    raw += alphabet[crypto.randomInt(alphabet.length)];
  }
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
};

/** True if the grant is past its expiry time. */
consentGrantSchema.methods.isExpired = function () {
  return this.expiresAt.getTime() <= Date.now();
};

/** Status with expiry applied — what callers should display/enforce. */
consentGrantSchema.methods.effectiveStatus = function () {
  if (this.status === 'revoked') return 'revoked';
  if (this.isExpired()) return 'expired';
  return this.status; // issued | claimed
};

consentGrantSchema.methods.toJSON = function () {
  const obj = this.toObject({ virtuals: true });
  delete obj.__v;
  delete obj.codeHash;
  obj.effectiveStatus = this.effectiveStatus();
  return obj;
};

module.exports = mongoose.model('ConsentGrant', consentGrantSchema);
