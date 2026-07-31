import { useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  QrCode,
  Loader2,
  CircleAlert,
  Copy,
  Check,
  ShieldCheck,
  Clock3,
  Building2,
  Eye,
} from "lucide-react";
import { patientApi } from "../lib/api.js";
import { RECORD_TYPES, typeMeta } from "../lib/records.js";
import { formatDate } from "../lib/format.js";

const DURATIONS = [
  { hours: 1, label: "1 hour" },
  { hours: 6, label: "6 hours" },
  { hours: 24, label: "24 hours" },
  { hours: 48, label: "48 hours" },
  { hours: 72, label: "3 days" },
  { hours: 168, label: "7 days" },
];

const STATUS_STYLES = {
  issued: "bg-sky-100 text-sky-700",
  claimed: "bg-emerald-100 text-emerald-700",
  revoked: "bg-rose-100 text-rose-700",
  expired: "bg-slate-100 text-slate-500",
};

const scopeLabel = (scope) => (scope === "all" ? "All records" : typeMeta(scope).label);

function timeLeft(expiresAt) {
  const ms = new Date(expiresAt) - Date.now();
  if (ms <= 0) return "expired";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
}

/**
 * Patient consent manager: generate a time-bound, scope-limited access code
 * (shown once, with QR), see who claimed it and how often they accessed
 * records, and revoke any grant early.
 */
export default function ConsentsView({ accessToken }) {
  const [consents, setConsents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Issue form
  const [scopes, setScopes] = useState(["all"]);
  const [durationHours, setDurationHours] = useState(24);
  const [purpose, setPurpose] = useState("");
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState(null); // { code, qrData, consent }
  const [copied, setCopied] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await patientApi.listConsents(accessToken);
      setConsents(res.data.consents);
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

  const toggleScope = (key) => {
    setScopes((prev) => {
      if (key === "all") return ["all"];
      const withoutAll = prev.filter((s) => s !== "all");
      const next = withoutAll.includes(key)
        ? withoutAll.filter((s) => s !== key)
        : [...withoutAll, key];
      return next.length === 0 ? ["all"] : next;
    });
  };

  const handleIssue = async (e) => {
    e.preventDefault();
    setIssuing(true);
    setError("");
    try {
      const res = await patientApi.issueConsent(
        { scopes, durationHours, purpose: purpose.trim() || undefined },
        accessToken
      );
      setIssued(res.data);
      setPurpose("");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setIssuing(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(issued.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const handleRevoke = async (consent) => {
    setBusyId(consent._id);
    setError("");
    try {
      await patientApi.revokeConsent(consent._id, accessToken);
      if (issued?.consent?._id === consent._id) setIssued(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[400px_1fr]">
      {/* Issue a new grant */}
      <section className="h-fit rounded-xl border border-slate-100 bg-white p-6 shadow-sm">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold text-brand-900">
          <QrCode size={18} /> Share access
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Generate a one-time code a hospital can redeem for temporary, scoped access to your
          records — no permanent link required. You can revoke it any time.
        </p>

        {issued ? (
          <div className="mt-5 flex flex-col items-center rounded-xl border border-brand-100 bg-brand-50/50 p-5 text-center">
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <QRCodeSVG value={issued.qrData} size={148} />
            </div>
            <div className="mt-4 font-mono text-2xl font-bold tracking-widest text-brand-900">
              {issued.code}
            </div>
            <button
              type="button"
              onClick={handleCopy}
              className="mt-2 flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
            >
              {copied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
              {copied ? "Copied" : "Copy code"}
            </button>
            <p className="mt-3 text-xs text-slate-500">
              Valid for <b>{issued.consent.durationHours}h</b> ·{" "}
              {issued.consent.scopes.map(scopeLabel).join(", ")}
            </p>
            <p className="mt-1 text-[11px] text-amber-700">
              This code is shown only once — share it directly with your hospital.
            </p>
            <button
              type="button"
              onClick={() => setIssued(null)}
              className="mt-4 text-xs font-semibold text-brand-600 hover:underline"
            >
              Generate another
            </button>
          </div>
        ) : (
          <form onSubmit={handleIssue} className="mt-5">
            <span className="mb-1.5 block text-xs font-semibold text-slate-500">What can they see?</span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => toggleScope("all")}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  scopes.includes("all")
                    ? "bg-brand-600 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                All records
              </button>
              {RECORD_TYPES.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => toggleScope(t.key)}
                  className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    scopes.includes(t.key)
                      ? "bg-brand-600 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  <t.icon size={12} /> {t.label}
                </button>
              ))}
            </div>

            <span className="mb-1.5 mt-4 block text-xs font-semibold text-slate-500">For how long?</span>
            <div className="flex flex-wrap gap-2">
              {DURATIONS.map((d) => (
                <button
                  key={d.hours}
                  type="button"
                  onClick={() => setDurationHours(d.hours)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    durationHours === d.hours
                      ? "bg-brand-600 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>

            <label className="mt-4 block">
              <span className="mb-1.5 block text-xs font-semibold text-slate-500">Purpose (optional)</span>
              <input
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100"
                placeholder="e.g. Second opinion at Apollo"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                maxLength={300}
              />
            </label>

            <button
              type="submit"
              disabled={issuing}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
            >
              {issuing ? <Loader2 size={15} className="animate-spin" /> : <QrCode size={15} />}
              Generate access code
            </button>
          </form>
        )}
      </section>

      {/* Existing grants */}
      <section>
        <h2 className="flex items-center gap-2 font-display text-lg font-bold text-brand-900">
          <ShieldCheck size={18} /> Access grants
        </h2>

        {error && (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <CircleAlert size={15} /> {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 py-10 text-sm text-slate-400">
            <Loader2 size={16} className="animate-spin" /> Loading…
          </div>
        ) : consents.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-400">
            No access grants yet. Generate a code to share your records securely.
          </p>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            {consents.map((c) => {
              const status = c.effectiveStatus;
              const revocable = status === "issued" || status === "claimed";
              return (
                <div key={c._id} className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold capitalize ${STATUS_STYLES[status]}`}>
                        {status === "issued" ? "Awaiting claim" : status}
                      </span>
                      {revocable && (
                        <span className="flex items-center gap-1 text-xs text-slate-400">
                          <Clock3 size={12} /> {timeLeft(c.expiresAt)}
                        </span>
                      )}
                    </div>
                    {revocable && (
                      <button
                        type="button"
                        disabled={busyId === c._id}
                        onClick={() => handleRevoke(c)}
                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-60"
                      >
                        {busyId === c._id ? <Loader2 size={13} className="animate-spin" /> : "Revoke"}
                      </button>
                    )}
                  </div>

                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {c.scopes.map((s) => (
                      <span key={s} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                        {scopeLabel(s)}
                      </span>
                    ))}
                  </div>

                  <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                    {c.hospital ? (
                      <span className="flex items-center gap-1.5 font-medium text-slate-700">
                        <Building2 size={13} /> {c.hospital.name}
                        {c.hospital.city ? ` · ${c.hospital.city}` : ""}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5">
                        <Building2 size={13} /> Not claimed yet
                      </span>
                    )}
                    <span>Issued {formatDate(c.createdAt)}</span>
                    <span>Expires {formatDate(c.expiresAt)}</span>
                    {c.accessCount > 0 && (
                      <span className="flex items-center gap-1 font-medium text-brand-600">
                        <Eye size={12} /> Viewed {c.accessCount} time{c.accessCount > 1 ? "s" : ""}
                      </span>
                    )}
                  </div>

                  {c.purpose && <p className="mt-2 text-xs italic text-slate-400">“{c.purpose}”</p>}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
