const { chunkText, DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_OVERLAP } = require('../src/services/ai/chunking.service');

describe('Step 3 — Document Chunking Service (chunking.service.js)', () => {
  it('returns an empty array when given empty or whitespace text', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   ')).toEqual([]);
    expect(chunkText(null)).toEqual([]);
    expect(chunkText(undefined)).toEqual([]);
  });

  it('creates 1 chunk when text length is within chunkSize limit', () => {
    const shortText = 'Patient presented with mild fever. Advised rest.';
    const chunks = chunkText(shortText, { chunkSize: 1000 });

    expect(chunks).toHaveLength(1);
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[0].totalChunks).toBe(1);
    expect(chunks[0].text).toBe(shortText);
    expect(chunks[0].startCharIndex).toBe(0);
    expect(chunks[0].endCharIndex).toBe(shortText.length);
    expect(chunks[0].tokenCount).toBeGreaterThan(0);
  });

  it('splits text into multiple overlapping chunks when exceeding chunkSize', () => {
    // Generate a long text with paragraphs
    const paragraph1 = 'Paragraph 1: ' + 'A'.repeat(300);
    const paragraph2 = 'Paragraph 2: ' + 'B'.repeat(300);
    const paragraph3 = 'Paragraph 3: ' + 'C'.repeat(300);
    const fullText = `${paragraph1}\n\n${paragraph2}\n\n${paragraph3}`;

    const chunks = chunkText(fullText, { chunkSize: 400, chunkOverlap: 50 });

    expect(chunks.length).toBeGreaterThan(1);
    // Every chunk must have sequential indices
    chunks.forEach((chunk, index) => {
      expect(chunk.chunkIndex).toBe(index);
      expect(chunk.totalChunks).toBe(chunks.length);
      expect(chunk.text.length).toBeGreaterThan(0);
      expect(chunk.startCharIndex).toBeLessThan(chunk.endCharIndex);
    });
  });

  it('respects paragraph boundary breaks (\\n\\n)', () => {
    const p1 = 'First section text with important details.';
    const p2 = 'Second section text with more lab values.';
    const text = `${p1}\n\n${p2}`;

    const chunks = chunkText(text, { chunkSize: 50, chunkOverlap: 10 });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0].text).toContain('First section');
  });

  it('calculates tokenCount estimate (~4 chars per token)', () => {
    const sample = '1234567890123456'; // 16 chars -> 4 tokens
    const chunks = chunkText(sample);
    expect(chunks[0].tokenCount).toBe(4);
  });

  it('uses default constants when options are omitted', () => {
    expect(DEFAULT_CHUNK_SIZE).toBe(1000);
    expect(DEFAULT_CHUNK_OVERLAP).toBe(200);
  });
});
