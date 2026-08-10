const mongoose = require('mongoose');
const { RECORD_TYPES } = require('../constants/recordTypes');

/**
 * MedicalRecord — a single entry in a patient's health history.
 *
 * Created either by a linked hospital (createdByRole: 'hospital') or by the
 * patient themself (createdByRole: 'patient', shown as "self-reported").
 * Records are the substrate for the patient timeline, prescription/allergy
 * safety checks, and scoped consent-based sharing.
 */
const medicineSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    dosage: { type: String, trim: true, maxlength: 100, default: '' }, // e.g. "500 mg"
    frequency: { type: String, trim: true, maxlength: 100, default: '' }, // e.g. "twice daily"
    duration: { type: String, trim: true, maxlength: 100, default: '' }, // e.g. "5 days"
    notes: { type: String, trim: true, maxlength: 300, default: '' },
  },
  { _id: false }
);

const labResultSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 }, // e.g. "Hemoglobin"
    value: { type: String, trim: true, maxlength: 100, default: '' },
    unit: { type: String, trim: true, maxlength: 50, default: '' },
    referenceRange: { type: String, trim: true, maxlength: 100, default: '' },
    flag: {
      type: String,
      enum: ['normal', 'low', 'high', 'critical', null],
      default: null,
    },
  },
  { _id: false }
);

const alertSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['interaction', 'allergy', 'info'], required: true },
    severity: { type: String, enum: ['info', 'warning', 'critical'], default: 'warning' },
    message: { type: String, required: true, maxlength: 500 },
    source: { type: String, default: 'HealthSync' }, // 'HealthSync' | 'openFDA'
  },
  { _id: false }
);

const aiSummarySchema = new mongoose.Schema(
  {
    summary: { type: String, default: '' },
    keyFindings: [{ type: String }],
    abnormalValues: [
      {
        test: { type: String, required: true },
        value: { type: String, default: '' },
        referenceRange: { type: String, default: '' },
        flag: { type: String, enum: ['normal', 'low', 'high', 'critical', null], default: null },
      },
    ],
    medications: [medicineSchema],
    recommendations: [{ type: String }],
    generatedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const medicalRecordSchema = new mongoose.Schema(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    // null => self-reported by the patient
    hospital: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Hospital',
      default: null,
      index: true,
    },
    createdByRole: {
      type: String,
      enum: ['hospital', 'patient'],
      required: true,
    },
    type: {
      type: String,
      enum: RECORD_TYPES,
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 2000, default: '' },
    // Condition/diagnosis tag — powers the "filter by condition" timeline view
    condition: { type: String, trim: true, maxlength: 200, default: null },
    doctorName: { type: String, trim: true, maxlength: 200, default: null },
    recordDate: { type: Date, default: Date.now, index: true },

    // Type-specific payloads
    medicines: { type: [medicineSchema], default: [] }, // prescription
    labResults: { type: [labResultSchema], default: [] }, // lab_report

    // Prescriptions only: whether the course is still being taken. Used by
    // the drug-interaction checker to build the "active medicines" list.
    isActivePrescription: { type: Boolean, default: null },

    // Safety alerts produced at creation time (interaction/allergy checks)
    alerts: { type: [alertSchema], default: [] },

    // Raw OCR / PDF extracted text preserved for RAG, citations, and auditing.
    // Capped at 100 000 chars (~25 000 tokens) to prevent document bloat.
    rawText: { type: String, default: '', maxlength: 100000 },

    // AI processing lifecycle: none → pending → completed | failed
    aiStatus: {
      type: String,
      enum: ['none', 'pending', 'completed', 'failed'],
      default: 'none',
    },

    // AI-generated plain English summary and structured breakdown
    aiSummary: { type: aiSummarySchema, default: null },
  },
  { timestamps: true }
);

medicalRecordSchema.index({ patient: 1, recordDate: -1 });
medicalRecordSchema.index({ patient: 1, type: 1 });

medicalRecordSchema.methods.toJSON = function () {
  const obj = this.toObject({ virtuals: true });
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model('MedicalRecord', medicalRecordSchema);
