import { useEffect, useState } from "react";
import { ShieldAlert, X, ArrowRight } from "lucide-react";
import { advisoryApi } from "../lib/api.js";
import { severityMeta } from "../lib/records.js";

/**
 * Slim dashboard banner shown only when a warning/critical health advisory
 * is active. Dismissal is remembered per-advisory for the session.
 */
export default function AdvisoryBanner({ accessToken, onOpenHealthTab }) {
  const [banner, setBanner] = useState(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem("hs_dismissed_advisories") || "[]");
    } catch {
      return [];
    }
  });

  useEffect(() => {
    let cancelled = false;
    advisoryApi
      .getActive(accessToken)
      .then((res) => {
        if (!cancelled) setBanner(res.data.banner);
      })
      .catch(() => {}); // banner is non-critical
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  if (!banner || dismissed.includes(banner._id)) return null;

  const sev = severityMeta(banner.severity);

  const dismiss = () => {
    const next = [...dismissed, banner._id];
    setDismissed(next);
    try {
      sessionStorage.setItem("hs_dismissed_advisories", JSON.stringify(next));
    } catch {
      /* best-effort */
    }
  };

  return (
    <div className={`mt-4 flex items-center gap-3 rounded-xl border px-4 py-3 ${sev.card}`}>
      <ShieldAlert size={18} className="shrink-0" />
      <div className="min-w-0 flex-1 text-sm">
        <span className="font-bold text-slate-800">{banner.title}</span>
        <span className="ml-2 text-slate-600">
          {banner.region} · {sev.label}
        </span>
      </div>
      <button
        type="button"
        onClick={onOpenHealthTab}
        className="flex shrink-0 items-center gap-1 rounded-lg bg-white/70 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-white"
      >
        Precautions <ArrowRight size={12} />
      </button>
      <button type="button" onClick={dismiss} aria-label="Dismiss" className="shrink-0 text-slate-400 hover:text-slate-600">
        <X size={15} />
      </button>
    </div>
  );
}
