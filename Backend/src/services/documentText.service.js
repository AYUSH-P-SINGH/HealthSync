/**
 * Document text extraction — turns an uploaded report into plain prose the
 * follow-up extractor can read.
 *
 * Three input paths, chosen by SNIFFED content type rather than by whatever
 * the client claimed:
 *
 *   PDF with a text layer   → pdf-parse                  (fast, exact)
 *   PDF without one         → rasterize pages → OCR      (scanned documents)
 *   Photo / scan image      → preprocess → OCR           (phone photos)
 *
 * The ordering matters. A PDF whose text is already extractable is read
 * directly, never OCR'd — OCR of a digital PDF is slower AND less accurate
 * than simply reading the text that is already there. OCR is the fallback for
 * documents that have no text to read, not a general-purpose path.
 *
 * Every return value carries `method` and `confidence` so the UI can be honest
 * about how the text was obtained. Text read from a PDF's own text layer is
 * exact; text read from a photograph is a guess with an error rate, and the
 * interface should not present those two as equivalent.
 */
const logger = require('../utils/logger');
const ApiError = require('../utils/ApiError');
const { LIMITS } = require('../constants/followUp');
const { verifyReportBuffer } = require('../config/reportUpload.config');
const ocrService = require('./ocr.service');
const imagePrep = require('./imagePrep.service');

/**
 * pdf-parse pulls in a sizeable dependency tree. Loading it lazily keeps it
 * off the boot path, so the API starts (and tests run) even if it is not
 * installed — the scan endpoint then fails with a clear message instead of
 * the whole server refusing to start.
 */
let pdfParse = null;
const loadPdfParser = () => {
  if (pdfParse) return pdfParse;
  try {
    // eslint-disable-next-line global-require
    pdfParse = require('pdf-parse');
    return pdfParse;
  } catch {
    throw ApiError.internal(
      'PDF scanning is unavailable on this server (pdf-parse is not installed). You can paste the report text instead.'
    );
  }
};

/** Hard ceiling on pages read from a PDF's text layer. */
const MAX_PAGES = 60;

/**
 * Minimum characters before we believe a PDF genuinely has a text layer.
 * Scanned PDFs often carry a few stray characters — a header stamp, a page
 * number — which would otherwise look like success and cause us to skip OCR
 * and report "no follow-ups found" on a document we never actually read.
 */
const MIN_TEXT_LAYER_CHARS = 120;

/**
 * Control characters that must be stripped from any text we store or log.
 * \t (09) and \n (0A) are deliberately preserved: they carry the report's
 * line structure, which the extractor's PDF-unwrap step depends on.
 */
const CONTROL_CHARS = new RegExp(
  '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]',
  'g'
);

const clean = (s) => String(s || '').replace(CONTROL_CHARS, ' ').trim();

// ─── PDF: text layer ─────────────────────────────────────

/** Returns null (rather than throwing) when there is no usable text layer. */
const readPdfTextLayer = async (buffer) => {
  const parser = loadPdfParser();

  let parsed;
  try {
    parsed = await parser(buffer, { max: MAX_PAGES });
  } catch (err) {
    logger.warn('PDF text-layer parse failed; will try rasterizing', { error: err.message });
    return null;
  }

  const raw = clean(parsed.text);
  if (raw.length < MIN_TEXT_LAYER_CHARS) return null;

  return {
    text: raw.slice(0, LIMITS.MAX_TEXT_CHARS),
    pages: parsed.numpages || 0,
    method: 'pdf_text',
    confidence: 100, // read directly from the document, not inferred
    truncated: raw.length > LIMITS.MAX_TEXT_CHARS,
  };
};

// ─── PDF: rasterize + OCR ────────────────────────────────

