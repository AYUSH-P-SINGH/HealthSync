import { Sparkles, ShieldCheck, AlertCircle } from "lucide-react";

/**
 * Formatted grounded AI answer component with confidence badge.
 */
export default function AIAnswer({ answer, confidence = "high", responseType }) {
  if (!answer) return null;

  const responseTypeBadge = {
    RECORD_SUMMARY: { label: "Record Summary", cls: "bg-purple-500/10 text-purple-700 border-purple-200" },
    FACT_RETRIEVAL: { label: "Fact Extraction", cls: "bg-blue-500/10 text-blue-700 border-blue-200" },
    COMPARISON: { label: "Historical Comparison", cls: "bg-indigo-500/10 text-indigo-700 border-indigo-200" },
    ADVICE_REFUSAL: { label: "Medical Advice Refusal", cls: "bg-amber-500/10 text-amber-800 border-amber-300" },
    NO_EVIDENCE: { label: "No Evidence Found", cls: "bg-slate-500/10 text-slate-700 border-slate-200" },
  }[responseType];

  const confidenceBadge = {
    high: {
      label: "High Grounding Evidence",
      cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
      icon: ShieldCheck,
    },
    medium: {
      label: "Moderate Grounding",
      cls: "bg-amber-500/10 text-amber-600 border-amber-500/20",
      icon: Sparkles,
    },
    low: {
      label: "Limited Evidence",
      cls: "bg-rose-500/10 text-rose-600 border-rose-500/20",
      icon: AlertCircle,
    },
  }[confidence] || {
    label: "Grounded Answer",
    cls: "bg-blue-500/10 text-blue-600 border-blue-500/20",
    icon: Sparkles,
  };

  const Icon = confidenceBadge.icon;

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition hover:shadow-md">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2 font-semibold text-slate-800">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <Sparkles size={16} />
          </div>
          <span>HealthSync AI Assistant</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {responseTypeBadge && (
            <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${responseTypeBadge.cls}`}>
              {responseTypeBadge.label}
            </span>
          )}
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${confidenceBadge.cls}`}
          >
            <Icon size={13} />
            {confidenceBadge.label}
          </span>
        </div>
      </div>

      <p className="leading-relaxed text-slate-700 text-sm whitespace-pre-line">{answer}</p>
    </div>
  );
}
