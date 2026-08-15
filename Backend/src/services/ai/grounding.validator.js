/**
 * Grounding Response Validator — Verifies LLM-generated RAG answers and citations against retrieved source chunks.
 *
 * Checks:
 * 1. Source existence validation (chunks array non-empty)
 * 2. Citation-to-source mapping validation (ensures citations map to retrieved chunk IDs / record IDs)
 * 3. Numerical & metric claim validation (checks percentages, lab values, dates exist in source text)
 */

/**
 * Extracts numerical expressions (e.g. "5.8%", "168 mg/dL", "6.4", "2024-03-12") from text.
 *
 * @param {string} text
 * @returns {string[]}
 */
const extractNumericalTokens = (text) => {
  const safeText = String(text || '');
  const matches = safeText.match(/\b\d+(?:\.\d+)?(?:\s*(?:%|mg\/dL|g\/dL|mmol\/L|U\/L|IU\/L|mmHg|bpm|mg|mcg|mL))?\b/gi);
  return matches ? [...new Set(matches.map((m) => m.trim().toLowerCase()))] : [];
};

/**
 * Validates that citations in the LLM response map strictly to retrieved source chunks.
 * Filters out hallucinated or ungrounded citations.
 *
 * @param {Array<object>} citations
 * @param {Array<object>} chunks
 * @returns {Array<object>} Filtered valid citations
 */
const validateCitations = (citations = [], chunks = []) => {
  if (!Array.isArray(citations) || citations.length === 0 || !Array.isArray(chunks) || chunks.length === 0) {
    return [];
  }

  const validRecordIds = new Set(chunks.map((c) => String(c.recordId || c.record)));
  const validChunkIds = new Set(chunks.map((c) => String(c.chunkId || c._id)));

  return citations.filter((cit) => {
    const recMatch = cit.recordId && validRecordIds.has(String(cit.recordId));
    const chunkMatch = cit.chunkId && validChunkIds.has(String(cit.chunkId));
    return recMatch || chunkMatch;
  });
};

/**
 * Performs grounded response validation.
 *
 * @param {object} params
 * @param {string} params.answer - LLM generated answer
 * @param {Array<object>} params.citations - LLM citations
 * @param {Array<object>} params.chunks - Retrieved source chunks
 * @returns {{ isGrounded: boolean, validCitations: Array<object>, ungroundedTokens: string[], confidenceAdjustment: string|null }}
 */
const validateGrounding = ({ answer, citations = [], chunks = [] }) => {
  const safeAnswer = String(answer || '').trim();

  // 1. Source existence check
  if (!safeAnswer || !Array.isArray(chunks) || chunks.length === 0) {
    return {
      isGrounded: false,
      validCitations: [],
      ungroundedTokens: [],
      confidenceAdjustment: 'low',
    };
  }

  // 2. Citation-to-source mapping validation
  const validCitations = validateCitations(citations, chunks);

  // 3. Numerical & metric claim validation
  const combinedSourceText = chunks.map((c) => c.text || '').join(' ').toLowerCase();
  const answerNumericalTokens = extractNumericalTokens(safeAnswer);

  const ungroundedTokens = [];
  for (const token of answerNumericalTokens) {
    if (!combinedSourceText.includes(token)) {
      const digitsOnly = token.replace(/[^\d.]/g, '');
      if (digitsOnly && !combinedSourceText.includes(digitsOnly)) {
        ungroundedTokens.push(token);
      }
    }
  }

  const isGrounded = ungroundedTokens.length === 0 && validCitations.length > 0;

  return {
    isGrounded,
    validCitations,
    ungroundedTokens,
    confidenceAdjustment: isGrounded ? null : 'low',
  };
};

module.exports = {
  extractNumericalTokens,
  validateCitations,
  validateGrounding,
};
