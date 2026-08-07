import { useCallback, useEffect, useState } from "react";
import {
  TriangleAlert, Building2, CalendarClock, Loader2, CheckCircle2,
  CalendarCheck, ChevronDown, ChevronUp, X,
} from "lucide-react";
import { hospitalApi } from "../lib/api.js";

/**
 * Hospital-side follow-up safety net.
 *
 * This is the clinically important surface. A clinician opens this patient's
 * chart for something unrelated, and any OVERDUE follow-up — issued by ANY
 * hospital, not just this one — is sitting at the top of the screen.
 *
 * Design constraints, in priority order:
 *  1. Impossible to miss. It is a banner above the records, not a tab. A
 *     clinician will not go looking for a warning they don't know exists.
 *  2. Impossible to clear thoughtlessly. Dismissal requires a written reason
 *     and is attributed in the audit log. Marking it done is one click,
 *     because that is the outcome we actually want.
 *  3. Silent when there is nothing to say. Renders nothing at all when there
 *     are no open loops — a banner that is always present is furniture, and
 *     furniture does not get read.
 */

const SEVERITY_STYLES = {
  critical: "border-rose-300 bg-rose-50",
  urgent: "border-amber-300 bg-amber-50",
  routine: "border-amber-200 bg-amber-50/60",
};

const CATEGORY_LABELS = {
  imaging: "Imaging",
  lab: "Lab test",
  consult: "Consultation",
  procedure: "Procedure",
  medication: "Medication",
  other: "Follow-up",
};

const formatDate = (v) =>
  new Date(v).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export default function FollowUpSafetyNet({ accessToken, linkId, consentId, onResolved }) {
  const [followUps, setFollowUps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");
  const [dismissing, setDismissing] = useState(null);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    if (!linkId && !consentId) return;
    try {
      const res = await hospitalApi.listPatientFollowUps(accessToken, { linkId, consentId });
      setFollowUps(res.data.followUps);
      setError("");
    } catch (err) {
      // A failure here must not break the records panel around it — the
      // clinician still needs the chart. Fail quiet, log loud.
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [accessToken, linkId, consentId]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (followUp, action, extra = {}) => {
    setBusyId(followUp._id);
    setError("");
    try {
      await hospitalApi.actOnFollowUp(
        followUp._id,
        { action, linkId, consentId, ...extra },
        accessToken
      );
      await load();
      onResolved?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const confirmDismiss = async () => {
    if (reason.trim().length < 5) return;
    const target = dismissing;
    setDismissing(null);
    await act(target, "dismiss", { reason: reason.trim() });
    setReason("");
  };

  // Silent when there is nothing to report.
  if (loading || (followUps.length === 0 && !error)) return null;

  if (error && followUps.length === 0) {
    return (
      <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
        Could not load follow-up history for this patient. ({error})
      </div>
    );
  }

  const worst = followUps.some((f) => f.severity === "critical")
    ? "critical"
    : followUps.some((f) => f.severity === "urgent")
      ? "urgent"
      : "routine";

  return (
    <div className={`mb-4 overflow-hidden rounded-xl border-2 ${SEVERITY_STYLES[worst]}`}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left"
      >
        <TriangleAlert size={18} className="shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1">
          <p className="font-display text-sm font-bold text-slate-800">
            {followUps.length} overdue follow-up{followUps.length > 1 ? "s" : ""} on this patient
          </p>
          <p className="text-xs text-slate-600">
            Recommended by a previous report and not yet completed. Review before discharge.
          </p>
        </div>
        {expanded ? (
          <ChevronUp size={16} className="shrink-0 text-slate-500" />
        ) : (
          <ChevronDown size={16} className="shrink-0 text-slate-500" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-amber-200/70 bg-white/70 px-4 py-3">
          {error && (
            <p className="mb-2 text-xs text-rose-600">{error}</p>
          )}

          <div className="flex flex-col gap-3">
            {followUps.map((f) => {
              const busy = busyId === f._id;
              return (
                <div key={f._id} className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-sm font-bold text-slate-800">{f.action}</span>
                    <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-700">
                      {f.daysOverdue} day{f.daysOverdue === 1 ? "" : "s"} overdue
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                      {CATEGORY_LABELS[f.category] || f.category}
                    </span>
                    {f.severity !== "routine" && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold uppercase text-amber-800">
                        {f.severity}
                      </span>
                    )}
                  </div>

                  <p className="mt-1.5 text-sm text-slate-600">
                    <span className="text-slate-400">Finding:</span> {f.finding}
                  </p>

                  <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                    <span className="flex items-center gap-1">
                      <CalendarClock size={12} /> Was due {formatDate(f.dueAt)}
                    </span>
                    {f.sourceHospital?.name && (
                      <span className="flex items-center gap-1">
                        <Building2 size={12} /> Issued by {f.sourceHospital.name}
                        {f.sourceHospital.city ? `, ${f.sourceHospital.city}` : ""}
                      </span>
                    )}
                    <span>Report dated {formatDate(f.issuedOn)}</span>
                  </div>

                  {/* Verbatim provenance so the clinician can judge the extraction */}
                  {f.sourceText && (
                    <blockquote className="mt-2 border-l-2 border-slate-200 bg-slate-50 py-1.5 pl-3 text-xs italic text-slate-500">
                      "{f.sourceText}"
                    </blockquote>
                  )}

                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => act(f, "complete")}
                      className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
                    >
                      {busy ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                      Mark completed
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => act(f, "schedule")}
                      className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                    >
                      <CalendarCheck size={12} /> Scheduled it
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setDismissing(f)}
                      className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-400 transition hover:bg-slate-50 hover:text-slate-600 disabled:opacity-50"
                    >
                      Not applicable
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Dismissal requires a reason and is attributed in the audit log. */}
      {dismissing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Cancel"
            onClick={() => {
              setDismissing(null);
              setReason("");
            }}
            className="absolute inset-0 bg-slate-900/50"
          />
          <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="font-display text-base font-bold text-brand-900">
              Dismiss this follow-up?
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              "{dismissing.action}" will stop being flagged to any treating clinician. This is
              recorded against your hospital in the patient's audit trail.
            </p>
            <textarea
              rows={3}
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Clinical reason — e.g. superseded by newer imaging, patient declined, no longer indicated"
              className="mt-3 w-full resize-none rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setDismissing(null);
                  setReason("");
                }}
                className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={reason.trim().length < 5}
                onClick={confirmDismiss}
                className="flex items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <X size={14} /> Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
