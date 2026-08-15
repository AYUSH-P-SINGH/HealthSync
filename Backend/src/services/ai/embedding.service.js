/**
 * Embedding Service — Vector embedding generator for medical text chunks.
 *
 * Supports Gemini embedding models (e.g. gemini-embedding-001 / text-embedding-004)
 * and OpenAI-compatible embedding endpoints.
 *
 * Fallback behavior:
 *   Returns deterministic mock vector arrays when AI/EMBEDDING API key is disabled,
 *   allowing core system operations and test suites to run unblocked offline.
 */
const logger = require('../../utils/logger');

const DEFAULT_EMBEDDING_MODEL = 'gemini-embedding-2';
const DEFAULT_DIMENSIONS = 768;

const isEnabled = () =>
  Boolean(process.env.EMBEDDING_API_KEY);

/**
 * Generates vector embedding array for a single text chunk.
 *
 * @param {string} text - Chunk text
 * @returns {Promise<number[]>} Array of float numbers
 */
const generateEmbedding = async (text) => {
  const safeText = String(text || '').trim();
  if (!safeText) {
    return new Array(DEFAULT_DIMENSIONS).fill(0);
  }

  if (!isEnabled()) {
    return generateDeterministicMockEmbedding(safeText);
  }

  const apiKey = process.env.EMBEDDING_API_KEY;
  const baseUrl =
    process.env.EMBEDDING_BASE_URL ||
    'https://generativelanguage.googleapis.com/v1beta/openai/embeddings';
  const model = process.env.EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(baseUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: safeText,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      logger.error('Embedding API call failed', { status: response.status, error: errText.slice(0, 300) });
      return generateDeterministicMockEmbedding(safeText);
    }

    const data = await response.json();
    const vector = data.data?.[0]?.embedding;
    if (Array.isArray(vector) && vector.length > 0) {
      return validateEmbeddingDimensions(vector);
    }

    logger.warn('Embedding API returned invalid vector format');
    return validateEmbeddingDimensions(generateDeterministicMockEmbedding(safeText));
  } catch (err) {
    logger.error('Embedding generation failed', { error: err.message });
    return validateEmbeddingDimensions(generateDeterministicMockEmbedding(safeText));
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Validates that an embedding vector matches the required dimension count.
 * Prevents model configuration changes from corrupting the vector pipeline.
 *
 * @param {number[]} vector
 * @returns {number[]}
 */
const validateEmbeddingDimensions = (vector) => {
  const expectedDim = Number(process.env.EMBEDDING_DIMENSIONS || DEFAULT_DIMENSIONS);
  if (!Array.isArray(vector) || vector.length !== expectedDim) {
    throw new Error(`Embedding dimension mismatch: expected ${expectedDim}, got ${vector?.length ?? 'none'}`);
  }
  return vector;
};

/**
 * Embeds a user search query for vector similarity retrieval.
 * Uses the exact same model and dimension verification as document chunk embeddings.
 *
 * @param {string} text - User query string
 * @returns {Promise<number[]>} 768-dimensional float array
 */
const embedQuery = async (text) => {
  const vector = await generateEmbedding(text);
  return validateEmbeddingDimensions(vector);
};

/**
 * Deterministic mock vector generation when API key is disabled or offline.
 * Produces consistent normalized 768-dim floats based on text hash.
 */
const generateDeterministicMockEmbedding = (text) => {
  const dimensions = Number(process.env.EMBEDDING_DIMENSIONS || DEFAULT_DIMENSIONS);
  const vector = new Array(dimensions).fill(0);
  const safeText = String(text || '').toLowerCase();

  const words = safeText.match(/\b\w+\b/g) || [];
  words.forEach((w) => {
    let hash = 0;
    for (let i = 0; i < w.length; i++) {
      hash = (hash << 5) - hash + w.charCodeAt(i);
      hash |= 0;
    }
    const idx = Math.abs(hash) % dimensions;
    vector[idx] += 1;
  });

  let norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (norm === 0) {
    vector[0] = 1;
    norm = 1;
  }
  for (let i = 0; i < dimensions; i++) {
    vector[i] = Number((vector[i] / norm).toFixed(6));
  }

  return validateEmbeddingDimensions(vector);
};

module.exports = {
  isEnabled,
  generateEmbedding,
  embedQuery,
  validateEmbeddingDimensions,
  generateDeterministicMockEmbedding,
  DEFAULT_DIMENSIONS,
};
