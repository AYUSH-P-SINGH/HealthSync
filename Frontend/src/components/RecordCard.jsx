import { useState } from "react";
import {
  Building2,
  UserRound,
  ChevronDown,
  ChevronUp,
  TriangleAlert,
  Loader2,
  Trash2,
} from "lucide-react";
import { typeMeta, ALERT_STYLES } from "../lib/records.js";
import { formatDate } from "../lib/format.js";

/**
 * One medical record, rendered consistently across the patient records
 * list, the timeline, and the hospital's consent/record views.
 * Expandable to show medicines, lab results, and safety alerts.
 */
export default function RecordCard({
  record,
  onTogglePrescription, // (record, nextActive) => Promise — patient only
  onDelete, // (record) => Promise — patient self-reported only
  busy = false,
}) {
  const [open, setOpen] = useState(false);
  const meta = typeMeta(record.type);
  const Icon = meta.icon;

  const sourceName =
    record.hospital?.name || (record.createdByRole === "patient" ? "Self-reported" : "Hospital");
  const hasDetails =
    (record.medicines?.length || 0) > 0 ||
    (record.labResults?.length || 0) > 0 ||
    (record.alerts?.length || 0) > 0 ||
    Boolean(record.description);

  return (
    <div className="rounded-xl border border-slate-100 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => hasDetails && setOpen((o) => !o)}
        className={`flex w-full items-start gap-3 p-4 text-left ${hasDetails ? "cursor-pointer" : "cursor-default"}`}
      >
        <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${meta.chip}`}>
          <Icon size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-800">{record.title}</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${meta.chip}`}>
              {meta.label}
            </span>
            {record.type === "prescription" && record.isActivePrescription != null && (
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                  record.isActivePrescription
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-slate-100 text-slate-500"
                }`}
              >
                {record.isActivePrescription ? "Active" : "Completed"}
              </span>
            )}
            {(record.alerts?.length || 0) > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-700">
                <TriangleAlert size={11} /> {record.alerts.length} alert{record.alerts.length > 1 ? "s" : ""}
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-400">
            <span>{formatDate(record.recordDate)}</span>
            <span className="flex items-center gap-1">
              {record.createdByRole === "patient" ? <UserRound size={12} /> : <Building2 size={12} />}
              {sourceName}
            </span>
            {record.condition && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-500">
                {record.condition}
              </span>
            )}
            {record.doctorName && <span>Dr. {record.doctorName}</span>}
          </div>
        </div>
        {hasDetails && (
          <span className="mt-1 shrink-0 text-slate-300">
            {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </span>
        )}
      </button>

      {open && (
        <div className="border-t border-slate-100 px-4 pb-4 pt-3">
          {record.description && <p className="text-sm text-slate-600">{record.description}</p>}

          {/* Safety alerts */}
          {(record.alerts?.length || 0) > 0 && (
            <div className="mt-3 flex flex-col gap-2">
              {record.alerts.map((alert, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
                    ALERT_STYLES[alert.severity] || ALERT_STYLES.info
                  }`}
                >
                  <TriangleAlert size={13} className="mt-0.5 shrink-0" />
                  <span>
                    {alert.message}
                    <span className="ml-1 opacity-60">({alert.source})</span>
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Medicines */}
          {(record.medicines?.length || 0) > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-slate-400">
                    <th className="py-1.5 pr-3 font-semibold">Medicine</th>
                    <th className="py-1.5 pr-3 font-semibold">Dosage</th>
                    <th className="py-1.5 pr-3 font-semibold">Frequency</th>
                    <th className="py-1.5 font-semibold">Duration</th>
                  </tr>
                </thead>
                <tbody className="text-slate-600">
                  {record.medicines.map((m, i) => (
                    <tr key={i} className="border-t border-slate-50">
                      <td className="py-1.5 pr-3 font-medium text-slate-700">{m.name}</td>
                      <td className="py-1.5 pr-3">{m.dosage || "—"}</td>
                      <td className="py-1.5 pr-3">{m.frequency || "—"}</td>
                      <td className="py-1.5">{m.duration || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Lab results */}
          {(record.labResults?.length || 0) > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-slate-400">
                    <th className="py-1.5 pr-3 font-semibold">Test</th>
                    <th className="py-1.5 pr-3 font-semibold">Value</th>
                    <th className="py-1.5 pr-3 font-semibold">Reference</th>
                    <th className="py-1.5 font-semibold">Flag</th>
                  </tr>
                </thead>
                <tbody className="text-slate-600">
                  {record.labResults.map((r, i) => (
                    <tr key={i} className="border-t border-slate-50">
                      <td className="py-1.5 pr-3 font-medium text-slate-700">{r.name}</td>
                      <td className="py-1.5 pr-3">
                        {r.value || "—"} {r.unit || ""}
                      </td>
                      <td className="py-1.5 pr-3">{r.referenceRange || "—"}</td>
                      <td className="py-1.5">
                        {r.flag ? (
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                              r.flag === "normal"
                                ? "bg-emerald-50 text-emerald-700"
                                : r.flag === "critical"
                                  ? "bg-rose-100 text-rose-700"
                                  : "bg-amber-50 text-amber-700"
                            }`}
                          >
                            {r.flag}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Patient actions */}
          {(onTogglePrescription || onDelete) && (
            <div className="mt-3 flex items-center gap-2 border-t border-slate-50 pt-3">
              {onTogglePrescription && record.type === "prescription" && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onTogglePrescription(record, !record.isActivePrescription)}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
                >
                  {busy && <Loader2 size={12} className="animate-spin" />}
                  {record.isActivePrescription ? "Mark as completed" : "Mark as active"}
                </button>
              )}
              {onDelete && record.createdByRole === "patient" && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onDelete(record)}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-60"
                >
                  <Trash2 size={12} /> Delete
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