const readScannedPdf = async (buffer) => {
  const { pages, totalPages, truncated } = await imagePrep.rasterizePdf(buffer);

  const parts = [];
  const confidences = [];

  for (let i = 0; i < pages.length; i += 1) {
    // Rasterized pages are already clean and correctly oriented, but the
    // greyscale + contrast pass still helps on faxed or low-quality scans.
    const { buffer: prepped } = await imagePrep.preprocess(pages[i]);
    const { text, confidence } = await ocrService.recognize(prepped, { label: `pdf-page-${i + 1}` });
    if (text) {
      parts.push(text);
      confidences.push(confidence);
    }
  }

  const joined = clean(parts.join('\n\n'));
  const avgConfidence = confidences.length
    ? confidences.reduce((a, b) => a + b, 0) / confidences.length
    : 0;

  if (joined.length < 40) {
    throw ApiError.badRequest(
      'No readable text could be recovered from this scanned PDF. The scan may be too faint — try photographing the page directly, or paste the report text.'
    );
  }

  return {
    text: joined.slice(0, LIMITS.MAX_TEXT_CHARS),
    pages: pages.length,
    totalPages,
    method: 'pdf_ocr',
    confidence: avgConfidence,
    truncated: truncated || joined.length > LIMITS.MAX_TEXT_CHARS,
    lowConfidence: avgConfidence < ocrService.MIN_CONFIDENCE,
  };
};

// ─── Image: preprocess + OCR ─────────────────────────────

const readImage = async (buffer) => {
  const { buffer: prepped, meta } = await imagePrep.preprocess(buffer);
  const { text, confidence, ms } = await ocrService.recognize(prepped, { label: 'photo' });

  const cleaned = clean(text);

  if (cleaned.length < 40) {
    throw ApiError.badRequest(
      'Almost no text could be read from that image. Try a straighter, better-lit photo of the page — or paste the report text instead.'
    );
  }

  return {
    text: cleaned.slice(0, LIMITS.MAX_TEXT_CHARS),
    pages: 1,
    method: 'image_ocr',
    confidence,
    ms,
    dimensions: `${meta.width}x${meta.height}`,
    truncated: cleaned.length > LIMITS.MAX_TEXT_CHARS,
    lowConfidence: confidence < ocrService.MIN_CONFIDENCE,
  };
};

// ─── Public entry point ──────────────────────────────────

/**
 * Extract text from any supported uploaded report.
 *
 * @param {Buffer} buffer  Raw uploaded bytes
 * @returns {Promise<{ text, method, confidence, pages, lowConfidence? }>}
 */
const extractFromUpload = async (buffer) => {
  // Content sniffing, not the client's claim, decides which parser runs.
  const format = verifyReportBuffer(buffer);

  if (format.kind === 'pdf') {
    const textLayer = await readPdfTextLayer(buffer);
    if (textLayer) return textLayer;

    // No usable text layer — this is a scanned document.
    logger.info('PDF has no text layer; falling back to rasterize + OCR');
    return readScannedPdf(buffer);
  }

  return readImage(buffer);
};

/** Back-compat wrapper for callers that only ever deal with PDFs. */
const extractPdfText = async (buffer) => extractFromUpload(buffer);

// ─── Batch / folder ingestion ────────────────────────────

/**
 * Natural (human) sort by filename.
 *
 * Plain lexicographic order puts `page10.jpg` before `page2.jpg`, which would
 * silently scramble a multi-page report — and a scrambled report is worse than
 * a rejected one, because the text still looks plausible and the extractor
 * will happily attach page 10's recommendation to page 2's finding.
 *
 * Also strips any directory component: browser folder uploads send paths like
 * `scans/2026/page1.jpg`, and only the leaf name should drive ordering.
 */
const naturalCompare = (a, b) => {
  const leaf = (s) => String(s || '').split(/[\\/]/).pop();
  return leaf(a).localeCompare(leaf(b), undefined, { numeric: true, sensitivity: 'base' });
};

