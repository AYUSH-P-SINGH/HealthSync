import { useEffect, useRef, useState } from "react";
import {
  X, Upload, FileText, Loader2, CircleAlert, ScanLine,
  CalendarClock, CheckCircle2, Info, ClipboardPaste, ImageIcon, Camera,
  TriangleAlert, FolderOpen, GripVertical, Trash2, Layers, Files,
} from "lucide-react";
import { patientApi, hospitalApi } from "../lib/api.js";

/**
 * Scan a medical report for follow-up recommendations.
 *
 * Two-phase by design: PREVIEW then SAVE.
 *
 * The extractor is reading prose and can be wrong, so nothing is stored until
 * the person has seen exactly what was found and the verbatim sentence it came
 * from. A system that silently created clinical reminders from a regex would
 * deserve to be distrusted the first time it got one wrong — and it will get
 * one wrong. Showing the source sentence makes the extraction auditable by the
 * only person who has the actual report in front of them.
 */

const SEVERITY_STYLES = {
  critical: { chip: "bg-rose-50 text-rose-700 border-rose-200", dot: "bg-rose-500" },
  urgent: { chip: "bg-amber-50 text-amber-700 border-amber-200", dot: "bg-amber-500" },
  routine: { chip: "bg-sky-50 text-sky-700 border-sky-200", dot: "bg-sky-500" },
};

const CATEGORY_LABELS = {
  imaging: "Imaging",
  lab: "Lab test",
  consult: "Consultation",
  procedure: "Procedure",
  medication: "Medication",
  other: "Follow-up",
};

const formatDate = (value) =>
  new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

const todayISO = () => new Date().toISOString().slice(0, 10);

const ACCEPTED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
];

const MAX_BYTES = 15 * 1024 * 1024;
const MAX_FILES = 25;
const MAX_TOTAL_BYTES = 60 * 1024 * 1024;

/** Files a folder picker sweeps up that are never medical reports. */
const isJunkName = (name) =>
  /^(\.|__MACOSX)/.test(name) || /^(Thumbs\.db|desktop\.ini)$/i.test(name);

const looksAccepted = (f) =>
  ACCEPTED_TYPES.includes(f.type) || /\.(pdf|jpe?g|png|webp|heic|heif)$/i.test(f.name || "");

/**
 * Natural sort so page2 comes before page10.
 *
 * This mirrors the server's ordering exactly. Lexicographic order would
 * scramble a multi-page report, and a scrambled report is worse than a
 * rejected one — the text still reads plausibly, so the extractor happily
 * attaches page 10's recommendation to page 2's finding.
 */
const naturalSort = (a, b) =>
  (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name, undefined, {
    numeric: true,
    sensitivity: "base",
  });

/**
 * How the backend read the file. Surfaced to the user because these are not
 * equivalent: a PDF text layer is exact, OCR is a best-effort guess with a
 * real error rate. Presenting them identically would imply a confidence the
 * system hasn't got.
 */
const METHOD_META = {
  pdf_text: { label: "Read from PDF text", exact: true },
  pdf_ocr: { label: "Scanned PDF — read by OCR", exact: false },
  image_ocr: { label: "Photo — read by OCR", exact: false },
  pasted: { label: "Pasted text", exact: true },
};


