const mongoose = require('mongoose');

/**
 * HealthAdvisory — a public-health alert published by HealthSync admins
 * (e.g. a disease outbreak in a region) with recommended precautions.
 * Patients see active advisories as a banner + in their Health tab;
 * when none are active the UI falls back to rotating healthcare tips.
 */
const healthAdvisorySchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    summary: { type: String, trim: true, maxlength: 2000, default: '' },
    severity: {
      type: String,
      enum: ['info', 'advisory', 'warning', 'critical'],
      default: 'advisory',
      index: true,
    },
    region: { type: String, trim: true, maxlength: 200, default: 'Nationwide' },
    precautions: {
      type: [{ type: String, trim: true, maxlength: 300 }],
      default: [],
    },
    isActive: { type: Boolean, default: true, index: true },
    // Optional automatic end date; null = active until deactivated
    expiresAt: { type: Date, default: null },
    publishedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
    },
    source: { type: String, trim: true, maxlength: 200, default: 'HealthSync Health Desk' },
  },
  { timestamps: true }
);

healthAdvisorySchema.index({ isActive: 1, severity: 1, createdAt: -1 });

healthAdvisorySchema.methods.toJSON = function () {
  const obj = this.toObject({ virtuals: true });
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model('HealthAdvisory', healthAdvisorySchema);
