/**
 * Vector Service — Chunking & Embedding persistence orchestrator.
 *
 * Takes raw medical report text, chunks it, generates vector embeddings,
 * and persists `MedicalRecordChunk` documents in MongoDB.
 *
 * Prepared for Step 4 consent-aware RAG vector search.
 */
const mongoose = require('mongoose');
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

/**
 * Calculates cosine similarity score between two float vector arrays.
 *
 * @param {number[]} v1
 * @param {number[]} v2
 * @returns {number} Float similarity score between -1 and 1
 */
const calculateCosineSimilarity = (v1, v2) => {
  if (!Array.isArray(v1) || !Array.isArray(v2) || v1.length !== v2.length || v1.length === 0) {
    return 0;
  }
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < v1.length; i++) {
    dotProduct += v1[i] * v2[i];
    normA += v1[i] * v1[i];
    normB += v2[i] * v2[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return Number((dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))).toFixed(6));
};

/**
 * Performs consent-aware vector similarity search over MedicalRecordChunk documents.
 * Security Invariant: Filters strictly by patientId + allowedRecordTypes at the DB level.
 *
 * @param {object} params
 * @param {string} params.query - User search query
 * @param {string|import('mongoose').Types.ObjectId} params.patientId - Patient ID
 * @param {string[]} [params.allowedRecordTypes] - List of permitted record types
 * @param {number} [params.limit=5] - Maximum chunks to return
 * @returns {Promise<Array<{ recordId: string, chunkId: string, text: string, recordType: string, recordTitle: string, recordDate: string, score: number }>>}
 */
const searchSimilarChunks = async ({ query, patientId, allowedRecordTypes = [], limit = 5, minScore = 0.10 }) => {
  const safeQuery = String(query || '').trim();
  if (!safeQuery || !patientId || !Array.isArray(allowedRecordTypes) || allowedRecordTypes.length === 0) {
    return [];
  }

  const patientObjectId = new mongoose.Types.ObjectId(patientId);
  const targetLimit = Math.max(1, Math.min(Number(limit) || 5, 20));

  try {
    // 1. Generate query embedding (enforces EMBEDDING_DIMENSIONS)
    const queryVector = await embeddingService.embedQuery(safeQuery);

    const filterQuery = {
      patient: patientObjectId,
      'metadata.recordType': { $in: allowedRecordTypes },
    };

    // 2. Try Atlas Vector Search if available
    try {
      const atlasResults = await MedicalRecordChunk.aggregate([
        {
          $vectorSearch: {
            index: 'medical_records_vector_index',
            path: 'embedding',
            queryVector,
            numCandidates: 100,
            limit: targetLimit,
            filter: filterQuery,
          },
        },
        {
          $project: {
            recordId: '$record',
            chunkId: '$_id',
            text: 1,
            recordType: '$metadata.recordType',
            recordTitle: '$metadata.recordTitle',
            recordDate: '$metadata.recordDate',
            score: { $meta: 'vectorSearchScore' },
          },
        },
      ]);

      if (Array.isArray(atlasResults) && atlasResults.length > 0) {
        return atlasResults
          .map((res) => ({
            recordId: String(res.recordId || res.record || ''),
            chunkId: String(res.chunkId || res._id || ''),
            text: res.text || '',
            recordType: res.recordType || 'other',
            recordTitle: res.recordTitle || '',
            recordDate: res.recordDate ? new Date(res.recordDate).toISOString() : new Date().toISOString(),
            score: Number(res.score || 0),
          }))
          .filter((chunk) => chunk.score >= minScore);
      }
    } catch (atlasErr) {
      // Atlas $vectorSearch index not available in local MongoDB — fall through to in-memory cosine similarity fallback
      logger.debug('Local cosine similarity fallback used (Atlas $vectorSearch unavailable)');
    }

    // 3. Fallback: Fetch candidate chunks matching security filter strictly and compute cosine similarity
    const candidateChunks = await MedicalRecordChunk.find(filterQuery)
      .select('record text metadata embedding')
      .lean();

    if (!candidateChunks || candidateChunks.length === 0) {
      return [];
    }

    const scoredResults = candidateChunks
      .map((chunk) => {
        const score = calculateCosineSimilarity(queryVector, chunk.embedding);
        return {
          recordId: String(chunk.record),
          chunkId: String(chunk._id),
          text: chunk.text,
          recordType: chunk.metadata?.recordType || 'other',
          recordTitle: chunk.metadata?.recordTitle || '',
          recordDate: chunk.metadata?.recordDate
            ? new Date(chunk.metadata.recordDate).toISOString()
            : new Date().toISOString(),
          score,
        };
      })
      .filter((chunk) => chunk.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, targetLimit);

    return scoredResults;
  } catch (err) {
    logger.error('Vector similarity search failed', {
      query: safeQuery.slice(0, 100),
      patientId: String(patientId),
      error: err.message,
    });
    return [];
  }
};

module.exports = {
  processAndStoreRecordChunks,
  removeRecordChunks,
  searchSimilarChunks,
  calculateCosineSimilarity,
};
