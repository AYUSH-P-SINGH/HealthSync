/**
 * Batch / folder ingestion tests.
 *
 * The behaviour under test here is mostly about NOT being subtly wrong:
 * page order, partial reads, and junk filtering are all things that fail
 * quietly and produce plausible-looking garbage rather than an obvious error.
 */
const documentText = require('../src/services/documentText.service');
const { verifyBatchSize, MAX_BATCH_FILES } = require('../src/config/reportUpload.config');
const { extract } = require('../src/services/extractors/rulesExtractor');

const ANCHOR = new Date('2026-02-14T00:00:00Z');

let sharp = null;
let ocrAvailable = false;
try {
  sharp = require('sharp');
  ocrAvailable = require('../src/services/ocr.service').isAvailable();
} catch {
  /* optional native deps not installed */
}

const describeIfOcr = sharp && ocrAvailable ? describe : describe.skip;

const renderPage = async (lines, { width = 1200, fontSize = 30 } = {}) => {
  const height = 60 + lines.length * (fontSize + 22);
  const svg =
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="${width}" height="${height}" fill="white"/>` +
    lines
      .map(
        (l, i) =>
          `<text x="40" y="${50 + i * (fontSize + 22)}" font-family="DejaVu Sans" font-size="${fontSize}" fill="black">${l.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>`
      )
      .join('') +
    '</svg>';
  return sharp(Buffer.from(svg)).png().toBuffer();
};

const asUpload = (name, buffer) => ({ originalname: name, buffer, size: buffer.length });

// ─── Ordering (pure, runs everywhere) ────────────────────

describe('page ordering', () => {
  test('sorts numerically, so page10 does not jump ahead of page2', () => {
    const names = ['page10.jpg', 'page2.jpg', 'page1.jpg', 'page20.jpg', 'page3.jpg'];
    expect([...names].sort(documentText.naturalCompare)).toEqual([
      'page1.jpg',
      'page2.jpg',
      'page3.jpg',
      'page10.jpg',
      'page20.jpg',
    ]);
  });

  test('ignores directory components from a folder upload', () => {
    const names = ['scans/2026/page2.jpg', 'scans/2026/page1.jpg'];
    const sorted = [...names].sort(documentText.naturalCompare);
    expect(sorted[0]).toContain('page1');
  });

  test('handles the IMG_ convention phones use', () => {
    const names = ['IMG_0012.HEIC', 'IMG_0003.HEIC', 'IMG_0100.HEIC'];
    expect([...names].sort(documentText.naturalCompare)).toEqual([
      'IMG_0003.HEIC',
      'IMG_0012.HEIC',
      'IMG_0100.HEIC',
    ]);
  });

  test('is case-insensitive', () => {
    const names = ['Page2.png', 'page1.PNG'];
    expect([...names].sort(documentText.naturalCompare)[0]).toBe('page1.PNG');
  });
});

describe('junk filtering', () => {
  test.each([
    '.DS_Store',
    '__MACOSX',
    'Thumbs.db',
    'desktop.ini',
    '.hidden-file.jpg',
    'scans/.DS_Store',
  ])('treats %s as junk', (name) => {
    expect(documentText.isJunk(name)).toBe(true);
  });

  test.each(['page1.jpg', 'REPORT.pdf', 'scans/2026/ct-chest.png'])(
    'keeps real file %s',
    (name) => {
      expect(documentText.isJunk(name)).toBe(false);
    }
  );
});

describe('batch limits', () => {
  const fake = (n, size) => Array.from({ length: n }, () => ({ size }));

  test('accepts a normal multi-page batch', () => {
    expect(verifyBatchSize(fake(8, 2 * 1024 * 1024))).toBe(true);
  });

  test('rejects too many files', () => {
    expect(() => verifyBatchSize(fake(MAX_BATCH_FILES + 1, 1000))).toThrow(/at most/i);
  });

  test('rejects an oversized batch even when each file is individually legal', () => {
    // 25 x 14 MB passes every per-file check and is still 350 MB of buffers.
    expect(() => verifyBatchSize(fake(25, 14 * 1024 * 1024))).toThrow(/MB/);
  });

  test('an empty batch is not an error at this layer', () => {
    expect(verifyBatchSize([])).toBe(true);
  });
});

describe('text combination', () => {
  test('concatenates only successful reads, in order, with page markers', () => {
    const combined = documentText.combineBatchText([
      { name: 'page1.jpg', ok: true, text: 'Finding: 6 mm nodule.' },
      { name: 'page2.jpg', ok: false, reason: 'blurry' },
      { name: 'page3.jpg', ok: true, text: 'Recommend repeat CT in 6 months.' },
    ]);

    expect(combined).toContain('6 mm nodule');
    expect(combined).toContain('Recommend repeat CT');
    expect(combined).toContain('page1.jpg');
    expect(combined.indexOf('nodule')).toBeLessThan(combined.indexOf('Recommend'));
  });

  test('averages legibility across successful reads only', () => {
    const avg = documentText.averageConfidence([
      { ok: true, confidence: 90 },
      { ok: true, confidence: 70 },
      { ok: false },
    ]);
    expect(avg).toBe(80);
  });

  test('reports zero confidence when nothing was read', () => {
    expect(documentText.averageConfidence([{ ok: false }])).toBe(0);
  });
});

// ─── Full batch pipeline (needs sharp + tesseract) ───────

describeIfOcr('multi-page batch pipeline', () => {
  const ocrService = require('../src/services/ocr.service');

  afterAll(async () => {
    await ocrService.shutdown();
  });

  test('links a recommendation on a later page to a finding on an earlier one', async () => {
    // This is the whole reason combine-mode exists. Scanned separately,
    // page 2's recommendation would have no finding attached to it.
    const page1 = await renderPage([
      'RADIOLOGY REPORT - CT CHEST',
      '',
      'FINDINGS: There is an incidental 6 mm solid',
      'pulmonary nodule in the right lower lobe.',
    ]);
    const page2 = await renderPage([
      'IMPRESSION:',
      '',
      'Recommend interval follow-up chest CT in 6 months',
      'to assess stability.',
    ]);

    // Deliberately supplied out of order — the sort must fix it.
    const { results, readCount, failedCount } = await documentText.readBatch([
      asUpload('page2.png', page2),
      asUpload('page1.png', page1),
    ]);

    expect(readCount).toBe(2);
    expect(failedCount).toBe(0);
    expect(results[0].name).toBe('page1.png');

    const combined = documentText.combineBatchText(results);
    const [c] = extract(combined, { anchorDate: ANCHOR }).candidates;

    expect(c).toBeDefined();
    expect(c.finding).toMatch(/6 mm|nodule/i);
    expect(Math.round((c.dueAt - ANCHOR) / 86_400_000)).toBe(180);
  }, 120_000);

  test('reads what it can and reports what it could not', async () => {
    const good = await renderPage([
      'IMPRESSION: 9 mm sigmoid polyp removed.',
      'Repeat colonoscopy is recommended in 3 years.',
    ]);
    const corrupt = Buffer.from('this is definitely not an image or a pdf');

    const { results, readCount, failedCount } = await documentText.readBatch([
      asUpload('page1.png', good),
      asUpload('page2.png', corrupt),
    ]);

    expect(readCount).toBe(1);
    expect(failedCount).toBe(1);

    const failure = results.find((r) => !r.ok);
    expect(failure.name).toBe('page2.png');
    expect(failure.reason).toBeTruthy();

    // The readable page still yields its obligation.
    const combined = documentText.combineBatchText(results);
    const cands = extract(combined, { anchorDate: ANCHOR }).candidates;
    expect(cands.length).toBeGreaterThan(0);
  }, 120_000);

  test('drops OS junk before it ever reaches OCR', async () => {
    const page = await renderPage([
      'IMPRESSION: Recommend repeat ultrasound in 3 months.',
    ]);

    const { results } = await documentText.readBatch([
      asUpload('.DS_Store', Buffer.from('junk')),
      asUpload('page1.png', page),
      asUpload('Thumbs.db', Buffer.from('junk')),
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('page1.png');
  }, 120_000);

  test('does not invent obligations from a batch of blank pages', async () => {
    const blank = await sharp({
      create: { width: 1000, height: 700, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();

    const { readCount, failedCount } = await documentText.readBatch([
      asUpload('page1.png', blank),
      asUpload('page2.png', blank),
    ]);

    expect(readCount).toBe(0);
    expect(failedCount).toBe(2);
  }, 120_000);
});
