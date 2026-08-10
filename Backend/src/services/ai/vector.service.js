/**
 * Vector Service — Chunking & Embedding persistence orchestrator.
 *
 * Takes raw medical report text, chunks it, generates vector embeddings,
 * and persists `MedicalRecordChunk` documents in MongoDB.
 *
 * Prepared for Step 4 consent-aware RAG vector search.
 */
const MedicalRecordChunk = require('../../models/MedicalRecordChunk');
const chunkingService = require('./chunking.service');
const embeddingService = require('./embedding.service');
const logger = require('../../utils/logger');

/**
 * Process a record's rawText into chunks, generate embeddings, and persist in MongoDB.
 *
 * @param {object} params
 * @param {string|import('mongoose').Types.ObjectId} params.recordId
 * @param {string|import('mongoose').Types.ObjectId} params.patientId
 * @param {string} params.rawText
 * @param {object} [params.metadata]
 * @returns {Promise<Array<import('../../models/MedicalRecordChunk')>>}
 */
const processAndStoreRecordChunks = async ({ recordId, patientId, rawText, metadata = {} }) => {
  const text = String(rawText || '').trim();
  if (!text || !recordId || !patientId) {
    return [];
  }

  const startMs = Date.now();

  try {
    // 1. Delete old chunks if this record was previously processed
    await MedicalRecordChunk.deleteMany({ record: recordId });

    // 2. Chunk text using boundary-aware chunking service
    const chunks = chunkingService.chunkText(text);
    if (chunks.length === 0) return [];

    // 3. Generate embeddings concurrently & build documents
    const embeddings = await Promise.all(
      chunks.map((chunk) => embeddingService.generateEmbedding(chunk.text))
    );

    const chunkDocs = chunks.map((chunk, idx) => ({
      record: recordId,
      patient: patientId,
      chunkIndex: chunk.chunkIndex,
      totalChunks: chunk.totalChunks,
      text: chunk.text,
      embedding: embeddings[idx],
      tokenCount: chunk.tokenCount,
      startCharIndex: chunk.startCharIndex,
      endCharIndex: chunk.endCharIndex,
      metadata: {
        recordType: metadata.recordType || 'other',
        recordTitle: metadata.recordTitle || '',
        recordDate: metadata.recordDate ? new Date(metadata.recordDate) : new Date(),
      },
    }));

    // 4. Save to MongoDB in bulk
    const savedChunks = await MedicalRecordChunk.insertMany(chunkDocs);

    logger.info('MedicalRecordChunks created successfully', {
      recordId: String(recordId),
      patientId: String(patientId),
      chunksCount: savedChunks.length,
      durationMs: Date.now() - startMs,
    });

    return savedChunks;
  } catch (err) {
    logger.error('Failed to process and store MedicalRecordChunks', {
      recordId: String(recordId),
      error: err.message,
    });
    // Vector chunking failure must not destroy the medical record creation flow
    return [];
  }
};

/**
 * Removes all chunks associated with a deleted record.
 *
 * @param {string|import('mongoose').Types.ObjectId} recordId
 */
const removeRecordChunks = async (recordId) => {
  try {
    const result = await MedicalRecordChunk.deleteMany({ record: recordId });
    return result.deletedCount;
  } catch (err) {
    logger.error('Failed to remove record chunks', { recordId: String(recordId), error: err.message });
    return 0;
  }
};

module.exports = {
  processAndStoreRecordChunks,
  removeRecordChunks,
};