export default function ScanReportModal({
  open,
  onClose,
  onSaved,
  accessToken,
  /** Hospital mode: pass a linkId to scan on behalf of a linked patient. */
  linkId = null,
  heading = "Scan a report for follow-ups",
}) {
  const [mode, setMode] = useState("file"); // "file" | "text"
  const [files, setFiles] = useState([]); // ordered pages
  const [text, setText] = useState("");
  const [recordDate, setRecordDate] = useState(todayISO());
  // true  = one multi-page report (default; a recommendation on page 3 can
  //         refer to a finding on page 1, so the pages must be read together)
  // false = a batch of unrelated reports, scanned one at a time
  const [combinePages, setCombinePages] = useState(true);

  const [preview, setPreview] = useState(null); // { candidates: [], source: {} }
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(""); // batch progress hint
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const dragIndex = useRef(null);

  const isHospital = Boolean(linkId);

  // Reset everything when the modal is dismissed, so reopening never shows a
  // previous report's findings against a new upload.
  useEffect(() => {
    if (!open) {
      setFiles((prev) => {
        prev.forEach((f) => f.url && URL.revokeObjectURL(f.url));
        return [];
      });
      setText("");
      setPreview(null);
      setError("");
      setScanning(false);
      setSaving(false);
      setProgress("");
      setCombinePages(true);
      setRecordDate(todayISO());
    }
  }, [open]);

  // Object URLs leak if never revoked, so release them on unmount.
  useEffect(
    () => () => {
      files.forEach((f) => f.url && URL.revokeObjectURL(f.url));
    },
    [files]
  );

  // Escape closes, matching the app's other overlays.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && !scanning && !saving && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, scanning, saving, onClose]);

  if (!open) return null;

  /**
   * Accept a FileList from any source — single pick, multi-pick, folder, or
   * drag-and-drop — and merge it into the ordered page list.
   *
   * A folder picker returns everything inside, including OS junk and whatever
   * else happens to be in there, so filtering happens here rather than
   * bothering the user (or the server) with files that were never reports.
   * Notably it filters silently for junk but reports skipped *real* files, so
   * nobody wonders where their document went.
   */
  const addFiles = (fileList) => {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;

    const skipped = { type: 0, big: 0 };

    const usable = incoming
      .filter((f) => !isJunkName(f.name))
      .filter((f) => {
        // HEIC from iPhones sometimes arrives with an empty MIME type, so the
        // extension is a valid fallback. The server sniffs magic bytes anyway,
        // so being lenient here costs nothing.
        if (!looksAccepted(f)) {
          skipped.type += 1;
          return false;
        }
        if (f.size > MAX_BYTES) {
          skipped.big += 1;
          return false;
        }
        return true;
      });

    setFiles((prev) => {
      // Dedupe by name+size, so re-picking the same folder doesn't double it.
      const seen = new Set(prev.map((p) => `${p.file.name}:${p.file.size}`));
      const fresh = usable
        .filter((f) => !seen.has(`${f.name}:${f.size}`))
        .sort(naturalSort)
        .map((f) => ({
          file: f,
          id: `${f.name}:${f.size}:${f.lastModified}`,
          url: f.type.startsWith("image/") ? URL.createObjectURL(f) : null,
        }));

      const merged = [...prev, ...fresh];

      if (merged.length > MAX_FILES) {
        setError(`Only the first ${MAX_FILES} pages were kept — that's the per-scan limit.`);
        merged.slice(MAX_FILES).forEach((m) => m.url && URL.revokeObjectURL(m.url));
        return merged.slice(0, MAX_FILES);
      }

      const total = merged.reduce((s, m) => s + m.file.size, 0);
      if (total > MAX_TOTAL_BYTES) {
        setError(
          `Those files total ${(total / 1024 / 1024).toFixed(0)} MB. Please keep a batch under ${Math.round(MAX_TOTAL_BYTES / 1024 / 1024)} MB.`
        );
        return prev;
      }

      const notes = [];
      if (skipped.type) notes.push(`${skipped.type} unsupported file${skipped.type > 1 ? "s" : ""}`);
      if (skipped.big) notes.push(`${skipped.big} file${skipped.big > 1 ? "s" : ""} over 15 MB`);
      setError(notes.length ? `Skipped ${notes.join(" and ")}.` : "");

      return merged;
    });

    setPreview(null);
  };

  const removeFile = (id) => {
    setFiles((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target?.url) URL.revokeObjectURL(target.url);
      return prev.filter((p) => p.id !== id);
    });
    setPreview(null);
  };

  /** Drag-to-reorder: page order is the one thing the user knows better than we do. */
  const reorder = (from, to) => {
    if (from === to || from == null || to == null) return;
    setFiles((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setPreview(null);
  };

  const callScan = (payload) =>
    isHospital
      ? hospitalApi.scanPatientReport(linkId, payload, accessToken)
      : patientApi.scanReport(payload, accessToken);

  /**
   * Combine mode sends every page in one request so the extractor reads them
   * as a single document. Separate mode sends one request per file and merges
   * the results, which is slower but keeps each report's findings distinct.
   */
  const performScan = async (dryRun) => {
    const raw = files.map((f) => f.file);

    if (mode === "text") {
      return callScan({ text, recordDate, dryRun });
    }

    if (combinePages || raw.length <= 1) {
      return callScan({ files: raw, recordDate, dryRun });
    }

    const merged = { candidates: [], created: [], duplicates: 0, source: { batch: true, fileCount: raw.length, readCount: 0, failedCount: 0, files: [] } };

    for (let i = 0; i < raw.length; i += 1) {
      setProgress(`Reading ${i + 1} of ${raw.length} — ${raw[i].name}`);
      try {
        const res = await callScan({ files: [raw[i]], recordDate, dryRun });
        const d = res.data || {};
        merged.candidates.push(...(d.candidates || []));
        merged.created.push(...(d.created || []));
        merged.duplicates += d.duplicates || 0;
        merged.source.readCount += 1;
        merged.source.files.push({ name: raw[i].name, order: i + 1, ok: true, method: d.source?.method, confidence: d.source?.confidence });
      } catch (err) {
        // One bad page must not lose the rest — mirrors the server's behaviour.
        merged.source.failedCount += 1;
        merged.source.files.push({ name: raw[i].name, order: i + 1, ok: false, reason: err.message });
      }
    }

    setProgress("");
    merged.source.incomplete = merged.source.failedCount > 0;
    if (merged.source.readCount === 0) {
      throw new Error("None of those files could be read. Try clearer photos, or paste the report text.");
    }
    return { data: merged, message: null };
  };

  const runScan = async () => {
    setError("");
    setScanning(true);
    try {
      const res = await performScan(true);
      setPreview({ ...res.data, message: res.message });
    } catch (err) {
      setError(err.message);
    } finally {
      setScanning(false);
      setProgress("");
    }
  };

  const saveFound = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await performScan(false);
      onSaved?.(res.data);
      onClose();
    } catch (err) {
      setError(err.message);
      setSaving(false);
      setProgress("");
    }
  };

  const canScan = mode === "file" ? files.length > 0 : text.trim().length >= 20;
  const found = preview?.candidates || [];
  const busy = scanning || saving;
  const totalMb = files.reduce((s, f) => s + f.file.size, 0) / 1024 / 1024;
  const hasImages = files.some((f) => f.file.type.startsWith("image/"));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        onClick={() => !busy && onClose()}
        className="absolute inset-0 bg-slate-900/50"
      />

      <div className="relative flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="flex items-center gap-2 font-display text-lg font-bold text-brand-900">
              <ScanLine size={18} /> {heading}
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Upload a PDF, photograph a paper report, or paste the text. Finds recommended next
              steps — repeat scans, blood tests, referrals — and puts a clock on them.
            </p>
          </div>
          <button
            type="button"
            onClick={() => !busy && onClose()}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-50"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* Input mode */}
          <div className="mb-4 flex items-center gap-2 border-b border-slate-100">
            {[
              { key: "file", label: "Upload file", icon: Upload },
              { key: "text", label: "Paste text", icon: ClipboardPaste },
            ].map((t) => (
              <button
                key={t.key}
                type="button"
                disabled={busy}
                onClick={() => {
                  setMode(t.key);
                  setPreview(null);
                  setError("");
                }}
                className={`flex items-center gap-1.5 border-b-2 px-3 pb-2.5 text-sm font-semibold transition disabled:opacity-50 ${
                  mode === t.key
                    ? "border-brand-600 text-brand-600"
                    : "border-transparent text-slate-500 hover:text-slate-700"
                }`}
              >
                <t.icon size={14} /> {t.label}
              </button>
            ))}
          </div>

          {mode === "file" ? (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,application/pdf,image/*"
                className="hidden"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = ""; // allow re-picking the same file
                }}
              />
              {/* webkitdirectory is non-standard but supported by every current
                  desktop browser; React needs the lowercase DOM attribute names. */}
              <input
                ref={folderInputRef}
                type="file"
                multiple
                webkitdirectory=""
                directory=""
                className="hidden"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              {/* `capture` opens the camera directly on phones — the fastest
                  path from "I'm holding a paper report" to a tracked follow-up. */}
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
              />

              {files.length === 0 ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    addFiles(e.dataTransfer.files);
                  }}
                  className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/50 px-6 py-8 text-center transition hover:border-brand-300 hover:bg-brand-50/30 disabled:opacity-60"
                >
                  <span className="flex items-center gap-2">
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                      <FileText size={20} />
                    </span>
                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                      <ImageIcon size={20} />
                    </span>
                  </span>
                  <span className="text-sm font-semibold text-slate-600">
                    Drop reports here, or click to browse
                  </span>
                  <span className="text-xs text-slate-400">
                    One file or many — PDF, JPG, PNG, WebP, HEIC · up to {MAX_FILES} pages
                  </span>
                </button>
              ) : (
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    addFiles(e.dataTransfer.files);
                  }}
                  className="rounded-xl border border-slate-200 bg-white"
                >
                  <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
                    <span className="text-xs font-semibold text-slate-600">
                      {files.length} {files.length === 1 ? "file" : "pages"} · {totalMb.toFixed(1)} MB
                      {files.length > 1 && (
                        <span className="ml-1 font-normal text-slate-400">
                          · drag to reorder
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        files.forEach((f) => f.url && URL.revokeObjectURL(f.url));
                        setFiles([]);
                        setPreview(null);
                        setError("");
                      }}
                      className="text-xs font-semibold text-slate-400 transition hover:text-rose-600 disabled:opacity-50"
                    >
                      Clear all
                    </button>
                  </div>

                  <ul className="max-h-52 overflow-y-auto p-2">
                    {files.map((f, i) => (
                      <li
                        key={f.id}
                        draggable={!busy && files.length > 1}
                        onDragStart={() => {
                          dragIndex.current = i;
                        }}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          reorder(dragIndex.current, i);
                          dragIndex.current = null;
                        }}
                        className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50"
                      >
                        {files.length > 1 && (
                          <GripVertical size={13} className="shrink-0 cursor-grab text-slate-300" />
                        )}
                        <span className="w-5 shrink-0 text-center text-[11px] font-bold text-slate-400">
                          {i + 1}
                        </span>
                        {f.url ? (
                          <img
                            src={f.url}
                            alt=""
                            className="h-9 w-9 shrink-0 rounded border border-slate-200 object-cover"
                          />
                        ) : (
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-slate-200 bg-slate-50 text-slate-400">
                            <FileText size={15} />
                          </span>
                        )}
                        <span className="min-w-0 flex-1 truncate text-xs text-slate-600" title={f.file.name}>
                          {f.file.name}
                        </span>
                        <span className="shrink-0 text-[11px] text-slate-400">
                          {(f.file.size / 1024).toFixed(0)} KB
                        </span>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => removeFile(f.id)}
                          className="shrink-0 rounded p-1 text-slate-300 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                          aria-label={`Remove ${f.file.name}`}
                        >
                          <Trash2 size={13} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Add-more actions */}
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  <Files size={14} /> {files.length ? "Add files" : "Choose files"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => folderInputRef.current?.click()}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  <FolderOpen size={14} /> Upload a folder
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => cameraInputRef.current?.click()}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50 sm:hidden"
                >
                  <Camera size={14} /> Take a photo
                </button>
              </div>

              {/* How to treat a multi-file batch. Only meaningful with 2+. */}
              {files.length > 1 && (
                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                  <p className="mb-2 text-xs font-semibold text-slate-600">
                    What are these {files.length} files?
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {[
                      {
                        value: true,
                        icon: Layers,
                        label: "Pages of one report",
                        hint: "Read together, so a recommendation on a later page still connects to the finding it refers to.",
                      },
                      {
                        value: false,
                        icon: Files,
                        label: "Separate reports",
                        hint: "Each file scanned on its own. Slower, but keeps unrelated reports' findings distinct.",
                      },
                    ].map((opt) => (
                      <button
                        key={String(opt.value)}
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setCombinePages(opt.value);
                          setPreview(null);
                        }}
                        className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-left transition disabled:opacity-50 ${
                          combinePages === opt.value
                            ? "border-brand-300 bg-brand-50/60"
                            : "border-transparent bg-white hover:border-slate-200"
                        }`}
                      >
                        <opt.icon
                          size={14}
                          className={`mt-0.5 shrink-0 ${
                            combinePages === opt.value ? "text-brand-600" : "text-slate-400"
                          }`}
                        />
                        <span>
                          <span
                            className={`block text-xs font-semibold ${
                              combinePages === opt.value ? "text-brand-800" : "text-slate-600"
                            }`}
                          >
                            {opt.label}
                          </span>
                          <span className="block text-[11px] text-slate-400">{opt.hint}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <p className="mt-2 flex items-start gap-1.5 text-xs text-slate-400">
                <Info size={13} className="mt-0.5 shrink-0" />
                Scanned PDFs and photos are read with on-device OCR. Files are processed in memory
                and never stored — only the recommendation sentence is kept, so you can always check
                where a follow-up came from.
              </p>
            </div>
          ) : (
            <div>
              <textarea
                rows={9}
                value={text}
                disabled={busy}
                onChange={(e) => {
                  setText(e.target.value);
                  setPreview(null);
                }}
                placeholder={
                  "Paste the report text here — the Impression or Recommendations section is usually enough.\n\ne.g. \"Incidental 6 mm pulmonary nodule, right lower lobe. Recommend interval follow-up chest CT in 6 months.\""
                }
                className="w-full resize-y rounded-xl border border-slate-200 px-3.5 py-3 text-sm text-slate-700 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50"
              />
              <p className="mt-1 text-xs text-slate-400">{text.trim().length} characters</p>
            </div>
          )}

          {/* Report date — the anchor every interval is measured from */}
          <div className="mt-4">
            <label htmlFor="scan-record-date" className="mb-1 block text-xs font-semibold text-slate-600">
              Date on the report
            </label>
            <input
              id="scan-record-date"
              type="date"
              value={recordDate}
              max={todayISO()}
              disabled={busy}
              onChange={(e) => {
                setRecordDate(e.target.value);
                setPreview(null);
              }}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
            />
            <p className="mt-1 text-xs text-slate-400">
              "In 6 months" is counted from this date, so an old report gets the right due date.
            </p>
          </div>

          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              <CircleAlert size={15} className="mt-0.5 shrink-0" /> {error}
            </div>
          )}

          {/* Results */}
          {preview && (
            <div className="mt-5 border-t border-slate-100 pt-5">
              {/* Incomplete batch read. This is the loudest thing in the
                  modal by design: "no follow-ups found" from a report we only
                  partially read is a dangerously misleading conclusion, and
                  the user must not walk away thinking they're clear. */}
              {preview.source?.incomplete && (
                <div className="mb-3 rounded-lg border-2 border-amber-300 bg-amber-50 px-3 py-2.5">
                  <p className="flex items-center gap-1.5 text-xs font-bold text-amber-900">
                    <TriangleAlert size={14} />
                    {preview.source.failedCount} of {preview.source.fileCount} pages could not be read
                  </p>
                  <p className="mt-1 text-[11px] text-amber-800">
                    This scan is incomplete — there may be follow-ups on the pages we couldn't read.
                    Re-upload them before treating this report as clear.
                  </p>
                  <ul className="mt-1.5 space-y-0.5">
                    {preview.source.files
                      ?.filter((f) => !f.ok)
                      .map((f) => (
                        <li key={f.name} className="text-[11px] text-amber-800">
                          <span className="font-semibold">{f.name}</span>
                          {f.reason ? ` — ${f.reason}` : ""}
                        </li>
                      ))}
                  </ul>
                </div>
              )}

              {/* How the text was obtained. Shown always, because "we found
                  nothing" means something very different after a clean PDF
                  read than after a blurry photo. */}
              {preview.source?.method && METHOD_META[preview.source.method] && (
                <div
                  className={`mb-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
                    preview.source.lowConfidence
                      ? "border-amber-200 bg-amber-50 text-amber-800"
                      : "border-slate-200 bg-slate-50 text-slate-500"
                  }`}
                >
                  {preview.source.lowConfidence ? (
                    <TriangleAlert size={13} className="mt-0.5 shrink-0" />
                  ) : (
                    <ScanLine size={13} className="mt-0.5 shrink-0" />
                  )}
                  <span>
                    {METHOD_META[preview.source.method].label}
                    {!METHOD_META[preview.source.method].exact &&
                      typeof preview.source.confidence === "number" &&
                      ` · ${Math.round(preview.source.confidence)}% legibility`}
                    {preview.source.batch
                      ? ` · ${preview.source.readCount} of ${preview.source.fileCount} pages read`
                      : preview.source.pages > 1
                        ? ` · ${preview.source.pages} pages`
                        : ""}
                    {preview.source.lowConfidence && (
                      <>
                        {" — "}
                        the text was hard to make out, so please check each item below carefully
                        against your report.
                      </>
                    )}
                  </span>
                </div>
              )}

              {found.length === 0 ? (
                <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
                  <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-slate-400" />
                  <div>
                    <p className="text-sm font-semibold text-slate-700">
                      No follow-up recommendations found
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {preview.source?.incomplete
                        ? "…in the pages we were able to read. See the warning above — this scan is incomplete."
                        : preview.source?.lowConfidence
                          ? "The text was difficult to read, so this may not mean your report is clear. Try a sharper, better-lit photo, or paste the text directly."
                          : "This report doesn't appear to recommend a future scan, test or referral. If you know it does, paste that sentence directly and scan again."}
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <h3 className="mb-3 text-sm font-bold text-slate-700">
                    Found {found.length} follow-up{found.length > 1 ? "s" : ""} — review before saving
                  </h3>
                  <div className="flex flex-col gap-3">
                    {found.map((c, i) => {
                      const style = SEVERITY_STYLES[c.severity] || SEVERITY_STYLES.routine;
                      return (
                        <div
                          key={`${c.action}-${i}`}
                          className="rounded-xl border border-slate-200 bg-white p-4"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`h-2 w-2 rounded-full ${style.dot}`} />
                            <span className="font-display text-sm font-bold text-slate-800">
                              {c.action}
                            </span>
                            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${style.chip}`}>
                              {c.severity}
                            </span>
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                              {CATEGORY_LABELS[c.category] || c.category}
                            </span>
                          </div>

                          <p className="mt-2 text-sm text-slate-600">
                            <span className="text-slate-400">Finding:</span> {c.finding}
                          </p>

                          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                            <span className="flex items-center gap-1 font-semibold text-brand-700">
                              <CalendarClock size={13} /> Due {formatDate(c.dueAt)}
                            </span>
                            {c.unparseableTimeframe ? (
                              <span className="text-amber-600">
                                Couldn't read the interval from the report — please set the real date
                              </span>
                            ) : c.inferredWindow ? (
                              <span className="text-amber-600">
                                No date stated in the report — we estimated one
                              </span>
                            ) : null}
                            {c.confidence < 0.8 && (
                              <span className="text-slate-400">
                                Needs your confirmation before tracking
                              </span>
                            )}
                          </div>

                          {/* Provenance: the verbatim sentence this came from. */}
                          {c.sourceText && (
                            <blockquote className="mt-2.5 border-l-2 border-slate-200 bg-slate-50/70 py-1.5 pl-3 text-xs italic text-slate-500">
                              "{c.sourceText}"
                            </blockquote>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-4">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-500 transition hover:bg-slate-100 disabled:opacity-50"
          >
            Cancel
          </button>

          {!preview || found.length === 0 ? (
            <button
              type="button"
              disabled={!canScan || busy}
              onClick={runScan}
              className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {scanning ? <Loader2 size={15} className="animate-spin" /> : <ScanLine size={15} />}
              {scanning
                ? progress ||
                  (files.length > 1
                    ? `Reading ${files.length} pages…`
                    : hasImages
                      ? "Reading the image…"
                      : "Reading report…")
                : preview
                  ? "Scan again"
                  : files.length > 1
                    ? `Scan ${files.length} pages`
                    : "Scan report"}
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={saveFound}
              className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
              {saving ? "Saving…" : `Track ${found.length} follow-up${found.length > 1 ? "s" : ""}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
