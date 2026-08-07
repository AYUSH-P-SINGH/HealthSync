const mongoose = require('mongoose');

/**
 * ClaimMessage — a single message in the two-way communication thread
 * between a patient and an insurance organization, scoped to one claim.
 * Every message is permanently tied to the claim for auditability.
 */
const claimMessageSchema = new mongoose.Schema(
  {
    claim: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Claim',
      required: [true, 'Claim reference is required'],
      index: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      required: [true, 'Sender reference is required'],
    },
    senderRole: {
      type: String,
      enum: ['patient', 'insurance'],
      required: [true, 'Sender role is required'],
      index: true,
    },
    senderName: {
      type: String,
      required: true,
      trim: true,
    },
    body: {
      type: String,
      required: [true, 'Message body is required'],
      trim: true,
      maxlength: [2000, 'Message cannot exceed 2000 characters'],
    },
    attachments: [
      {
        name: { type: String, required: true },
        fileUrl: { type: String, required: true },
      },
    ],
    // Read receipts per side (a message is "unread" for the counterparty
    // until they open the thread).
    readByPatient: { type: Boolean, default: false },
    readByInsurance: { type: Boolean, default: false },
  },
  { timestamps: true }
);

claimMessageSchema.index({ claim: 1, createdAt: 1 });

module.exports = mongoose.model('ClaimMessage', claimMessageSchema);
