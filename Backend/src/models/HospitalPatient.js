const mongoose = require('mongoose');

/**
 * HospitalPatient — consent-based link between a Hospital and a patient (User).
 *
 * Lifecycle:
 *   pending    -> created by the hospital (after looking the patient up)
 *   active     -> the PATIENT approved the request from their own dashboard
 *   rejected   -> the patient declined the request
 *   discharged -> the hospital discharged the patient, or the patient revoked
 *                 access; the record is kept (never deleted) for auditability
 *
 * The link is its own document: neither User nor Hospital is modified, one
 * patient can be linked to many hospitals, and every transition is timestamped.
 */
const hospitalPatientSchema = new mongoose.Schema(
  {
    hospital: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Hospital',
      required: true,
      index: true,
    },
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['pending', 'active', 'rejected', 'discharged'],
      default: 'pending',
      index: true,
    },
    // Who ended the link (only meaningful when status is 'discharged')
    endedBy: {
      type: String,
      enum: ['hospital', 'patient', null],
      default: null,
    },
    requestedAt: { type: Date, default: Date.now },
    respondedAt: { type: Date, default: null }, // approved / rejected
    endedAt: { type: Date, default: null }, // discharged / revoked
  },
  { timestamps: true }
);

// One link per hospital-patient pair; re-requests reuse the same document.
hospitalPatientSchema.index({ hospital: 1, patient: 1 }, { unique: true });

hospitalPatientSchema.methods.toJSON = function () {
  const obj = this.toObject({ virtuals: true });
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model('HospitalPatient', hospitalPatientSchema);
