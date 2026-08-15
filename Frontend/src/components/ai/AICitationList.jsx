import AICitationCard from "./AICitationCard.jsx";

/**
 * List of verified citation cards powering the grounded AI response.
 */
export default function AICitationList({ citations = [], onSelectRecord }) {
  if (!Array.isArray(citations) || citations.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 space-y-2.5">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
          Verified Medical Sources ({citations.length})
        </h4>
        <span className="text-[11px] text-slate-400">Grounding Evidence</span>
      </div>

      <div className="grid grid-cols-1 gap-2.5">
        {citations.map((citation, idx) => (
          <AICitationCard
            key={citation.chunkId || citation.recordId || idx}
            citation={citation}
            onSelectRecord={onSelectRecord}
          />
        ))}
      </div>
    </div>
  );
}
