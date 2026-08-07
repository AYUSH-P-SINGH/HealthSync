/**
 * Image preprocessing + PDF page rasterization.
 *
 * Tesseract is far more accurate on clean, high-contrast, correctly-oriented
 * text than on a raw phone photo. This module does the cheap deterministic
 * cleanup that reliably helps, and deliberately stops short of the clever
 * tricks (adaptive thresholding, deskew-by-Hough) that help some images and
 * quietly destroy others.
 *
 * SECURITY: decompression bombs
 * ─────────────────────────────
 * An image is a compressed description of a pixel buffer, so a 40 KB file can
 * expand to gigabytes in memory. This is the main new attack surface that
 * accepting images introduces, and file-size limits do NOT bound it — only a
 * pixel limit does. `limitInputPixels` is therefore set explicitly on every
 * sharp pipeline rather than left to the library default.
 */
const logger = require('../utils/logger');
const ApiError = require('../utils/ApiError');

/** ~40 MP. Comfortably above any phone camera, far below a bomb. */
const MAX_INPUT_PIXELS = Number(process.env.OCR_MAX_INPUT_PIXELS || 40_000_000);

/** Tesseract wants roughly 300 DPI; upscaling small photos measurably helps. */
const TARGET_WIDTH = 2000;
const MAX_WIDTH = 3500;

/** Rasterization scale for PDF pages — 2x ≈ 144 DPI, enough for body text. */
const RASTER_SCALE = 2;

/** Cap pages we will rasterize+OCR. OCR is expensive; a 200-page scan is abuse. */
const MAX_OCR_PAGES = Number(process.env.OCR_MAX_PDF_PAGES || 10);

let sharpLib = null;
const getSharp = () => {
  if (sharpLib) return sharpLib;
  try {
    // eslint-disable-next-line global-require
    sharpLib = require('sharp');
    // Keep sharp's own concurrency modest — the OCR gate already limits
    // parallelism, and sharp defaults to one thread per core.
    sharpLib.concurrency(2);
    return sharpLib;
  } catch {
    throw ApiError.internal(
      'Image processing is unavailable on this server (sharp is not installed). Please paste the report text instead.'
    );
  }
};

/**
 * Inspect an image without decoding it fully. Cheap, and lets us reject
 * absurd dimensions before allocating a pixel buffer.
 */
