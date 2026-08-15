import { FileText, ArrowRight, Calendar } from "lucide-react";

/**
 * Single Citation Card component.
 * Links grounded AI facts directly to the patient's verified medical record.
 */
export default function AICitationCard({ citation, onSelectRecord }) {
  if (!citation) return null;

  const { recordId, recordType, date, snippet } = citation;

  const typeLabels = {
    visit: { label: "Clinical Visit", cls: "bg-purple-50 text-purple-700 border-purple-200" },
    diagnosis: { label: "Diagnosis", cls: "bg-rose-50 text-rose-700 border-rose-200" },
    prescription: { label: "Prescription", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    lab_report: { label: "Lab Report", cls: "bg-blue-50 text-blue-700 border-blue-200" },
    vaccination: { label: "Vaccination", cls: "bg-teal-50 text-teal-700 border-teal-200" },
    other: { label: "Medical Record", cls: "bg-slate-50 text-slate-700 border-slate-200" },
  };

  const badge = typeLabels[recordType] || typeLabels.other;

  return (
    <div className="group rounded-xl border border-slate-200/90 bg-white p-4 transition hover:border-brand-300 hover:shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${badge.cls}`}>
            {badge.label}
          </span>
          {date && (
            <span className="inline-flex items-center gap-1 text-xs text-slate-400 font-medium">
              <Calendar size={12} />
              {date}
            </span>
          )}
        </div>

        {onSelectRecord && recordId && (
          <button
            type="button"
            onClick={() => onSelectRecord(recordId)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 transition group-hover:text-brand-700"
          >
            <span>View record</span>
            <ArrowRight size={13} className="transition group-hover:translate-x-0.5" />
          </button>
        )}
      </div>

      {snippet && (
        <p className="mt-2.5 line-clamp-2 text-xs text-slate-600 font-mono bg-slate-50 p-2 rounded-lg border border-slate-100">
          "{snippet}"
        </p>
      )}
    </div>
  );
}
