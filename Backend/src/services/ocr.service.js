/**
 * OCR service — reads text out of photographed and scanned reports.
 *
 * OFFLINE BY CONSTRUCTION
 * ───────────────────────
 * Tesseract.js normally fetches its language model from a CDN on first use.
 * That is a silent landmine: it works on the developer's machine, then fails
 * on conference wifi at exactly the wrong moment. Instead we resolve
 * `@tesseract.js-data/eng` out of node_modules and point `langPath` at it, so
 * after `npm install` there is no network dependency at all.
 *
 * WORKER LIFECYCLE
 * A Tesseract worker costs ~200 ms to spin up and holds ~50 MB resident.
 * Creating one per request wastes both; keeping one forever wastes memory on
 * an app that mostly isn't doing OCR. So: lazily created, shared across
 * requests, and torn down after a period of inactivity.
 *
 * CONCURRENCY
 * OCR is CPU-bound and will happily saturate the event loop's thread pool.
 * Requests beyond the cap queue rather than compete, because two OCR jobs
 * fighting for one core finish later than the same two run in sequence — and
 * meanwhile every other API request is starved.
 */
const path = require('path');
const os = require('os');
const fs = require('fs');
const logger = require('../utils/logger');
const ApiError = require('../utils/ApiError');

const IDLE_TEARDOWN_MS = Number(process.env.OCR_IDLE_TEARDOWN_MS || 5 * 60 * 1000);
const OCR_TIMEOUT_MS = Number(process.env.OCR_TIMEOUT_MS || 45_000);
const MAX_CONCURRENT = Number(process.env.OCR_MAX_CONCURRENT || 2);

/**
 * Below this, OCR output is too unreliable to build clinical reminders from.
 * Tesseract reports mean per-word confidence; blurry or badly-lit photos
 * typically land in the 40s–60s, clean scans in the high 80s and above.
 */
const MIN_CONFIDENCE = Number(process.env.OCR_MIN_CONFIDENCE || 55);

let worker = null;
let workerPromise = null;
let idleTimer = null;
let active = 0;
const queue = [];

/**
 * Locate the bundled English traineddata. Returns null if the package is
 * missing, in which case OCR is disabled with a clear message rather than
 * silently falling back to a network fetch that may hang.
 */
const resolveLangPath = () => {
  try {
    const pkgDir = path.dirname(require.resolve('@tesseract.js-data/eng/package.json'));
    // Prefer the higher-accuracy "best" model; fall back to the fast one.
    for (const variant of ['4.0.0_best_int', '4.0.0']) {
      const dir = path.join(pkgDir, variant);
      if (fs.existsSync(path.join(dir, 'eng.traineddata.gz'))) return dir;
    }
    return null;
  } catch {
    return null;
  }
};

const isAvailable = () => resolveLangPath() !== null;

const scheduleIdleTeardown = () => {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    if (active > 0 || !worker) return;
    try {
      await worker.terminate();
      logger.info('OCR worker torn down after idle period');
    } catch {
      /* terminating an already-dead worker is not an error worth surfacing */
    } finally {
      worker = null;
      workerPromise = null;
    }
  }, IDLE_TEARDOWN_MS);
  idleTimer.unref?.();
};

/** Lazily create the shared worker. Concurrent callers share one promise. */
const getWorker = async () => {
  if (worker) return worker;
  if (workerPromise) return workerPromise;

  const langPath = resolveLangPath();
  if (!langPath) {
    throw ApiError.internal(
      'Image scanning is unavailable on this server (OCR language data is not installed). ' +
        'Run `npm install` in the Backend folder, or paste the report text instead.'
    );
  }

  workerPromise = (async () => {
    // eslint-disable-next-line global-require
    const { createWorker } = require('tesseract.js');
    const started = Date.now();

    const w = await createWorker('eng', 1, {
      langPath,
      gzip: true,
      cachePath: path.join(os.tmpdir(), 'healthsync-ocr-cache'),
      // Tesseract's own logger is extremely chatty; route only failures to ours.
      errorHandler: (err) => logger.error('OCR worker error', { error: String(err) }),
    });

    logger.info('OCR worker ready', { ms: Date.now() - started, langPath });
    worker = w;
    return w;
  })();

  try {
    return await workerPromise;
  } catch (err) {
    workerPromise = null;
    logger.error('OCR worker failed to start', { error: err.message });
    throw ApiError.internal('Image scanning could not start. Please paste the report text instead.');
  }
};

/** Simple FIFO gate so OCR jobs queue instead of thrashing the CPU. */
const acquireSlot = () =>
  new Promise((resolve) => {
    if (active < MAX_CONCURRENT) {
      active += 1;
      resolve();
    } else {
      queue.push(resolve);
    }
  });

const releaseSlot = () => {
  const next = queue.shift();
  if (next) next();
  else active -= 1;
};

/**
 * Run OCR over an image buffer.
 *
 * @param {Buffer} buffer  PNG/JPEG/WebP image bytes (already preprocessed)
 * @param {{ label?: string }} options
 * @returns {Promise<{ text: string, confidence: number, ms: number }>}
 */
const recognize = async (buffer, { label = 'image' } = {}) => {
  await acquireSlot();
  if (idleTimer) clearTimeout(idleTimer);

  const started = Date.now();
  try {
    const w = await getWorker();

    // A pathological image must not pin a worker forever. Tesseract has no
    // native cancel, so on timeout we destroy the worker rather than leave a
    // wedged one in the pool for the next request to inherit.
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(async () => {
        try {
          await worker?.terminate();
        } catch { /* already gone */ }
        worker = null;
        workerPromise = null;
        reject(ApiError.badRequest('Reading this image took too long. Try a smaller or clearer photo.'));
      }, OCR_TIMEOUT_MS);
      timer.unref?.();
    });

    const { data } = await Promise.race([w.recognize(buffer), timeout]);
    clearTimeout(timer);

    const text = String(data.text || '').trim();
    const confidence = Number(data.confidence || 0);
    const ms = Date.now() - started;

    logger.info('OCR complete', { label, ms, confidence: confidence.toFixed(1), chars: text.length });

    return { text, confidence, ms };
  } finally {
    releaseSlot();
    scheduleIdleTeardown();
  }
};

/** Called from the server's graceful shutdown path. */
const shutdown = async () => {
  if (idleTimer) clearTimeout(idleTimer);
  if (worker) {
    try {
      await worker.terminate();
    } catch { /* best effort */ }
    worker = null;
    workerPromise = null;
  }
};

module.exports = {
  recognize,
  isAvailable,
  shutdown,
  resolveLangPath,
  MIN_CONFIDENCE,
  _state: () => ({ active, queued: queue.length, warm: Boolean(worker) }),
};
