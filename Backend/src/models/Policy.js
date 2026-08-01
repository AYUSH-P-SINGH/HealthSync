const mongoose = require('mongoose');

const policySchema = new mongoose.Schema(
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
      required: [true, 'Insurance company reference is required'],
      index: true,
    },
    consent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'InsuranceConsent',
      required: [true, 'Approved consent reference is required'],
    },
    policyNumber: {
      type: String,
      required: [true, 'Policy number is required'],
      unique: true,
      trim: true,
      index: true,
    },
    type: {
      type: String,
      required: [true, 'Policy type is required'],
      enum: ['Individual Health', 'Family Floater', 'Critical Illness', 'Senior Citizen'],
      default: 'Individual Health',
    },
    coverageAmount: {
      type: Number,
      required: [true, 'Coverage amount is required'],
      min: [10000, 'Coverage amount must be at least ₹10,000'],
    },
    premium: {
      type: Number,
      required: [true, 'Premium amount is required'],
      min: [0, 'Premium cannot be negative'],
    },
    issueDate: {
      type: Date,
      default: Date.now,
    },
    expiryDate: {
      type: Date,
      required: [true, 'Policy expiry date is required'],
    },
    status: {
      type: String,
      enum: ['active', 'expired', 'cancelled'],
      default: 'active',
      index: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Policy', policySchema);
