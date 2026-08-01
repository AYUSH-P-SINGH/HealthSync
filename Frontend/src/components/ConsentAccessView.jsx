import { useCallback, useEffect, useState } from "react";
import {
  KeyRound,
  Loader2,
  CircleAlert,
  Clock3,
  Eye,
  ShieldCheck,
  X,
  UserRound,
  Droplets,
  TriangleAlert,
} from "lucide-react";
import { hospitalApi } from "../lib/api.js";
import { typeMeta } from "../lib/records.js";
import { formatDate } from "../lib/format.js";
import RecordCard from "./RecordCard.jsx";

const scopeLabel = (s) => (s === "all" ? "All records" : typeMeta(s).label);

function timeLeft(expiresAt) {
  const ms = new Date(expiresAt) - Date.now();
  if (ms <= 0) return "expired";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
}

/**
 * Hospital "Consent Access" view — redeem a patient's OTP/QR code, list the
 * grants this hospital holds, and read records through a still-valid grant.
 */
export default function ConsentAccessView({ accessToken }) {
  const [consents, setConsents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [code, setCode] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [claimMessage, setClaimMessage] = useState("");

  const [viewing, setViewing] = useState(null); // consent being viewed
  const [viewData, setViewData] = useState(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [viewError, setViewError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await hospitalApi.listConsents(accessToken);
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

  const handleClaim = async (e) => {
    e.preventDefault();
    if (!code.trim()) return;
    setClaiming(true);
    setError("");
    setClaimMessage("");
    try {
      const res = await hospitalApi.claimConsent(code.trim(), accessToken);
      setClaimMessage(res.message || "Access granted.");
      setCode("");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setClaiming(false);
    }
  };

  const openRecords = async (consent) => {
    setViewing(consent);
    setViewData(null);
    setViewError("");
    setViewLoading(true);
    try {
      const res = await hospitalApi.getConsentRecords(consent._id, accessToken);
      setViewData(res.data);
    } catch (err) {
      setViewError(err.message);
    } finally {
      setViewLoading(false);
    }
  };

  const closeViewer = () => {
    setViewing(null);
    setViewData(null);
    load(); // refresh access counters
  };

  return (
    <div>
      {/* Claim form */}
      <section className="rounded-xl border border-slate-100 bg-white p-6 shadow-sm">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold text-brand-900">
          <KeyRound size={18} /> Redeem a patient access code
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Patients generate time-bound, scope-limited codes from their dashboard. Enter the code
          (or the text from a scanned QR) to gain temporary read access — no permanent link needed.
        </p>
        <form onSubmit={handleClaim} className="mt-4 flex flex-wrap items-center gap-3">
          <input
            className="w-64 rounded-lg border border-slate-200 px-3 py-2.5 font-mono text-sm uppercase tracking-widest text-slate-700 placeholder:font-sans placeholder:normal-case placeholder:tracking-normal placeholder:text-slate-400 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100"
            placeholder="e.g. K7DM-P3XW"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <button
            type="submit"
            disabled={claiming || !code.trim()}
            className="flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
          >
            {claiming && <Loader2 size={15} className="animate-spin" />}
            Redeem code
          </button>
        </form>
        {claimMessage && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700">
            <ShieldCheck size={15} /> {claimMessage}
          </div>
        )}
        {error && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
            <CircleAlert size={15} /> {error}
          </div>
        )}
      </section>

      {/* Grants held */}
      <h2 className="mt-8 font-display text-lg font-bold text-brand-900">Active &amp; past grants</h2>
      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-slate-400">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      ) : consents.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-400">
          No consent grants yet. Redeem a patient&apos;s code above to get scoped access.
        </p>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {consents.map((c) => {
            const status = c.effectiveStatus;
            const usable = status === "claimed";
            return (
              <div key={c._id} className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                      <UserRound size={14} className="text-slate-400" />
                      {c.patient?.name || "Patient"}
                      <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-bold text-brand-600">
                        {c.patient?.patientId || "—"}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-400">
                      {c.patient?.age != null && <span>{c.patient.age} Y</span>}
                      {c.patient?.gender && <span className="capitalize">{c.patient.gender}</span>}
                      {c.patient?.bloodGroup && (
                        <span className="flex items-center gap-1">
                          <Droplets size={11} /> {c.patient.bloodGroup}
                        </span>
                      )}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold capitalize ${
                      usable
                        ? "bg-emerald-100 text-emerald-700"
                        : status === "revoked"
                          ? "bg-rose-100 text-rose-700"
                          : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {usable ? "Active" : status}
                  </span>
                </div>

                {(c.patient?.allergies?.length || 0) > 0 && (
                  <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-rose-50 px-2.5 py-1.5 text-xs text-rose-700">
                    <TriangleAlert size={12} className="mt-0.5 shrink-0" />
                    <span>Allergies: {c.patient.allergies.join(", ")}</span>
                  </div>
                )}

                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {c.scopes.map((s) => (
                    <span key={s} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                      {scopeLabel(s)}
                    </span>
                  ))}
                </div>

                <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
                  <span className="flex items-center gap-1">
                    <Clock3 size={12} /> {usable ? timeLeft(c.expiresAt) : `Expired ${formatDate(c.expiresAt)}`}
                  </span>
                  {c.accessCount > 0 && (
                    <span className="flex items-center gap-1">
                      <Eye size={12} /> {c.accessCount} view{c.accessCount > 1 ? "s" : ""}
                    </span>
                  )}
                </div>

                {usable && (
                  <button
                    type="button"
                    onClick={() => openRecords(c)}
                    className="mt-3 w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
                  >
                    View shared records
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Records viewer modal */}
      {viewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" aria-label="Close" onClick={closeViewer} className="absolute inset-0 bg-slate-900/40" />
          <div className="relative flex max-h-[88vh] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div>
                <h2 className="font-display text-lg font-bold text-brand-900">
                  {viewing.patient?.name || "Patient"} — shared records
                </h2>
                <p className="text-xs text-slate-400">
                  Scoped access · every view is logged and visible to the patient
                </p>
              </div>
              <button type="button" onClick={closeViewer} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-50">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {viewLoading ? (
                <div className="flex items-center gap-2 py-8 text-sm text-slate-400">
                  <Loader2 size={16} className="animate-spin" /> Loading shared records…
                </div>
              ) : viewError ? (
                <div className="flex items-center gap-2 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
                  <CircleAlert size={15} /> {viewError}
                </div>
              ) : !viewData || viewData.records.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-400">
                  No records of the granted types yet.
                </p>
              ) : (
                <div className="flex flex-col gap-3">
                  {viewData.records.map((record) => (
                    <RecordCard key={record._id} record={record} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
