# Follow-up Loop Closure

Tracks what a medical report promises for *later* — "repeat CT in 6 months",
"refer to cardiology", "recheck HbA1c in 3 months" — and makes sure someone
actually closes the loop.

## The problem

Actionable incidental findings appear in **5–30%** of imaging studies. Follow-up
completion runs **28–77%**, and as low as **17%** for findings from emergency
department imaging. Up to **70%** of radiology follow-up recommendations are never
completed. Roughly **30%** of office-based, diagnosis-related malpractice claims
trace back to test-follow-up failures, and nearly **50%** of diagnostic-error
cases involve the follow-up and coordination phase rather than the diagnosis
itself.

The diagnosis was correct. The imaging worked. The system just had nowhere to
put a promise that came due in six months.

Why it persists: the recommendation lives in **unstructured prose**, so no EMR
can trigger on it; responsibility is **diffuse** (radiologist assumes the
referrer owns it, referrer has moved on, patient can't parse the PDF); and every
existing fix is **hospital-side and single-institution**, so it dies the moment
the patient walks out.

## Why HealthSync can solve it

The obligation is owned by the **patient**, not the issuing hospital. Hospital A
creates it, the patient presents at Hospital B four months later, and the
obligation is still there. A patient-centric cross-institution record is the only
architecture where that works — which is why this is a structural advantage, not
a feature bolt-on.

## Architecture

```
Input: one file · a whole folder · pasted text · a filed MedicalRecord
       (PDF, JPG, PNG, WebP, HEIC — up to 25 pages / 60 MB per scan)
        │
        ▼
  documentText.service  ── natural-sorts pages, dispatches on SNIFFED type
    ├── PDF w/ text layer  → pdf-parse                    (exact)
    ├── PDF w/o text layer → mupdf rasterize → OCR        (scanned docs)
    └── image              → sharp preprocess → OCR       (phone photos)
        │                     per-file results; one bad page never
        │                     loses the rest of the batch
        ▼
  extractors/            rules-based (default, offline, deterministic)
    ├── rulesExtractor    └─ LLM adapter slot, grounded + validated
    └── llmExtractor
        │
        ▼  candidates + confidence
  followup.service ──────► FollowUpObligation
        │                    status: pending_confirm │ open │ scheduled
        │                            │ completed │ overdue │ dismissed
        ├── auto-close: does a new record satisfy an open obligation?
        └── escalation ladder (T-30 → T-7 → T-0 → T+1 → T+30)
                 │
                 ├── patient  → email + socket + Follow-ups tab
                 └── provider → banner on the chart, once overdue
```

### Files

| Path | Role |
|---|---|
| `constants/followUp.js` | State machine, escalation tiers, confidence gates, limits |
| `models/FollowUpObligation.js` | Schema, transition guard, dedupe key, provider projection |
| `services/extractors/rulesExtractor.js` | Deterministic prose → recommendations |
| `services/extractors/llmExtractor.js` | Optional LLM, hallucination-grounded |
| `services/followup.service.js` | Lifecycle, auto-close, provider access |
| `services/documentText.service.js` | Format dispatch: text layer vs OCR |
| `services/ocr.service.js` | Tesseract worker pool, offline language data |
| `services/imagePrep.service.js` | sharp preprocessing + mupdf rasterization |
| `config/reportUpload.config.js` | Memory-only upload + magic-byte verification |
| `jobs/followupScheduler.js` | The clock |
| `routes/dev.routes.js` | Demo-only clock advance (never in production) |

## Confidence gating

Extraction confidence decides the **entry state**, never whether a candidate is
kept:

| Confidence | Behaviour |
|---|---|
| ≥ 0.80 | `open` — live obligation, clock running |
| 0.45 – 0.79 | `pending_confirm` — patient is asked "did your doctor mean this?" |
| < 0.45 | Discarded |

Both failure modes are harmful and they are **not symmetric**. Inventing an
obligation erodes trust in every other alert — alarm fatigue is how safety
systems die. Dropping one is the exact failure this feature exists to fix. So:
never silently discard anything plausible, never silently *assert* anything
uncertain. The middle band goes to the patient.

The extractor's ceiling is **0.95**. A regex over prose has not earned certainty.

## Reading images and scanned PDFs

Input is dispatched on **sniffed** content type, never the client's claim:

| Input | Path | Typical time | Text quality |
|---|---|---|---|
| PDF with text layer | `pdf-parse` | ~50 ms | Exact |
| PDF without one | mupdf rasterize → OCR | ~2.5 s/page | ~90% legibility |
| Photo (JPG/PNG/WebP/HEIC) | sharp → OCR | ~0.5–3 s | 70–95% legibility |

A PDF whose text is already extractable is **never** OCR'd — that would be
slower *and* less accurate than reading text that is already there. OCR is the
fallback for documents with nothing to read.

**Offline by construction.** Tesseract.js normally fetches its language model
from a CDN on first use — a silent landmine that works in dev and fails on
conference wifi. The model ships as an npm dependency
(`@tesseract.js-data/eng`) and is resolved from `node_modules`, so after
`npm install` there is no network dependency at all.

**Preprocessing** applies EXIF rotation (phone photos are routinely stored
sideways with a flag — without this OCR reads a rotated page and returns
gibberish), greyscale, contrast normalization, upscaling toward Tesseract's
preferred density, and sharpening. Deliberately *not* binarization: a global
threshold looks great on evenly-lit scans and destroys text on a photo with a
shadow across it.

**Honest failure.** Below 55% mean legibility the read is flagged, and a
low-confidence scan that finds nothing says so explicitly rather than reporting
a clean result. Telling someone their report is clear when you simply could not
read it is the worst possible failure here — worse than refusing outright. A
blank or unreadable page is rejected, never reported as "no follow-ups found".

## Folders and multi-page reports

Upload a single file, select several, drag a pile in, or pick a whole folder.
Mixed PDFs and images in one batch are fine.

**Page order is enforced, not assumed.** Files are natural-sorted by filename
on both client and server, so `page10.jpg` never lands before `page2.jpg`. This
is load-bearing: a scrambled report is *worse* than a rejected one, because the
text still reads plausibly and the extractor will happily attach page 10's
recommendation to page 2's finding. Users can also drag to reorder when the
filenames don't reflect the real order.

**Two modes**, offered whenever 2+ files are selected:

| Mode | Behaviour | When |
|---|---|---|
| **Pages of one report** (default) | All pages concatenated, extracted once | A multi-page report. A recommendation on page 3 usually refers to a finding on page 1 — separate extraction would lose that link entirely |
| **Separate reports** | One scan per file, results merged | A folder of unrelated old reports |

**Partial reads are surfaced loudly.** If 3 of 10 pages fail, the other 7 still
process — but the result leads with a warning naming each unread page. The
combination that gets the loudest treatment is *incomplete read + nothing
found*, because the natural reading of "no follow-ups found" is "your report is
clear", and nobody should draw that conclusion from a report the system only
half-read.

**Folder pickers sweep up everything**, so `.DS_Store`, `__MACOSX`,
`Thumbs.db` and `desktop.ini` are filtered silently. Genuinely unsupported or
oversized files are filtered too, but *reported* — so nobody wonders where
their document went.

**Batch limits:** 25 files, 15 MB each, 60 MB total. The aggregate cap matters
independently — 25 files of 14 MB each passes every per-file check and is still
350 MB of buffers held at once.

### New attack surface

| Concern | Mitigation |
|---|---|
| **Decompression bombs** | The main new risk. A 40 KB image can expand to gigabytes of pixels — **file-size limits do not bound this**. `limitInputPixels` is set explicitly (40 MP) on every sharp pipeline. |
| **Format confusion** | Magic bytes decide which parser runs. WebP needs both `RIFF` *and* `WEBP`; HEIC needs `ftyp` *plus* a HEIF brand, since `ftyp` alone also matches MP4. |
| **CPU exhaustion** | OCR is CPU-bound and would saturate the event loop. Max 2 concurrent jobs; the rest queue. Two OCR jobs fighting for one core finish later than the same two in sequence, and starve every other request meanwhile. |
| **Wedged workers** | 45 s per-image timeout. Tesseract has no cancel, so on timeout the worker is destroyed rather than left in the pool for the next request to inherit. |
| **Memory** | Worker is lazily created, shared, and torn down after 5 min idle (~50 MB reclaimed). |
| **Malicious PDFs** | mupdf runs as WASM — a sandboxed parser, not a native one. Page count and raster scale are both capped. |
| **Unrenderable pages** | A single bad page is skipped and logged; the rest of the document still processes. |
| **Batch exhaustion** | 25 files / 60 MB aggregate, enforced separately from the per-file cap — multer's `files` limit bounds count but not total bytes. |

## Security

| Concern | Mitigation |
|---|---|
| **IDOR** | Every query carries its ownership predicate (`{ _id, patient }`). No code path fetches by id alone. |
| **Enumeration** | Someone else's obligation returns `404`, not `403` — a 403 confirms the id exists. |
| **Provider over-reach** | Access re-derived from an active link or live consent grant on *every* call. Patient id is never taken from the request. |
| **Read/write scope drift** | Provider mutations re-check the same `providerVisible` predicate used for reads. |
| **Over-disclosure** | Providers get `toProviderJSON()` — no notification history, no extractor internals. Only *overdue* items surface. |
| **PHI at rest** | Report PDFs are parsed in memory and discarded. No filename from user input, so path traversal is structurally impossible. |
| **File spoofing** | Declared MIME is a first pass only; `%PDF-` magic bytes are the authority. |
| **ReDoS** | Bounded quantifiers over disjoint classes, no nested unbounded quantifiers. Tested: 45 000-char hostile input parses in ~2 ms. |
| **DoS** | Per-**user** rate limit (20/15 min) — IP keying would punish a shared clinic and barely inconvenience an attacker. Caps on file size, pages, text length, obligations per record and per patient. |
| **LLM hallucination** | Any item whose claimed `sourceText` is not verbatim in the report is dropped. Self-reported confidence is capped. |
| **Silent dismissal** | Reason mandatory (≥5 chars), actor recorded, audit-logged. |
| **Audit** | 11 new `AuditLog` actions covering every transition. |
| **Dev endpoints** | Triple-gated: not required in production, re-checks `NODE_ENV`, still needs an authenticated session, and only touches the caller's own data. |

## Scan button placement

Deliberately **not** on every page — a global action button competes with each
screen's primary CTA and loses meaning. Actions belong where their object lives:

- **Follow-ups tab** — primary. This is the feature's home.
- **Records view** — secondary, styled subordinate to "Add Record". Users arrive
  here holding a report, so it's the second place they'd look.
- **Hospital records panel** — beside "Add record", since both answer "I have a
  report in my hand, what now?"

The **safety net banner** is different: it renders above the records, is never a
tab, and renders *nothing at all* when there are no overdue loops. A banner
that's always present becomes furniture, and furniture doesn't get read.

## API

**Patient**
```
GET    /api/patients/followups?status=active|overdue|pending_confirm
POST   /api/patients/followups/scan          multipart `report` (1..25 files) | JSON `text`
PATCH  /api/patients/followups/:id/confirm
PATCH  /api/patients/followups/:id/schedule
PATCH  /api/patients/followups/:id/complete
PATCH  /api/patients/followups/:id/dismiss   { reason }   (required)
```

**Hospital**
```
GET    /api/hospitals/followups?linkId=…  |  ?consentId=…
PATCH  /api/hospitals/followups/:id       { action, linkId|consentId, reason? }
POST   /api/hospitals/patients/:linkId/followups/scan
```

**Dev only**
```
POST   /api/dev/followups/advance-clock   { days }
POST   /api/dev/followups/sweep
```

## Setup

```bash
cd Backend && npm install     # pdf-parse, tesseract.js + eng data, sharp, mupdf
npm run dev
```

No API keys, no system binaries (no Ghostscript or ImageMagick), no CDN
downloads. `sharp` and the OCR language data ship prebuilt via npm.

Optional in `.env`:

```env
FOLLOWUP_SWEEP_INTERVAL_MS=60000   # 1 min while demoing
```

LLM extraction is off by default and needs no key. The rule extractor is
deterministic and runs offline.

## Demo script

1. **Follow-ups → Scan a report.** Hand a judge a *printed* report and let them
   photograph it with their phone — the camera button goes straight to the
   capture UI. (Or upload a PDF where the recommendation is buried in paragraph
   four and let them hunt for it first.)
2. **Preview.** The extractor surfaces the finding, the due date it computed, the
   verbatim sentence it came from, and how the text was read ("Photo — read by
   OCR · 94% legibility"). Nothing is stored yet — click **Track**.
3. **Fast-forward.** Hit `+200 days` (dev only). The escalation ladder fires for
   real: status flips to overdue, the reminder email goes out, the socket event
   lands.
4. **Switch to the hospital dashboard.** Log in as a *different* hospital, open
   the patient for an unrelated complaint. The overdue loop is sitting at the top
   of the chart, attributed to the hospital that issued it.
5. **Close on the number:** 70% never completed — and this is why.

## Testing

```bash
cd Backend && npm test              # all suites (integration ones need MongoDB)
npm test -- tests/followup.test.js tests/ocr.test.js   # no DB required
```

**75 tests**, no database needed:

- `followup.test.js` (35) — true positives, false-positive rejection (negation,
  past tense, hedging, boilerplate), bounds, ReDoS, LLM hallucination grounding,
  state machine.
- `ocr.test.js` (16) — magic-byte sniffing including WebP/HEIC container
  confusion and renamed executables, preprocessing guards, a clean image
  end-to-end, a deliberately degraded phone photo (rotated, dim, blurred, 45%
  JPEG), blank-page rejection, and a hand-built image-only PDF proving the
  rasterize fallback.
- `batchScan.test.js` (24) — natural sort (`page10` after `page2`, `IMG_0003`
  conventions, folder paths), junk filtering, aggregate limits, and the
  cross-page case: a finding on page 1 correctly linked to a recommendation on
  page 2, supplied deliberately out of order.

Fixtures are generated at runtime with sharp — no binaries committed.

Note `npm test` now runs Jest under `--experimental-vm-modules`, required
because mupdf is an ESM module with top-level await.

## Known limits

- **OCR is English-only.** Trigger and timeframe patterns are English too, so a
  Hindi or regional-language report will scan but find nothing. Adding a
  language is one npm package plus a `langPath` entry.
- **Handwriting.** Tesseract reads printed text well and handwriting badly.
  Handwritten prescriptions — very common in Indian outpatient settings — are
  effectively out of scope for OCR and should be entered by hand.
- **Multi-instance.** The scheduler runs in-process. Notifications stay safe on
  two instances (the ledger dedupes) but the work is duplicated. Add a Mongo TTL
  lock or Redis `SETNX` around `runSweep` before scaling out. Left out rather
  than half-implemented — a lock that looks correct but isn't is worse than an
  honest note.
- **English only.** Trigger and timeframe patterns are English-language.
- **Auto-close is conservative by design.** Three independent conditions must all
  hold. A false auto-close turns a loop green while the obligation is still
  unmet, which is more dangerous than never having tracked it.

## Sources

- [Managing Incidental Findings — Applied Radiology](https://appliedradiology.com/articles/managing-incidental-findings)
- [Closing the loop on incidental imaging findings — AuntMinnie](https://www.auntminnie.com/senl/article/15636228/closing-the-loop-on-incidental-imaging-findings)
- [The FIND Program — NIH/PMC](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10287591/)
- [Actionable Incidental Findings in ED Imaging — JACR](https://www.jacr.org/article/S1546-1440(23)00123-0/fulltext)
- [Patient Notification and Follow-up of Abnormal Test Results — MICA](https://www.mica-insurance.com/blog/posts/patient-notification-and-follow-up-of-abnormal-test-results/)
- [Missed diagnosis most common malpractice accusation — Harvard Medical School](https://hms.harvard.edu/news/missed-diagnosis-most-common-malpractice-accusation)
