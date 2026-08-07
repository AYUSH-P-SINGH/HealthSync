/**
 * Report upload configuration — the "Scan report" ingestion path.
 *
 * Accepts PDFs and photographs/scans of reports (JPEG, PNG, WebP, HEIC).
 *
 * SECURITY DECISION 1: memory storage, never disk.
 * ───────────────────────────────────────────────
 * The existing profile-picture uploader writes to disk, which is correct for
 * avatars. It is the wrong choice here. A radiology report is PHI, and we only
 * need its text for a few seconds. Keeping it in a Buffer and letting it be
 * garbage-collected means:
 *
 *   • no PHI at rest, so no retention policy, no encryption-at-rest question,
 *     and nothing to leak if `/uploads` is ever mis-served or backed up
 *   • no filename derived from user input, so path traversal is not merely
 *     mitigated but structurally impossible — there is no path
 *   • no orphaned files accumulating from failed parses
 *
 * SECURITY DECISION 2: magic bytes decide the format, not the client.
 * ──────────────────────────────────────────────────────────────────
 * The declared MIME type and the file extension are both attacker-controlled.
 * Everything downstream — which parser runs, whether we hand bytes to sharp —
 * branches on the *sniffed* type instead. A `.pdf` that is really a PNG gets
 * treated as a PNG, and anything we cannot identify is refused outright.
 */
const multer = require('multer');
const ApiError = require('../utils/ApiError');

/**
 * 15 MB. Larger than the old PDF-only limit because phone photos are big,
 * but note this does NOT bound memory for images — a small file can decode to
 * an enormous pixel buffer. That risk is handled by the pixel cap in
 * imagePrep.service.js; file size alone is not a defence.
 */
const MAX_REPORT_BYTES = 15 * 1024 * 1024;

const ALLOWED_MIMES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];

/**
 * Signature table. `offset` is where the magic bytes start.
 * WebP and HEIC are container formats, so they need a second check beyond
 * the first few bytes — RIFF alone could be a WAV, and `ftyp` alone could be
 * an MP4, neither of which should reach an image decoder.
 */
const SIGNATURES = [
  { kind: 'pdf', mime: 'application/pdf', offset: 0, bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // %PDF-
  { kind: 'jpeg', mime: 'image/jpeg', offset: 0, bytes: [0xff, 0xd8, 0xff] },
  { kind: 'png', mime: 'image/png', offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  {
    kind: 'webp',
    mime: 'image/webp',
    offset: 0,
    bytes: [0x52, 0x49, 0x46, 0x46], // "RIFF"
    also: { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] }, // "WEBP"
  },
  {
    kind: 'heic',
    mime: 'image/heic',
    offset: 4,
    bytes: [0x66, 0x74, 0x79, 0x70], // "ftyp"
    // Brand must be a HEIF/HEIC one — plain "ftyp" also matches MP4/MOV.
    brands: ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'],
  },
];

const matchesAt = (buffer, offset, bytes) => {
  if (buffer.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i += 1) {
    if (buffer[offset + i] !== bytes[i]) return false;
  }
  return true;
};

/**
 * Identify a buffer by content. Returns { kind, mime } or null.
 * This is the single source of truth for "what is this file".
 */
const sniffFormat = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;

  for (const sig of SIGNATURES) {
    if (!matchesAt(buffer, sig.offset, sig.bytes)) continue;
    if (sig.also && !matchesAt(buffer, sig.also.offset, sig.also.bytes)) continue;

    if (sig.brands) {
      const brand = buffer.subarray(8, 12).toString('latin1').toLowerCase();
      if (!sig.brands.includes(brand)) continue;
    }

    return { kind: sig.kind, mime: sig.mime };
  }
  return null;
};

/**
 * Declared MIME is only a cheap first pass — it rejects obvious junk before
 * multer buffers 15 MB. The authoritative check is verifyReportBuffer().
 */
const fileFilter = (req, file, cb) => {
  if (!ALLOWED_MIMES.includes(file.mimetype)) {
    return cb(
      ApiError.badRequest('Please upload a PDF, or a photo of the report (JPG, PNG, WebP or HEIC).'),
      false
    );
  }
  return cb(null, true);
};

/**
 * Batch limits. A folder upload is usually a multi-page report photographed
 * page by page, so 25 pages is generous; beyond that it is a bulk import,
 * which is a different feature with different performance characteristics.
 *
 * The aggregate cap matters independently of the per-file cap: 25 files of
 * 14 MB each would be 350 MB of buffers held in memory at once.
 */
const MAX_BATCH_FILES = Number(process.env.SCAN_MAX_BATCH_FILES || 25);
const MAX_BATCH_BYTES = Number(process.env.SCAN_MAX_BATCH_BYTES || 60 * 1024 * 1024);

const reportUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_REPORT_BYTES,
    files: MAX_BATCH_FILES,
    fields: 12,      // bound the multipart body
    parts: MAX_BATCH_FILES + 12,
    headerPairs: 60,
  },
  fileFilter,
});

/**
 * Multer's `files` limit bounds the count but not the total bytes. Enforce the
 * aggregate separately, before anything is decoded.
 */
const verifyBatchSize = (files = []) => {
  if (files.length > MAX_BATCH_FILES) {
    throw ApiError.badRequest(`Please upload at most ${MAX_BATCH_FILES} pages at a time.`);
  }
  const total = files.reduce((sum, f) => sum + (f.size || 0), 0);
  if (total > MAX_BATCH_BYTES) {
    throw ApiError.badRequest(
      `Those files add up to ${(total / 1024 / 1024).toFixed(0)} MB. Please keep a batch under ${Math.round(MAX_BATCH_BYTES / 1024 / 1024)} MB.`
    );
  }
  return true;
};

/**
 * Authoritative content check. Throws unless the bytes really are one of the
 * formats we support; returns the sniffed format for the caller to dispatch on.
 */
const verifyReportBuffer = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) {
    throw ApiError.badRequest('The uploaded file is empty or unreadable.');
  }
  if (buffer.length > MAX_REPORT_BYTES) {
    throw ApiError.badRequest('Report is too large. Maximum size is 15 MB.');
  }

  const format = sniffFormat(buffer);
  if (!format) {
    throw ApiError.badRequest(
      'That file type is not supported. Upload a PDF, or a photo of the report (JPG, PNG, WebP or HEIC), or paste the report text.'
    );
  }
  return format;
};

/** Kept for callers that specifically require a PDF. */
const verifyPdfBuffer = (buffer) => {
  const format = verifyReportBuffer(buffer);
  if (format.kind !== 'pdf') {
    throw ApiError.badRequest('That file is not a valid PDF.');
  }
  return true;
};

/**
 * Translate multer's own errors into our ApiError shape so the client gets a
 * useful message instead of a raw MulterError.
 */
const handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(ApiError.badRequest('One of those files is over 15 MB. Please use smaller images.'));
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return next(ApiError.badRequest(`Please upload at most ${MAX_BATCH_FILES} pages at a time.`));
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return next(ApiError.badRequest('Unexpected upload field. Send files as `report`.'));
    }
    return next(ApiError.badRequest(`Upload failed: ${err.message}`));
  }
  return next(err);
};

module.exports = {
  reportUpload,
  verifyReportBuffer,
  verifyPdfBuffer,
  verifyBatchSize,
  sniffFormat,
  handleUploadError,
  MAX_REPORT_BYTES,
  MAX_BATCH_FILES,
  MAX_BATCH_BYTES,
  ALLOWED_MIMES,
};
