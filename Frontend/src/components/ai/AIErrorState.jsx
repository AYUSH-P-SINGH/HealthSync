import { AlertTriangle, Lock, FileSearch } from "lucide-react";

/**
 * Clean, non-technical error state displays for AI Assistant.
 */
export default function AIErrorState({ type = "error", message }) {
  if (type === "no_evidence") {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5 text-amber-900">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-lg bg-amber-100 p-2 text-amber-700">
            <FileSearch size={18} />
          </div>
          <div>
            <h4 className="font-semibold text-sm text-amber-900">Not enough evidence found</h4>
            <p className="mt-1 text-xs text-amber-700 leading-relaxed">
              {message ||
                "I couldn't find enough relevant information in your authorized medical records to answer this question reliably."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (type === "unauthorized") {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50/70 p-5 text-rose-900">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-lg bg-rose-100 p-2 text-rose-700">
            <Lock size={18} />
          </div>
          <div>
            <h4 className="font-semibold text-sm text-rose-900">Access Permission Scope Limited</h4>
            <p className="mt-1 text-xs text-rose-700 leading-relaxed">
              {message ||
                "This information isn't included in your current active access permissions. Ask the patient for updated consent."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-slate-800">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-lg bg-slate-200/80 p-2 text-slate-600">
          <AlertTriangle size={18} />
        </div>
        <div>
          <h4 className="font-semibold text-sm text-slate-800">AI Assistant Temporarily Unavailable</h4>
          <p className="mt-1 text-xs text-slate-500 leading-relaxed">
            {message || "We couldn't process your question at this moment. Your medical records remain fully accessible normally."}
          </p>
        </div>
      </div>
    </div>
  );
}
