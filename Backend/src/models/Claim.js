const mongoose = require('mongoose');

const claimSchema = new mongoose.Schema(
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
    policy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Policy',
      required: [true, 'Policy reference is required'],
      index: true,
    },
    claimNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    hospitalName: {
      type: String,
      required: [true, 'Hospital name is required'],
      trim: true,
    },
    diagnosis: {
      type: String,
      required: [true, 'Diagnosis/Reason for claim is required'],
      trim: true,
    },
    claimAmount: {
      type: Number,
      required: [true, 'Claim amount is required'],
      min: [100, 'Claim amount must be at least ₹100'],
    },
    approvedAmount: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ['submitted', 'in_review', 'approved', 'rejected', 'more_documents_required', 'appealed'],
      default: 'submitted',
      index: true,
    },
    rejectionReason: {
      type: String,
      default: null,
    },
    documents: [
      {
        name: { type: String, required: true },
        fileUrl: { type: String, required: true },
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
    statusHistory: [
      {
        status: { type: String, required: true },
        updatedBy: { type: String, required: true },
        comment: { type: String, default: '' },
        timestamp: { type: Date, default: Date.now },
      },
    ],
    // Structured document requests raised by the insurer. Replaces the
    // free-text dead-end of 'more_documents_required' — the patient sees
    // exactly which items are outstanding and uploads against each one.
    documentRequests: [
      {
        itemName: { type: String, required: true, trim: true },
        note: { type: String, default: '', trim: true },
        status: {
          type: String,
          enum: ['pending', 'fulfilled'],
          default: 'pending',
        },
        requestedAt: { type: Date, default: Date.now },
        fulfilledAt: { type: Date, default: null },
        document: {
          name: { type: String, default: null },
          fileUrl: { type: String, default: null },
        },
      },
    ],
    // Formal appeal filed by the patient against a rejection or
    // partial approval — real-world recourse, not just chat.
    appeal: {
      filed: { type: Boolean, default: false },
      reason: { type: String, default: null, trim: true },
      status: {
        type: String,
        enum: ['none', 'filed', 'under_review', 'upheld', 'overturned'],
        default: 'none',
      },
      filedAt: { type: Date, default: null },
      resolvedAt: { type: Date, default: null },
      resolutionNote: { type: String, default: null, trim: true },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Claim', claimSchema);
