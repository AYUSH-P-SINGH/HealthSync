import { useState } from "react";
import {
  Building2,
  UserRound,
  ChevronDown,
  ChevronUp,
  TriangleAlert,
  Loader2,
  Trash2,
  Sparkles,
  Activity,
  FileCheck2,
  Pill,
  Stethoscope,
  FileCode2,
  AlertCircle,
  Copy,
  Check,
} from "lucide-react";
import { typeMeta, ALERT_STYLES } from "../lib/records.js";
import { formatDate } from "../lib/format.js";


export default function RecordCard({
  record,
  onTogglePrescription, // (record, nextActive) => Promise — patient only
  onDelete, // (record) => Promise — patient self-reported only
  busy = false,
}) {
  const [open, setOpen] = useState(false);
  const [showRawText, setShowRawText] = useState(false);
  const [copiedRaw, setCopiedRaw] = useState(false);

  const meta = typeMeta(record.type);
  const Icon = meta.icon;

  const sourceName =
    record.hospital?.name || (record.createdByRole === "patient" ? "Self-reported" : "Hospital");

  const hasAiSummary = Boolean(
    record.aiSummary &&
      (record.aiSummary.summary ||
        (record.aiSummary.keyFindings?.length || 0) > 0 ||
        (record.aiSummary.abnormalValues?.length || 0) > 0 ||
        (record.aiSummary.medications?.length || 0) > 0 ||
        (record.aiSummary.recommendations?.length || 0) > 0)
  );

  const hasDetails =
    (record.medicines?.length || 0) > 0 ||
    (record.labResults?.length || 0) > 0 ||
    (record.alerts?.length || 0) > 0 ||
    Boolean(record.description) ||
    hasAiSummary ||
    Boolean(record.rawText) ||
    (record.aiStatus && record.aiStatus !== "none");

  const copyRawText = async () => {
    if (!record.rawText) return;
    try {
      await navigator.clipboard.writeText(record.rawText);
      setCopiedRaw(true);
      setTimeout(() => setCopiedRaw(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className="rounded-xl border border-slate-100 bg-white shadow-sm transition hover:shadow-md">
      {/* ── Header Bar ── */}
      <button
        type="button"
        onClick={() => hasDetails && setOpen((o) => !o)}
        className={`flex w-full items-start gap-3 p-4 text-left ${hasDetails ? "cursor-pointer" : "cursor-default"}`}
      >
        <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${meta.chip}`}>
          <Icon size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-800">{record.title}</span>

            {/* Type badge */}
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${meta.chip}`}>
              {meta.label}
            </span>

            {/* Prescription active/completed badge */}
            {record.type === "prescription" && record.isActivePrescription != null && (
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                  record.isActivePrescription
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-slate-100 text-slate-500"
                }`}
              >
                {record.isActivePrescription ? "Active" : "Completed"}
              </span>
            )}

            {/* Safety Alerts count */}
            {(record.alerts?.length || 0) > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-700">
                <TriangleAlert size={11} /> {record.alerts.length} alert{record.alerts.length > 1 ? "s" : ""}
              </span>
            )}

            {/* ── AI Processing & Summary Badge ── */}
            {hasAiSummary ? (
              <span className="flex items-center gap-1 rounded-full bg-gradient-to-r from-indigo-500/10 via-purple-500/10 to-blue-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700 border border-indigo-200/80 shadow-2xs">
                <Sparkles size={11} className="text-indigo-600 animate-pulse" />
                AI Summary
              </span>
            ) : record.aiStatus === "pending" ? (
              <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700 border border-amber-200">
                <Loader2 size={11} className="animate-spin" />
                AI Processing...
              </span>
            ) : record.aiStatus === "failed" ? (
              <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-500">
                <AlertCircle size={11} />
                AI Unavailable
              </span>
            ) : null}
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-400">
            <span>{formatDate(record.recordDate)}</span>
            <span className="flex items-center gap-1">
              {record.createdByRole === "patient" ? <UserRound size={12} /> : <Building2 size={12} />}
              {sourceName}
            </span>
            {record.condition && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-500">
                {record.condition}
              </span>
            )}
            {record.doctorName && <span>Dr. {record.doctorName}</span>}
          </div>
        </div>

        {hasDetails && (
          <span className="mt-1 shrink-0 text-slate-300">
            {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </span>
        )}
      </button>

      {/* ── Expanded Drawer ── */}
      {open && (
        <div className="border-t border-slate-100 px-4 pb-4 pt-3 space-y-4">
          {/* Record description */}
          {record.description && <p className="text-sm text-slate-600">{record.description}</p>}

          {/* ══════════════════════════════════════════════════════════════ */}
          {/* 🌟 PLAIN-ENGLISH AI SUMMARY & LAB EXPLAINER CARD               */}
          {/* ══════════════════════════════════════════════════════════════ */}
          {hasAiSummary && (
            <div className="rounded-xl border border-indigo-100/90 bg-gradient-to-br from-indigo-50/80 via-violet-50/40 to-slate-50 p-4 shadow-2xs space-y-3.5">
              {/* AI Card Header */}
              <div className="flex items-center justify-between border-b border-indigo-100/60 pb-2.5">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-tr from-indigo-600 to-violet-600 text-white shadow-xs">
                    <Sparkles size={14} />
                  </span>
                  <div>
                    <h4 className="text-xs font-bold text-slate-800 tracking-wide uppercase">
                      Plain-English AI Summary & Lab Explainer
                    </h4>
                    <p className="text-[10px] text-slate-400">
                      Grounded clinical translation • 7th-grade readability level
                    </p>
                  </div>
                </div>
                {record.aiSummary.generatedAt && (
                  <span className="text-[10px] text-indigo-500 font-medium">
                    {formatDate(record.aiSummary.generatedAt)}
                  </span>
                )}
              </div>

              {/* Summary Prose */}
              {record.aiSummary.summary && (
                <div className="rounded-lg bg-white/90 p-3 border border-indigo-50 shadow-2xs">
                  <p className="text-xs leading-relaxed text-slate-700 font-normal">
                    {record.aiSummary.summary}
                  </p>
                </div>
              )}

              {/* Key Clinical Findings */}
              {(record.aiSummary.keyFindings?.length || 0) > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-700">
                    <FileCheck2 size={13} className="text-indigo-600" />
                    <span>Key Findings</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {record.aiSummary.keyFindings.map((finding, idx) => (
                      <div
                        key={idx}
                        className="flex items-start gap-1.5 rounded-lg border border-indigo-100 bg-white/90 px-2.5 py-1.5 text-xs text-slate-700 shadow-2xs"
                      >
                        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />
                        <span>{finding}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Abnormal Lab Values & Explainer */}
              {(record.aiSummary.abnormalValues?.length || 0) > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-700">
                    <Activity size={13} className="text-indigo-600" />
                    <span>Abnormal Lab Metrics Explainer</span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {record.aiSummary.abnormalValues.map((item, idx) => (
                      <div
                        key={idx}
                        className="rounded-lg border border-slate-100 bg-white p-2.5 shadow-2xs space-y-1"
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-semibold text-xs text-slate-800">{item.test}</span>
                          {item.flag && (
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                                item.flag === "critical"
                                  ? "bg-rose-100 text-rose-700 border border-rose-200"
                                  : item.flag === "high"
                                    ? "bg-amber-100 text-amber-800 border border-amber-200"
                                    : item.flag === "low"
                                      ? "bg-sky-100 text-sky-800 border border-sky-200"
                                      : "bg-emerald-100 text-emerald-800"
                              }`}
                            >
                              {item.flag}
                            </span>
                          )}
                        </div>
                        <div className="flex items-baseline justify-between text-xs">
                          <span className="font-bold text-slate-700">{item.value || "—"}</span>
                          {item.referenceRange && (
                            <span className="text-[10px] text-slate-400">Ref: {item.referenceRange}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* AI Extracted Medications */}
              {(record.aiSummary.medications?.length || 0) > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-700">
                    <Pill size={13} className="text-indigo-600" />
                    <span>AI Extracted Medications</span>
                  </div>
                  <div className="rounded-lg border border-slate-100 bg-white p-2.5 shadow-2xs">
                    <div className="grid gap-1.5 text-xs text-slate-600">
                      {record.aiSummary.medications.map((m, idx) => (
                        <div key={idx} className="flex flex-wrap items-center justify-between border-b border-slate-50 pb-1 last:border-0 last:pb-0">
                          <span className="font-semibold text-slate-800">{m.name}</span>
                          <span className="text-slate-500">
                            {[m.dosage, m.frequency, m.duration].filter(Boolean).join(" • ") || "—"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* AI Recommendations */}
              {(record.aiSummary.recommendations?.length || 0) > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-700">
                    <Stethoscope size={13} className="text-indigo-600" />
                    <span>Care & Follow-up Recommendations</span>
                  </div>
                  <ul className="space-y-1 text-xs text-slate-700">
                    {record.aiSummary.recommendations.map((rec, idx) => (
                      <li key={idx} className="flex items-start gap-2 rounded-lg bg-white/80 p-2 border border-indigo-50">
                        <span className="mt-0.5 text-indigo-600 font-bold">•</span>
                        <span>{rec}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Safety alerts */}
          {(record.alerts?.length || 0) > 0 && (
            <div className="flex flex-col gap-2">
              {record.alerts.map((alert, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
                    ALERT_STYLES[alert.severity] || ALERT_STYLES.info
                  }`}
                >
                  <TriangleAlert size={13} className="mt-0.5 shrink-0" />
                  <span>
                    {alert.message}
                    <span className="ml-1 opacity-60">({alert.source})</span>
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Medicines */}
          {(record.medicines?.length || 0) > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-slate-400">
                    <th className="py-1.5 pr-3 font-semibold">Medicine</th>
                    <th className="py-1.5 pr-3 font-semibold">Dosage</th>
                    <th className="py-1.5 pr-3 font-semibold">Frequency</th>
                    <th className="py-1.5 font-semibold">Duration</th>
                  </tr>
                </thead>
                <tbody className="text-slate-600">
                  {record.medicines.map((m, i) => (
                    <tr key={i} className="border-t border-slate-50">
                      <td className="py-1.5 pr-3 font-medium text-slate-700">{m.name}</td>
                      <td className="py-1.5 pr-3">{m.dosage || "—"}</td>
                      <td className="py-1.5 pr-3">{m.frequency || "—"}</td>
                      <td className="py-1.5">{m.duration || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Lab results */}
          {(record.labResults?.length || 0) > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-slate-400">
                    <th className="py-1.5 pr-3 font-semibold">Test</th>
                    <th className="py-1.5 pr-3 font-semibold">Value</th>
                    <th className="py-1.5 pr-3 font-semibold">Reference</th>
                    <th className="py-1.5 font-semibold">Flag</th>
                  </tr>
                </thead>
                <tbody className="text-slate-600">
                  {record.labResults.map((r, i) => (
                    <tr key={i} className="border-t border-slate-50">
                      <td className="py-1.5 pr-3 font-medium text-slate-700">{r.name}</td>
                      <td className="py-1.5 pr-3">
                        {r.value || "—"} {r.unit || ""}
                      </td>
                      <td className="py-1.5 pr-3">{r.referenceRange || "—"}</td>
                      <td className="py-1.5">
                        {r.flag ? (
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                              r.flag === "normal"
                                ? "bg-emerald-50 text-emerald-700"
                                : r.flag === "critical"
                                  ? "bg-rose-100 text-rose-700"
                                  : "bg-amber-50 text-amber-700"
                            }`}
                          >
                            {r.flag}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════ */}
          {/* 📄 VERBATIM SOURCE GROUNDING TEXT VIEWER (`rawText`)            */}
          {/* ══════════════════════════════════════════════════════════════ */}
          {record.rawText && (
            <div className="border-t border-slate-100 pt-3">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setShowRawText((v) => !v)}
                  className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-indigo-600 transition"
                >
                  <FileCode2 size={13} />
                  <span>{showRawText ? "Hide Verbatim Source Text" : "View Verbatim Source Text"}</span>
                  <ChevronDown
                    size={13}
                    className={`transition-transform duration-200 ${showRawText ? "rotate-180" : ""}`}
                  />
                </button>
                {showRawText && (
                  <button
                    type="button"
                    onClick={copyRawText}
                    className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600"
                  >
                    {copiedRaw ? (
                      <>
                        <Check size={12} className="text-emerald-600" />
                        <span className="text-emerald-600">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy size={12} />
                        <span>Copy text</span>
                      </>
                    )}
                  </button>
                )}
              </div>

              {showRawText && (
                <div className="mt-2 rounded-xl bg-slate-900 p-3 text-slate-200 border border-slate-800 shadow-inner">
                  <div className="mb-1.5 flex items-center justify-between text-[10px] text-slate-400 border-b border-slate-800 pb-1 font-mono">
                    <span>SOURCE TEXT LAYER (OCR / PDF)</span>
                    <span>{record.rawText.length} CHARS</span>
                  </div>
                  <pre className="max-h-60 overflow-y-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-slate-300 select-text">
                    {record.rawText}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* Patient actions */}
          {(onTogglePrescription || onDelete) && (
            <div className="flex items-center gap-2 border-t border-slate-50 pt-3">
              {onTogglePrescription && record.type === "prescription" && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onTogglePrescription(record, !record.isActivePrescription)}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
                >
                  {busy && <Loader2 size={12} className="animate-spin" />}
                  {record.isActivePrescription ? "Mark as completed" : "Mark as active"}
                </button>
              )}
              {onDelete && record.createdByRole === "patient" && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onDelete(record)}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-60"
                >
                  <Trash2 size={12} /> Delete
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
