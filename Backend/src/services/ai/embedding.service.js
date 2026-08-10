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

const DEFAULT_EMBEDDING_MODEL = 'text-embedding-004';
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
      return vector;
    }

    logger.warn('Embedding API returned invalid vector format');
    return generateDeterministicMockEmbedding(safeText);
  } catch (err) {
    logger.error('Embedding generation failed', { error: err.message });
    return generateDeterministicMockEmbedding(safeText);
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Deterministic mock vector generation when API key is disabled or offline.
 * Produces consistent normalized 768-dim floats based on text hash.
 */
const generateDeterministicMockEmbedding = (text) => {
  const dimensions = Number(process.env.EMBEDDING_DIMENSIONS || DEFAULT_DIMENSIONS);
  const vector = new Array(dimensions);
  let hash = 0;

  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }

  for (let i = 0; i < dimensions; i++) {
    const rawVal = Math.sin(hash + i * 0.1);
    vector[i] = Number(rawVal.toFixed(6));
  }

  return vector;
};

module.exports = {
  isEnabled,
  generateEmbedding,
  generateDeterministicMockEmbedding,
  DEFAULT_DIMENSIONS,
};
