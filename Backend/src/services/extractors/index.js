/**
 * Extraction provider selector.
 *
 * Rules are the default and the floor. If an LLM is configured it gets first
 * pass, but a null/empty/failed LLM result always falls through to rules —
 * never to nothing. The failure mode of this whole feature must be "we found
 * fewer obligations", never "we silently found none because an API was down".
 */
const rulesExtractor = require('./rulesExtractor');
const llmExtractor = require('./llmExtractor');
const logger = require('../../utils/logger');
const { LIMITS } = require('../../constants/followUp');

/**
 * @param {string} text
 * @param {{ anchorDate?: Date }} options
 * @returns {Promise<{ candidates: Array, engine: string, stats: object }>}
 */
const extractFollowUps = async (text, options = {}) => {
  const safeText = String(text || '').slice(0, LIMITS.MAX_TEXT_CHARS);
  if (!safeText.trim()) return { candidates: [], engine: 'none', stats: {} };

  if (llmExtractor.isEnabled()) {
    try {
      const llmResult = await llmExtractor.extract(safeText, options);
      if (Array.isArray(llmResult) && llmResult.length > 0) {
        return { candidates: llmResult, engine: llmResult[0].extractedBy, stats: { source: 'llm' } };
      }
    } catch (err) {
      logger.error('LLM extractor threw; using rules', { error: err.message });
    }
  }

  const { candidates, stats } = rulesExtractor.extract(safeText, options);
  return { candidates, engine: 'rules', stats };
};

module.exports = { extractFollowUps };
