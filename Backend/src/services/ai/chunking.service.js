/**
 * Chunking Service — Document text splitting for RAG vector search.
 *
 * Implements recursive boundary-aware character text splitting with configurable
 * chunk size and overlap. Splits cleanly on paragraph, sentence, or word boundaries
 * to preserve clinical context without splitting medical terms mid-word.
 */

const DEFAULT_CHUNK_SIZE = 1000; // ~250 tokens
const DEFAULT_CHUNK_OVERLAP = 200; // ~50 tokens

/**
 * Splits raw text into an array of chunk objects.
 *
 * @param {string} text - Raw document text layer
 * @param {object} [options]
 * @param {number} [options.chunkSize=1000] - Max characters per chunk
 * @param {number} [options.chunkOverlap=200] - Overlapping characters between consecutive chunks
 * @returns {Array<{ chunkIndex: number, totalChunks: number, text: string, startCharIndex: number, endCharIndex: number, tokenCount: number }>}
 */
const chunkText = (text, options = {}) => {
  const raw = String(text || '').trim();
  if (!raw) return [];

  const chunkSize = Number(options.chunkSize || process.env.CHUNK_SIZE || DEFAULT_CHUNK_SIZE);
  const chunkOverlap = Number(options.chunkOverlap || process.env.CHUNK_OVERLAP || DEFAULT_CHUNK_OVERLAP);

  if (raw.length <= chunkSize) {
    return [
      {
        chunkIndex: 0,
        totalChunks: 1,
        text: raw,
        startCharIndex: 0,
        endCharIndex: raw.length,
        tokenCount: Math.ceil(raw.length / 4),
      },
    ];
  }

  const chunks = [];
  let startIndex = 0;

  while (startIndex < raw.length) {
    let endIndex = startIndex + chunkSize;

    if (endIndex < raw.length) {
      // Find a clean boundary (paragraph > newline > sentence > word space)
      const boundaryIndex = findCleanBoundary(raw, startIndex, endIndex);
      if (boundaryIndex > startIndex) {
        endIndex = boundaryIndex;
      }
    } else {
      endIndex = raw.length;
    }

    const chunkTextStr = raw.slice(startIndex, endIndex).trim();
    if (chunkTextStr.length > 0) {
      chunks.push({
        chunkIndex: chunks.length,
        text: chunkTextStr,
        startCharIndex: startIndex,
        endCharIndex: endIndex,
        tokenCount: Math.ceil(chunkTextStr.length / 4),
      });
    }

    if (endIndex >= raw.length) break;

    // Advance start position considering overlap
    const step = Math.max(1, endIndex - startIndex - chunkOverlap);
    startIndex += step;
  }

  const totalChunks = chunks.length;
  return chunks.map((c, idx) => ({
    ...c,
    chunkIndex: idx,
    totalChunks,
  }));
};

/**
 * Finds a natural break point (paragraph, sentence, or word gap) near endIndex.
 */
const findCleanBoundary = (text, startIndex, targetEndIndex) => {
  const window = text.slice(startIndex, targetEndIndex);

  // Look for paragraph breaks (\n\n) near the end
  const paragraphIndex = window.lastIndexOf('\n\n');
  if (paragraphIndex > window.length * 0.5) {
    return startIndex + paragraphIndex + 2;
  }

  // Look for newline breaks (\n)
  const newlineIndex = window.lastIndexOf('\n');
  if (newlineIndex > window.length * 0.5) {
    return startIndex + newlineIndex + 1;
  }

  // Look for sentence end (. )
  const sentenceIndex = window.lastIndexOf('. ');
  if (sentenceIndex > window.length * 0.5) {
    return startIndex + sentenceIndex + 2;
  }

  // Fallback to space
  const spaceIndex = window.lastIndexOf(' ');
  if (spaceIndex > window.length * 0.5) {
    return startIndex + spaceIndex + 1;
  }

  return targetEndIndex;
};

module.exports = {
  chunkText,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_CHUNK_OVERLAP,
};
