import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ScanLine, Loader2, CircleAlert, CalendarClock, CheckCircle2, Clock,
  ShieldQuestion, Building2, X, CalendarCheck, TriangleAlert, Undo2, FastForward,
} from "lucide-react";
import { patientApi } from "../lib/api.js";
import { onSocketEvent } from "../lib/socket.js";
import ScanReportModal from "./ScanReportModal.jsx";

/**
 * Patient "Follow-ups" view — the owner's view of open clinical loops.
 *
 * Tone is a deliberate product decision. These are real findings and some of
 * them matter, but the person reading this is not a clinician and cannot
 * interpret a 6 mm nodule. Alarming them produces avoidance, not appointments.
 * So: neutral colour for what is upcoming, urgency reserved for genuinely
 * overdue items, and always a concrete next action rather than a warning.
 */

const STATUS_META = {
  pending_confirm: {
    label: "Needs confirmation",
    chip: "bg-violet-50 text-violet-700 border-violet-200",
    icon: ShieldQuestion,
  },
  open: { label: "Tracking", chip: "bg-sky-50 text-sky-700 border-sky-200", icon: Clock },
  scheduled: {
    label: "Scheduled",
    chip: "bg-emerald-50 text-emerald-700 border-emerald-200",
    icon: CalendarCheck,
  },
  overdue: { label: "Overdue", chip: "bg-rose-50 text-rose-700 border-rose-200", icon: TriangleAlert },
  completed: { label: "Done", chip: "bg-slate-100 text-slate-500 border-slate-200", icon: CheckCircle2 },
  dismissed: { label: "Dismissed", chip: "bg-slate-100 text-slate-400 border-slate-200", icon: X },
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

/** Human-readable countdown; the sign carries the urgency, not the wording. */
function dueLabel(dueAt) {
  const days = Math.ceil((new Date(dueAt).getTime() - Date.now()) / 86_400_000);
  if (days < -1) return { text: `${Math.abs(days)} days overdue`, overdue: true };
  if (days === -1 || days === 0) return { text: "Due today", overdue: days < 0 };
  if (days === 1) return { text: "Due tomorrow", overdue: false };
  if (days < 31) return { text: `Due in ${days} days`, overdue: false };
  const months = Math.round(days / 30);
  return { text: `Due in about ${months} month${months > 1 ? "s" : ""}`, overdue: false };
}

const isDev = import.meta.env.DEV;

export default function FollowUpsView({ accessToken, onCountsChanged }) {
  const [followUps, setFollowUps] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [dismissing, setDismissing] = useState(null); // followUp being dismissed
  const [dismissReason, setDismissReason] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await patientApi.listFollowUps(accessToken, {
        includeResolved: showResolved ? "true" : undefined,
      });
      setFollowUps(res.data.followUps);
      setCounts(res.data.counts);
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [accessToken, showResolved]);

  useEffect(() => {
    load();
  }, [load]);

  // Live updates — the scheduler can escalate an item while the tab is open.
  useEffect(() => {
    const events = ["followup:new", "followup:updated", "followup:closed", "followup:reminder"];
    const unsubs = events.map((e) => onSocketEvent(e, load));
    return () => unsubs.forEach((u) => u());
  }, [load]);

  const act = async (fn, followUp) => {
    setBusyId(followUp._id);
    setError("");
    try {
      await fn();
      await load();
      onCountsChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const confirmDismiss = async () => {
    if (dismissReason.trim().length < 5) return;
    const target = dismissing;
    setDismissing(null);
    await act(
      () => patientApi.dismissFollowUp(target._id, dismissReason.trim(), accessToken),
      target
    );
    setDismissReason("");
  };

  /** Sort: overdue first, then soonest due. Resolved items sink to the bottom. */
  const sorted = useMemo(() => {
    const rank = { overdue: 0, pending_confirm: 1, open: 2, scheduled: 3, completed: 9, dismissed: 9 };
    return [...followUps].sort((a, b) => {
      const ra = rank[a.status] ?? 5;
      const rb = rank[b.status] ?? 5;
      if (ra !== rb) return ra - rb;
      return new Date(a.dueAt) - new Date(b.dueAt);
    });
  }, [followUps]);

  const overdueCount = counts.overdue || 0;
  const needsConfirm = counts.pendingConfirm || 0;

  return (
    <div>
      {/* Header + primary action */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="max-w-2xl text-sm text-slate-500">
            When a report recommends something for later — a repeat scan, a blood test, a referral —
            it gets tracked here with a due date, so it doesn't get lost between visits.
          </p>
          {(overdueCount > 0 || needsConfirm > 0) && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-semibold">
              {overdueCount > 0 && (
                <span className="rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-rose-700">
                  {overdueCount} overdue
                </span>
              )}
              {needsConfirm > 0 && (
                <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-violet-700">
                  {needsConfirm} awaiting your confirmation
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isDev && followUps.length > 0 && (
            <button
              type="button"
              title="Development only — fast-forward your follow-up clock to demo escalation"
              onClick={() =>
                act(
                  () => patientApi.advanceFollowUpClock(200, accessToken),
                  { _id: "clock" }
                )
              }
              className="flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs font-semibold text-slate-500 transition hover:bg-slate-50"
            >
              <FastForward size={13} /> +200 days
            </button>
          )}
          <button
            type="button"
            onClick={() => setScanOpen(true)}
            className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
          >
            <ScanLine size={15} /> Scan a report
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <CircleAlert size={15} /> {error}
        </div>
      )}

      {/* List */}
      <div className="mt-6">
        {loading ? (
          <div className="flex items-center gap-2 py-10 text-sm text-slate-400">
            <Loader2 size={16} className="animate-spin" /> Loading follow-ups…
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-200 bg-white px-6 py-14 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
              <CalendarClock size={22} />
            </span>
            <div className="font-display font-bold text-slate-700">No follow-ups being tracked</div>
            <p className="max-w-md text-sm text-slate-400">
              Reports filed by your hospitals are scanned automatically. To check an older report,
              use "Scan a report" and upload the PDF or paste the text.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {sorted.map((f) => {
              const meta = STATUS_META[f.status] || STATUS_META.open;
              const Icon = meta.icon;
              const due = dueLabel(f.dueAt);
              const busy = busyId === f._id;
              const resolved = f.status === "completed" || f.status === "dismissed";

              return (
                <div
                  key={f._id}
                  className={`rounded-xl border bg-white p-4 transition ${
                    due.overdue && !resolved ? "border-rose-200 bg-rose-50/30" : "border-slate-200"
                  } ${resolved ? "opacity-60" : ""}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-sm font-bold text-slate-800">{f.action}</span>
                    <span className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${meta.chip}`}>
                      <Icon size={11} /> {meta.label}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                      {CATEGORY_LABELS[f.category] || f.category}
                    </span>
                  </div>

                  <p className="mt-1.5 text-sm text-slate-600">
                    <span className="text-slate-400">Finding:</span> {f.finding}
                  </p>

                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                    <span
                      className={`flex items-center gap-1 font-semibold ${
                        due.overdue && !resolved ? "text-rose-700" : "text-slate-600"
                      }`}
                    >
                      <CalendarClock size={13} /> {resolved ? formatDate(f.dueAt) : due.text}
                      <span className="font-normal text-slate-400">· {formatDate(f.dueAt)}</span>
                    </span>
                    {f.sourceHospital?.name && (
                      <span className="flex items-center gap-1 text-slate-400">
                        <Building2 size={12} /> from {f.sourceHospital.name}
                      </span>
                    )}
                  </div>

                  {f.sourceText && (
                    <blockquote className="mt-2.5 border-l-2 border-slate-200 bg-slate-50/70 py-1.5 pl-3 text-xs italic text-slate-500">
                      "{f.sourceText}"
                    </blockquote>
                  )}

                  {f.status === "dismissed" && f.dismissReason && (
                    <p className="mt-2 text-xs text-slate-400">Dismissed: {f.dismissReason}</p>
                  )}

                  {/* Actions */}
                  {!resolved && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {f.status === "pending_confirm" ? (
                        <>
                          <p className="w-full text-xs text-violet-700">
                            We read this from your report but aren't fully sure. Does it match what
                            your doctor advised?
                          </p>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              act(() => patientApi.confirmFollowUp(f._id, undefined, accessToken), f)
                            }
                            className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
                          >
                            {busy ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                            Yes, track it
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setDismissing(f)}
                            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-50 disabled:opacity-50"
                          >
                            No, remove it
                          </button>
                        </>
                      ) : (
                        <>
                          {f.status !== "scheduled" && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                act(
                                  () => patientApi.scheduleFollowUp(f._id, undefined, accessToken),
                                  f
                                )
                              }
                              className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                            >
                              <CalendarCheck size={12} /> I've booked it
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              act(() => patientApi.completeFollowUp(f._id, accessToken), f)
                            }
                            className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
                          >
                            {busy ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                            Mark done
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setDismissing(f)}
                            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-400 transition hover:bg-slate-50 hover:text-slate-600 disabled:opacity-50"
                          >
                            Dismiss
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {!loading && (
          <button
            type="button"
            onClick={() => setShowResolved((v) => !v)}
            className="mt-4 flex items-center gap-1.5 text-xs font-semibold text-slate-400 transition hover:text-slate-600"
          >
            <Undo2 size={12} /> {showResolved ? "Hide" : "Show"} completed & dismissed
          </button>
        )}
      </div>

      {/* Dismiss dialog — a reason is required, and it is recorded. */}
      {dismissing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Cancel"
            onClick={() => {
              setDismissing(null);
              setDismissReason("");
            }}
            className="absolute inset-0 bg-slate-900/50"
          />
          <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="font-display text-base font-bold text-brand-900">Dismiss this follow-up?</h3>
            <p className="mt-1 text-sm text-slate-500">
              "{dismissing.action}" will stop being tracked and will no longer be shown to doctors
              treating you. Please say why — it's kept on the record.
            </p>
            <textarea
              rows={3}
              autoFocus
              value={dismissReason}
              onChange={(e) => setDismissReason(e.target.value)}
              placeholder="e.g. Already done at another hospital / my doctor said it isn't needed"
              className="mt-3 w-full resize-none rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setDismissing(null);
                  setDismissReason("");
                }}
                className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={dismissReason.trim().length < 5}
                onClick={confirmDismiss}
                className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      <ScanReportModal
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        accessToken={accessToken}
        onSaved={() => {
          load();
          onCountsChanged?.();
        }}
      />
    </div>
  );
}
