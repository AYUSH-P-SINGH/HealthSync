const mongoose = require('mongoose');

/**
 * MedicalRecordChunk — Represents a single chunk of extracted text from a
 * MedicalRecord, paired with its vector embedding for RAG semantic search.
 *
 * Scoped by patient ID for consent-aware access control in Step 4.
 */
const medicalRecordChunkSchema = new mongoose.Schema(
  {
    record: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MedicalRecord',
      required: true,
      index: true,
    },
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    chunkIndex: {
      type: Number,
      required: true,
    },
    totalChunks: {
      type: Number,
      required: true,
    },
    text: {
      type: String,
      required: true,
    },
    // Dense vector embedding array (e.g. 768 or 1536 float dimensions)
    embedding: {
      type: [Number],
      default: [],
    },
    tokenCount: {
      type: Number,
      default: 0,
    },
    startCharIndex: {
      type: Number,
      default: 0,
    },
    endCharIndex: {
      type: Number,
      default: 0,
    },
    metadata: {
      recordType: { type: String, default: 'other' },
      recordTitle: { type: String, default: '' },
      recordDate: { type: Date, default: Date.now },
    },
  },
  { timestamps: true }
);

// Compound index for efficient patient-scoped chunk retrieval
medicalRecordChunkSchema.index({ patient: 1, record: 1, chunkIndex: 1 });

medicalRecordChunkSchema.methods.toJSON = function () {
  const obj = this.toObject({ virtuals: true });
  delete obj.__v;
  return obj;
};

module.exports = mongoose.model('MedicalRecordChunk', medicalRecordChunkSchema);
