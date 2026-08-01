const mongoose = require('mongoose');

const insuranceConsentSchema = new mongoose.Schema(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Patient reference is required'],
      index: true,
    },
    insurance: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Insurance',
      required: [true, 'Insurance reference is required'],
      index: true,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'expired', 'revoked'],
      default: 'pending',
      index: true,
    },
    purpose: {
      type: String,
      required: [true, 'Purpose for requesting access is required'],
      trim: true,
    },
    permissions: {
      type: [String],
      enum: ['medicalHistory', 'allergies', 'prescriptions', 'reports', 'bloodGroup'],
      default: ['medicalHistory', 'allergies', 'prescriptions', 'reports', 'bloodGroup'],
    },
    requestedAt: {
      type: Date,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // Default 30 days
    },
    respondedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// Compound index to quickly look up patient-insurance consent relationships
insuranceConsentSchema.index({ patient: 1, insurance: 1 }, { unique: false });

module.exports = mongoose.model('InsuranceConsent', insuranceConsentSchema);
