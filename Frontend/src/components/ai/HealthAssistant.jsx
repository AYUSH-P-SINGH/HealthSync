import { useState } from "react";
import { Sparkles, Send, Loader2, HelpCircle } from "lucide-react";
import { aiApi } from "../../lib/aiApi.js";
import { useAuth } from "../../context/AuthContext.jsx";
import AIAnswer from "./AIAnswer.jsx";
import AICitationList from "./AICitationList.jsx";
import AIErrorState from "./AIErrorState.jsx";

const EXAMPLE_QUESTIONS = [
  "How has my HbA1c changed?",
  "What medications have I taken recently?",
  "What were the findings in my lab reports?",
  "Are there any follow-up visits mentioned?",
];

/**
 * HealthSync AI Assistant Component.
 * Embedded inside TimelineView to provide consent-grounded Q&A with direct citation links.
 */
export default function HealthAssistant({ consentId, patientId, onSelectRecord }) {
  const { accessToken } = useAuth();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("idle"); // idle | loading | success | no_evidence | unauthorized | error
  const [response, setResponse] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");

  const handleAsk = async (textToAsk) => {
    const q = String(textToAsk || query).trim();
    if (!q || status === "loading") return;

    setQuery(q);
    setStatus("loading");
    setErrorMessage("");
    setResponse(null);

    try {
      const data = await aiApi.ask(
        { query: q, consentId, patientId },
        accessToken
      );

      if (!data || data.hasEvidence === false || (!data.answer && data.citations?.length === 0)) {
        setStatus("no_evidence");
        setResponse(data);
      } else {
        setStatus("success");
        setResponse(data);
      }
    } catch (err) {
      const errMsg = err.message || "";
      if (errMsg.toLowerCase().includes("permission") || errMsg.toLowerCase().includes("consent")) {
        setStatus("unauthorized");
        setErrorMessage(errMsg);
      } else {
        setStatus("error");
        setErrorMessage(errMsg);
      }
    }
  };

  return (
    <div className="mb-6 rounded-3xl border border-brand-200/80 bg-gradient-to-b from-brand-50/40 via-white to-white p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-600 text-white shadow-md shadow-brand-500/20">
          <Sparkles size={18} />
        </div>
        <div>
          <h3 className="font-bold text-slate-800 text-sm">Ask HealthSync AI</h3>
          <p className="text-xs text-slate-500">
            Grounded answers strictly supported by authorized medical records.
          </p>
        </div>
      </div>

      {/* Query Input Form */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleAsk(query);
        }}
        className="relative mb-3"
      >
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask a question about your medical history..."
          disabled={status === "loading"}
          className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-4 pr-12 text-sm text-slate-800 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={!query.trim() || status === "loading"}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xl bg-brand-600 p-2 text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-40"
          aria-label="Ask AI"
        >
          {status === "loading" ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Send size={16} />
          )}
        </button>
      </form>

      {/* Suggested Question Pills */}
      {status === "idle" && (
        <div className="mb-2">
          <div className="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-slate-400">
            <HelpCircle size={12} />
            <span>Suggested questions:</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLE_QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => handleAsk(q)}
                className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Loading State */}
      {status === "loading" && (
        <div className="my-4 flex items-center justify-center gap-3 rounded-2xl border border-slate-100 bg-white py-6 text-sm text-slate-500">
          <Loader2 size={18} className="animate-spin text-brand-600" />
          <span>Searching your authorized medical records...</span>
        </div>
      )}

      {/* Success State */}
      {status === "success" && response && (
        <div className="mt-4">
          <AIAnswer answer={response.answer} confidence={response.confidence} responseType={response.responseType} />
          <AICitationList
            citations={response.citations}
            onSelectRecord={onSelectRecord}
          />
        </div>
      )}

      {/* Error & Evidence States */}
      {status === "no_evidence" && (
        <div className="mt-4">
          <AIErrorState
            type="no_evidence"
            message={response?.answer}
          />
        </div>
      )}

      {status === "unauthorized" && (
        <div className="mt-4">
          <AIErrorState type="unauthorized" message={errorMessage} />
        </div>
      )}

      {status === "error" && (
        <div className="mt-4">
          <AIErrorState type="error" message={errorMessage} />
        </div>
      )}
    </div>
  );
}
