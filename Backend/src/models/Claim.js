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
      enum: ['submitted', 'in_review', 'approved', 'rejected', 'more_documents_required'],
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
  },
  { timestamps: true }
);

module.exports = mongoose.model('Claim', claimSchema);