const probe = async (buffer) => {
  const sharp = getSharp();
  let meta;
  try {
    meta = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch (err) {
    throw ApiError.badRequest('That image could not be read. Try re-saving it as a JPEG or PNG.');
  }

  const pixels = (meta.width || 0) * (meta.height || 0);
  if (!meta.width || !meta.height) {
    throw ApiError.badRequest('That image has no readable dimensions.');
  }
  if (pixels > MAX_INPUT_PIXELS) {
    throw ApiError.badRequest('That image is too large. Please use a photo under 40 megapixels.');
  }
  /**
   * Reject only images with no chance of legible text — failing fast beats
   * returning "no follow-ups found" from an unreadable thumbnail.
   *
   * Judged on total area plus a modest floor per side, NOT on a square
   * minimum. A cropped strip containing a single line of a report is a
   * perfectly valid upload and can be very short in one dimension; an earlier
   * `height >= 200` rule silently rejected exactly that case.
   */
  const MIN_SIDE = 120;
  const MIN_AREA = 40_000;
  if (meta.width < MIN_SIDE || meta.height < MIN_SIDE || pixels < MIN_AREA) {
    throw ApiError.badRequest('That image is too small to read. Please use a clearer, larger photo.');
  }

  return { width: meta.width, height: meta.height, format: meta.format, pixels };
};

/**
 * Clean an image for OCR.
 *
 * Each step is here because it reliably helps on real photographs:
 *  • rotate()    — applies the EXIF orientation tag. Phone photos are very
 *                  often stored sideways with a flag; without this, OCR reads
 *                  a rotated page and returns gibberish.
 *  • greyscale() — colour carries no information for text and adds noise.
 *  • normalise() — stretches contrast, which is what fixes dim/shadowed photos.
 *  • resize()    — upscales small photos toward Tesseract's preferred density.
 *  • sharpen()   — recovers edge definition lost to JPEG compression.
 *
 * Note the deliberate absence of binarization: a global threshold looks great
 * on evenly-lit scans and obliterates text on a photo with a shadow across it.
 */
const preprocess = async (buffer) => {
  const sharp = getSharp();
  const meta = await probe(buffer);

  try {
    let pipeline = sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .greyscale()
      .normalise();

    if (meta.width < TARGET_WIDTH) {
      pipeline = pipeline.resize({ width: TARGET_WIDTH, withoutEnlargement: false });
    } else if (meta.width > MAX_WIDTH) {
      // Downscale monsters: beyond ~3500px OCR gets slower without getting better.
      pipeline = pipeline.resize({ width: MAX_WIDTH });
    }

    const output = await pipeline.sharpen().png({ compressionLevel: 3 }).toBuffer();

    return { buffer: output, meta };
  } catch (err) {
    logger.warn('Image preprocessing failed', { error: err.message });
    throw ApiError.badRequest('That image could not be processed. Try a different photo or paste the text.');
  }
};

// ─── PDF rasterization (for scanned, image-only PDFs) ────

/**
 * mupdf ships as ESM with top-level await, so it cannot be `require`d from
 * this CommonJS codebase. Dynamic import works and is cached after the first
 * call, keeping the WASM module off the boot path entirely.
 */
let mupdfPromise = null;
const getMuPdf = async () => {
  if (!mupdfPromise) {
    mupdfPromise = import('mupdf')
      .then((m) => m.default || m)
      .catch((err) => {
        mupdfPromise = null;
        logger.warn('mupdf unavailable — scanned PDFs cannot be rasterized', { error: err.message });
        return null;
      });
  }
  return mupdfPromise;
};

const canRasterize = async () => Boolean(await getMuPdf());

/**
 * Render the first N pages of a PDF to PNG buffers.
 *
 * Only called when a PDF has no usable text layer, because rasterizing and
 * OCRing a PDF whose text is already extractable would be slower and less
 * accurate than just reading it.
 *
 * @returns {Promise<{ pages: Buffer[], totalPages: number, truncated: boolean }>}
 */
const rasterizePdf = async (buffer, { maxPages = MAX_OCR_PAGES } = {}) => {
  const mupdf = await getMuPdf();
  if (!mupdf) {
    throw ApiError.badRequest(
      'This looks like a scanned PDF, and page rendering is unavailable on this server. ' +
        'Please upload a photo of the page instead, or paste the report text.'
    );
  }

  let doc;
  try {
    doc = mupdf.Document.openDocument(buffer, 'application/pdf');
  } catch (err) {
    logger.warn('mupdf could not open PDF', { error: err.message });
    throw ApiError.badRequest('This PDF could not be opened. It may be encrypted or corrupted.');
  }

  const totalPages = doc.countPages();
  if (totalPages < 1) throw ApiError.badRequest('This PDF has no pages.');

  const limit = Math.min(totalPages, maxPages);
  const pages = [];

  for (let i = 0; i < limit; i += 1) {
    try {
      const page = doc.loadPage(i);
      const pixmap = page.toPixmap(
        mupdf.Matrix.scale(RASTER_SCALE, RASTER_SCALE),
        mupdf.ColorSpace.DeviceRGB,
        false, // no alpha
        true   // render annotations
      );
      pages.push(Buffer.from(pixmap.asPNG()));
    } catch (err) {
      // A single unrenderable page should not lose the rest of the document.
      logger.warn('Failed to rasterize PDF page', { page: i, error: err.message });
    }
  }

  if (!pages.length) {
    throw ApiError.badRequest('None of the pages in this PDF could be rendered.');
  }

  return { pages, totalPages, truncated: totalPages > limit };
};

module.exports = {
  preprocess,
  probe,
  rasterizePdf,
  canRasterize,
  MAX_INPUT_PIXELS,
  MAX_OCR_PAGES,
};
