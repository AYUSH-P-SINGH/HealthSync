const mongoose = require('mongoose');

const disclosureSchema = new mongoose.Schema(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    insurance: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Insurance',
      required: true,
      index: true,
    },
    policy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Policy',
      required: true,
      index: true,
    },
    consentVersion: {
      type: String,
      default: 'v1.0',
    },
    recordHash: {
      type: String,
      required: [true, 'Cryptographic record hash (SHA-256) is required'],
      index: true,
    },
    snapshot: {
      type: Object,
      required: true,
    },
    signedByPatient: {
      type: Boolean,
      default: true,
    },
    signedByInsurance: {
      type: Boolean,
      default: true,
    },
    issuedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Disclosure', disclosureSchema);