/** Files a folder picker sweeps up that are never medical reports. */
const JUNK_NAMES = /^(\.|__MACOSX|Thumbs\.db$|desktop\.ini$|\.DS_Store$)/i;

const isJunk = (name) => JUNK_NAMES.test(String(name || '').split(/[\\/]/).pop());

/**
 * Read every file in a batch, in page order, tolerating individual failures.
 *
 * Returns per-file outcomes rather than a single blob, because the caller has
 * to be able to tell the user exactly which pages were skipped. A partial read
 * reported as a complete one is the most dangerous output this whole feature
 * can produce: "no follow-ups found" from a report we only half-read would let
 * someone conclude they are in the clear.
 *
 * @param {Array<{originalname: string, buffer: Buffer, size: number}>} files
 * @returns {Promise<{ results: Array, readCount: number, failedCount: number }>}
 */
const readBatch = async (files = []) => {
  const ordered = files
    .filter((f) => f && f.buffer && !isJunk(f.originalname))
    .sort((a, b) => naturalCompare(a.originalname, b.originalname));

  const results = [];

  for (let i = 0; i < ordered.length; i += 1) {
    const file = ordered[i];
    const name = String(file.originalname || `page-${i + 1}`).split(/[\\/]/).pop();

    try {
      const extracted = await extractFromUpload(file.buffer);
      results.push({
        name,
        order: i + 1,
        ok: true,
        text: extracted.text,
        method: extracted.method,
        confidence: extracted.confidence,
        pages: extracted.pages || 1,
        lowConfidence: Boolean(extracted.lowConfidence),
      });
    } catch (err) {
      // One unreadable page must not lose the other nine.
      logger.warn('Batch scan: file could not be read', { name, error: err.message });
      results.push({
        name,
        order: i + 1,
        ok: false,
        // ApiError messages are written for users; anything else is internal
        // and should not be echoed back verbatim.
        reason: err.isOperational ? err.message : 'This file could not be read.',
      });
    }
  }

  return {
    results,
    readCount: results.filter((r) => r.ok).length,
    failedCount: results.filter((r) => !r.ok).length,
  };
};

/**
 * Merge a batch into ONE document's worth of text.
 *
 * Page markers are inserted between files. They give the extractor clean
 * sentence boundaries (so a heading at the top of page 2 cannot glue itself to
 * the last line of page 1) and they keep `sourceText` legible if a
 * recommendation happens to sit right at a page break.
 */
const combineBatchText = (results) => {
  const parts = results
    .filter((r) => r.ok && r.text)
    .map((r) => `--- ${r.name} ---\n${r.text}`);

  return clean(parts.join('\n\n')).slice(0, LIMITS.MAX_TEXT_CHARS);
};

/** Mean legibility across successfully-read files, weighted equally. */
const averageConfidence = (results) => {
  const scores = results.filter((r) => r.ok && typeof r.confidence === 'number').map((r) => r.confidence);
  if (!scores.length) return 0;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
};

/**
 * Sanitize pasted text. Strips control characters and caps length.
 *
 * Note we do NOT HTML-escape here. This text is stored and string-compared,
 * never interpolated into markup, and escaping at the wrong layer would
 * corrupt `sourceText` — the verbatim provenance a clinician relies on to
 * audit an extraction. Escaping belongs at render time, in the client.
 */
const sanitizePastedText = (input) => {
  const text = clean(input).slice(0, LIMITS.MAX_TEXT_CHARS);

  if (text.length < 20) {
    throw ApiError.badRequest('Please paste at least a sentence or two of the report.');
  }
  return text;
};

module.exports = {
  extractFromUpload,
  extractPdfText,
  sanitizePastedText,
  readPdfTextLayer,
  readImage,
  readScannedPdf,
  readBatch,
  combineBatchText,
  averageConfidence,
  naturalCompare,
  isJunk,
  MAX_PAGES,
  MIN_TEXT_LAYER_CHARS,
  CONTROL_CHARS,
};
