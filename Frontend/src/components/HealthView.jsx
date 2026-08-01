import { useCallback, useEffect, useState } from "react";
import {
  ShieldAlert,
  Loader2,
  CircleAlert,
  MapPin,
  Globe2,
  Lightbulb,
  ExternalLink,
  ShieldCheck,
  Check,
} from "lucide-react";
import { advisoryApi } from "../lib/api.js";
import { severityMeta } from "../lib/records.js";
import { formatDate } from "../lib/format.js";

/**
 * Health tab — disease advisories published by the HealthSync health desk,
 * supplemented by WHO Disease Outbreak News. When there's nothing to warn
 * about, daily healthcare tips keep the tab useful.
 */
export default function HealthView({ accessToken }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await advisoryApi.getActive(accessToken);
      setData(res.data);
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-slate-400">
        <Loader2 size={16} className="animate-spin" /> Checking for health advisories…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
        <CircleAlert size={15} /> {error}
      </div>
    );
  }

  const advisories = data?.advisories || [];
  const externalAlerts = data?.externalAlerts || [];
  const tips = data?.tips || [];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
      <div>
        {/* Active advisories */}
        {advisories.length === 0 ? (
          <div className="flex items-center gap-3 rounded-xl border border-emerald-100 bg-emerald-50 p-5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-emerald-600">
              <ShieldCheck size={19} />
            </span>
            <div>
              <div className="font-display font-bold text-emerald-800">All clear</div>
              <p className="text-sm text-emerald-700">
                No active disease advisories for your region right now. Meanwhile, here are today&apos;s
                health tips.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {advisories.map((a) => {
              const sev = severityMeta(a.severity);
              return (
                <div key={a._id} className={`rounded-xl border p-5 ${sev.card}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <ShieldAlert size={17} className="shrink-0" />
                    <h3 className="font-display font-bold text-slate-800">{a.title}</h3>
                    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase ${sev.chip}`}>
                      {sev.label}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
                    <span className="flex items-center gap-1">
                      <MapPin size={12} /> {a.region}
                    </span>
                    <span>Published {formatDate(a.createdAt)}</span>
                    <span>{a.source}</span>
                  </div>
                  {a.summary && <p className="mt-3 text-sm text-slate-700">{a.summary}</p>}
                  {(a.precautions?.length || 0) > 0 && (
                    <div className="mt-3">
                      <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                        Recommended precautions
                      </div>
                      <ul className="mt-2 flex flex-col gap-1.5">
                        {a.precautions.map((p, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                            <Check size={14} className="mt-0.5 shrink-0 text-emerald-600" /> {p}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* WHO outbreak news */}
        {externalAlerts.length > 0 && (
          <section className="mt-6">
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
              <Globe2 size={15} /> WHO Disease Outbreak News
            </h2>
            <div className="mt-3 flex flex-col gap-2">
              {externalAlerts.map((alert, i) => (
                <a
                  key={i}
                  href={alert.link || "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="group rounded-xl border border-slate-100 bg-white p-4 shadow-sm transition hover:border-brand-200"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm font-semibold text-slate-700 group-hover:text-brand-700">
                      {alert.title}
                    </div>
                    <ExternalLink size={13} className="mt-1 shrink-0 text-slate-300 group-hover:text-brand-500" />
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    {alert.source}
                    {alert.publishedAt ? ` · ${alert.publishedAt}` : ""}
                  </div>
                </a>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Daily tips */}
      <aside>
        <section className="rounded-xl border border-slate-100 bg-white p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
            <Lightbulb size={15} className="text-amber-500" /> Today&apos;s health tips
          </h2>
          <div className="mt-3 flex flex-col gap-3">
            {tips.map((tip, i) => (
              <div key={i} className="rounded-xl border border-slate-100 bg-slate-50/70 p-3.5">
                <div className="text-sm font-semibold text-slate-700">{tip.title}</div>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">{tip.body}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-slate-400">
            Tips rotate daily and are general guidance — not a substitute for medical advice.
          </p>
        </section>
      </aside>
    </div>
  );
}
