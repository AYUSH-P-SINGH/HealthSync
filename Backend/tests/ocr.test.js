/**
 * OCR ingestion tests — format sniffing, image preprocessing, and the full
 * photo → OCR → obligation pipeline.
 *
 * These build their own fixtures with sharp, so there are no binary files to
 * commit and the tests stay honest: the images are generated, rendered and
 * read back through the real code path.
 *
 * OCR is slower than the pure extractor tests, hence the raised timeouts.
 * They still run offline — the language model is resolved from node_modules,
 * never fetched.
 */
const { sniffFormat, verifyReportBuffer } = require('../src/config/reportUpload.config');
const { extract } = require('../src/services/extractors/rulesExtractor');

const ANCHOR = new Date('2026-02-14T00:00:00Z');

// sharp/tesseract/mupdf are optional at runtime; skip gracefully if absent so
// a machine without native builds still gets a green suite for everything else.
let sharp = null;
let ocrAvailable = false;
try {
  sharp = require('sharp');
  ocrAvailable = require('../src/services/ocr.service').isAvailable();
} catch {
  /* dependencies not installed */
}

const describeIfOcr = sharp && ocrAvailable ? describe : describe.skip;

/** Render report text to an image, the way a clean scan would look. */
const renderReport = async (lines, { width = 1200, fontSize = 30 } = {}) => {
  const height = 60 + lines.length * (fontSize + 22);
  const svg =
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="${width}" height="${height}" fill="white"/>` +
    lines
      .map((l, i) => {
        const safe = l.replace(/&/g, '&amp;').replace(/</g, '&lt;');
        return `<text x="40" y="${50 + i * (fontSize + 22)}" font-family="DejaVu Sans" font-size="${fontSize}" fill="black">${safe}</text>`;
      })
      .join('') +
    '</svg>';
  return sharp(Buffer.from(svg)).png().toBuffer();
};

const REPORT_LINES = [
  'RADIOLOGY REPORT - CT CHEST',
  '',
  'FINDINGS: The lungs are clear apart from a 6 mm',
  'solid nodule in the right lower lobe.',
  '',
  'IMPRESSION:',
  '1. Incidental 6 mm pulmonary nodule, right lower lobe.',
  'Recommend interval follow-up chest CT in 6 months.',
];

// ─── Format sniffing (runs everywhere) ───────────────────

describe('upload format sniffing', () => {
  const withHeader = (bytes, size = 64) => {
    const b = Buffer.alloc(size);
    Buffer.from(bytes).copy(b, 0);
    return b;
  };

  test('identifies a PDF by magic bytes', () => {
    expect(sniffFormat(withHeader([0x25, 0x50, 0x44, 0x46, 0x2d]))?.kind).toBe('pdf');
  });

  test('identifies JPEG and PNG', () => {
    expect(sniffFormat(withHeader([0xff, 0xd8, 0xff, 0xe0]))?.kind).toBe('jpeg');
    expect(
      sniffFormat(withHeader([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))?.kind
    ).toBe('png');
  });

  test('requires both RIFF and WEBP markers, not just RIFF', () => {
    const riffOnly = withHeader([0x52, 0x49, 0x46, 0x46]);
    expect(sniffFormat(riffOnly)).toBeNull(); // a WAV would start this way

    const webp = withHeader([0x52, 0x49, 0x46, 0x46]);
    Buffer.from('WEBP').copy(webp, 8);
    expect(sniffFormat(webp)?.kind).toBe('webp');
  });

  test('requires a HEIF brand, not just an ftyp box', () => {
    const mp4 = Buffer.alloc(64);
    Buffer.from('ftyp').copy(mp4, 4);
    Buffer.from('isom').copy(mp4, 8); // an MP4 brand
    expect(sniffFormat(mp4)).toBeNull();

    const heic = Buffer.alloc(64);
    Buffer.from('ftyp').copy(heic, 4);
    Buffer.from('heic').copy(heic, 8);
    expect(sniffFormat(heic)?.kind).toBe('heic');
  });

  test('rejects a renamed executable regardless of declared type', () => {
    const elf = withHeader([0x7f, 0x45, 0x4c, 0x46]);
    expect(sniffFormat(elf)).toBeNull();
    expect(() => verifyReportBuffer(elf)).toThrow(/not supported/i);
  });

  test('rejects HTML masquerading as a PDF', () => {
    const html = Buffer.from('<!DOCTYPE html><html><body>not a pdf at all</body></html>');
    expect(sniffFormat(html)).toBeNull();
    expect(() => verifyReportBuffer(html)).toThrow();
  });

  test('rejects empty and truncated buffers', () => {
    expect(() => verifyReportBuffer(Buffer.alloc(0))).toThrow(/empty or unreadable/i);
    expect(() => verifyReportBuffer(Buffer.from([0x25, 0x50]))).toThrow();
    expect(() => verifyReportBuffer(null)).toThrow();
  });
});

// ─── Image preprocessing (needs sharp) ───────────────────

(sharp ? describe : describe.skip)('image preprocessing guards', () => {
  const imagePrep = require('../src/services/imagePrep.service');

  test('rejects an image too small to contain readable text', async () => {
    const tiny = await sharp({
      create: { width: 50, height: 50, channels: 3, background: '#fff' },
    })
      .png()
      .toBuffer();
    await expect(imagePrep.probe(tiny)).rejects.toThrow(/too small/i);
  });

  test('rejects unreadable bytes rather than passing them to OCR', async () => {
    await expect(imagePrep.probe(Buffer.from('definitely not an image'))).rejects.toThrow();
  });

  test('normalizes a dim photo to greyscale PNG and upscales it', async () => {
    const dim = await sharp({
      create: { width: 600, height: 400, channels: 3, background: '#606060' },
    })
      .jpeg()
      .toBuffer();

    const { buffer } = await imagePrep.preprocess(dim);
    const meta = await sharp(buffer).metadata();

    expect(meta.format).toBe('png');
    expect(meta.width).toBeGreaterThan(600); // upscaled toward OCR's preferred density
  });

  test('a decompression bomb is bounded by pixels, not by file size', async () => {
    // The pixel cap is the real defence — this asserts the limit exists and is
    // sane, since generating an actual 100 MP bomb would be slow and pointless.
    expect(imagePrep.MAX_INPUT_PIXELS).toBeGreaterThan(10_000_000);
    expect(imagePrep.MAX_INPUT_PIXELS).toBeLessThanOrEqual(80_000_000);
  });
});

// ─── Full OCR pipeline (needs sharp + tesseract) ─────────

describeIfOcr('OCR pipeline', () => {
  const documentText = require('../src/services/documentText.service');
  const ocrService = require('../src/services/ocr.service');

  afterAll(async () => {
    await ocrService.shutdown();
  });

  test('language data resolves locally — OCR never needs the network', () => {
    expect(ocrService.resolveLangPath()).toBeTruthy();
  });

  test('reads a clean report image and extracts the follow-up', async () => {
    const png = await renderReport(REPORT_LINES);
    const result = await documentText.extractFromUpload(png);

    expect(result.method).toBe('image_ocr');
    expect(result.confidence).toBeGreaterThan(70);
    expect(result.text).toMatch(/recommend/i);

    const [c] = extract(result.text, { anchorDate: ANCHOR }).candidates;
    expect(c).toBeDefined();
    expect(c.category).toBe('imaging');
    expect(Math.round((c.dueAt - ANCHOR) / 86_400_000)).toBe(180);
  }, 90_000);

  test('survives a degraded phone photo — rotated, dim, blurred, compressed', async () => {
    const clean = await renderReport(REPORT_LINES);
    const degraded = await sharp(clean)
      .rotate(2, { background: '#e8e6e0' })
      .resize(700)
      .modulate({ brightness: 0.75 })
      .blur(0.4)
      .jpeg({ quality: 45 })
      .toBuffer();

    const result = await documentText.extractFromUpload(degraded);
    const cands = extract(result.text, { anchorDate: ANCHOR }).candidates;

    expect(cands.length).toBeGreaterThan(0);
    expect(cands[0].action).toMatch(/CT/i);
  }, 90_000);

  test('a blank page is rejected rather than reported as "no follow-ups"', async () => {
    // The dangerous failure is telling someone their report is clear when we
    // simply could not read it.
    const blank = await sharp({
      create: { width: 1000, height: 700, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();

    await expect(documentText.extractFromUpload(blank)).rejects.toThrow(/no text|could not/i);
  }, 90_000);
});

// ─── Scanned PDF fallback (needs sharp + tesseract + mupdf) ──

let mupdfAvailable = false;
if (sharp && ocrAvailable) {
  try {
    const imagePrep = require('../src/services/imagePrep.service');
    // canRasterize is async; probe it synchronously to decide skip/run.
    // We already know mupdf fails to load without --experimental-vm-modules,
    // so try a quick dynamic import to check.
    const m = require('mupdf');
    mupdfAvailable = Boolean(m);
  } catch {
    /* mupdf not available — skip gracefully */
  }
}

const describeIfMupdf = mupdfAvailable ? describe : describe.skip;

describeIfMupdf('scanned PDF fallback', () => {
  const documentText = require('../src/services/documentText.service');
  const ocrService = require('../src/services/ocr.service');

  afterAll(async () => {
    await ocrService.shutdown();
  });

  /** Build a genuine image-only PDF: one embedded JPEG, no text layer. */
  const buildScannedPdf = async (imgBuffer) => {
    const jpg = await sharp(imgBuffer).jpeg({ quality: 88 }).toBuffer();
    const { width: W, height: H } = await sharp(jpg).metadata();

    const objs = {
      1: '<< /Type /Catalog /Pages 2 0 R >>',
      2: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      3: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
    };
    const content = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;

    let pdf = Buffer.from('%PDF-1.4\n');
    const offsets = {};
    const push = (b) => {
      pdf = Buffer.concat([pdf, Buffer.isBuffer(b) ? b : Buffer.from(b)]);
    };

    for (let i = 1; i <= 5; i += 1) {
      offsets[i] = pdf.length;
      if (i === 4) {
        push(
          `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} ` +
            `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`
        );
        push(jpg);
        push('\nendstream\nendobj\n');
      } else if (i === 5) {
        push(`5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
      } else {
        push(`${i} 0 obj\n${objs[i]}\nendobj\n`);
      }
    }

    const xref = pdf.length;
    let table = 'xref\n0 6\n0000000000 65535 f \n';
    for (let i = 1; i <= 5; i += 1) table += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    push(`${table}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);

    return pdf;
  };

  test('detects the missing text layer and falls back to rasterize + OCR', async () => {
    const png = await renderReport([
      'LAB REPORT - SCANNED COPY',
      '',
      'Serum creatinine: 1.9 mg/dL (H)',
      '',
      'IMPRESSION: Renal function is impaired.',
      'Repeat renal function tests in 2 weeks.',
    ]);
    const pdf = await buildScannedPdf(png);

    // It really is a PDF, and it really has no text layer.
    expect(sniffFormat(pdf).kind).toBe('pdf');
    expect(await documentText.readPdfTextLayer(pdf)).toBeNull();

    const result = await documentText.extractFromUpload(pdf);
    expect(result.method).toBe('pdf_ocr');

    const [c] = extract(result.text, { anchorDate: ANCHOR }).candidates;
    expect(c).toBeDefined();
    expect(c.category).toBe('lab');
    expect(c.severity).toBe('urgent'); // 2-week interval is inherently urgent
  }, 120_000);
});
