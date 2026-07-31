import { useCallback, useEffect, useState } from "react";
import { History, Loader2, CircleAlert, Search, X } from "lucide-react";
import { patientApi } from "../lib/api.js";
import { RECORD_TYPES, typeMeta } from "../lib/records.js";
import RecordCard from "./RecordCard.jsx";

const inputCls =
  "rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100";

/**
 * Patient health timeline — every record in chronological order, grouped by
 * month, filterable by record type, hospital, condition and date range.
 */
export default function TimelineView({ accessToken }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [type, setType] = useState("");
  const [hospitalId, setHospitalId] = useState("");
  const [q, setQ] = useState("");
  const [qInput, setQInput] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await patientApi.getTimeline(accessToken, { type, hospitalId, q, from, to });
      setData(res.data);
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [accessToken, type, hospitalId, q, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const hasFilters = type || hospitalId || q || from || to;
  const clearFilters = () => {
    setType("");
    setHospitalId("");
    setQ("");
    setQInput("");
    setFrom("");
    setTo("");
  };

  return (
    <div>
      {/* Type chips with live counts */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setType("")}
          className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
            !type ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          }`}
        >
          All ({data ? Object.values(data.counts).reduce((a, b) => a + b, 0) : "…"})
        </button>
        {RECORD_TYPES.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setType(type === t.key ? "" : t.key)}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              type === t.key ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            <t.icon size={12} /> {t.label}
            {data && <span className="opacity-70">({data.counts[t.key] ?? 0})</span>}
          </button>
        ))}
      </div>

      {/* Filters row */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setQ(qInput.trim());
          }}
          className="relative"
        >
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className={`${inputCls} w-56 pl-8`}
            placeholder="Search condition, medicine, test…"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            onBlur={() => setQ(qInput.trim())}
          />
        </form>
        <select className={inputCls} value={hospitalId} onChange={(e) => setHospitalId(e.target.value)}>
          <option value="">All sources</option>
          <option value="self">Self-reported</option>
          {(data?.hospitals || []).map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
              {h.city ? ` — ${h.city}` : ""}
            </option>
          ))}
        </select>
        <input type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} title="From" />
        <span className="text-xs text-slate-400">to</span>
        <input type="date" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} title="To" />
        {hasFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-500 hover:text-rose-600"
          >
            <X size={13} /> Clear
          </button>
        )}
      </div>

      {error && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <CircleAlert size={15} /> {error}
        </div>
      )}

      {/* Timeline */}
      <div className="mt-6">
        {loading ? (
          <div className="flex items-center gap-2 py-10 text-sm text-slate-400">
            <Loader2 size={16} className="animate-spin" /> Building your timeline…
          </div>
        ) : !data || data.groups.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-200 bg-white px-6 py-14 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
              <History size={22} />
            </span>
            <div className="font-display font-bold text-slate-700">
              {hasFilters ? "Nothing matches these filters" : "Your timeline is empty"}
            </div>
            <p className="max-w-md text-sm text-slate-400">
              {hasFilters
                ? "Try clearing a filter or widening the date range."
                : "Visits, diagnoses, prescriptions and lab reports will build your chronological health history here."}
            </p>
          </div>
        ) : (
          data.groups.map((group) => (
            <div key={group.label} className="mb-8">
              <div className="sticky top-0 z-10 -mx-1 bg-slate-50/90 px-1 py-1.5 backdrop-blur">
                <h2 className="font-display text-sm font-bold uppercase tracking-wide text-slate-400">
                  {group.label}
                </h2>
              </div>
              <div className="mt-3 border-l-2 border-slate-100 pl-5">
                {group.items.map((record) => (
                  <div key={record._id} className="relative mb-3">
                    <span
                      className={`absolute -left-[27px] top-5 h-3 w-3 rounded-full border-2 border-white ${typeMeta(record.type).dot}`}
                    />
                    <RecordCard record={record} />
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
