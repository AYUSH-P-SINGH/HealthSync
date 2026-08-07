import { useCallback, useEffect, useState } from "react";
import { X, Plus, Loader2, CircleAlert, FileText, ScanLine } from "lucide-react";
import { hospitalApi } from "../lib/api.js";
import RecordCard from "./RecordCard.jsx";
import RecordFormModal from "./RecordFormModal.jsx";
import FollowUpSafetyNet from "./FollowUpSafetyNet.jsx";
import ScanReportModal from "./ScanReportModal.jsx";

/**
 * Hospital slide-over for one linked patient: the records this hospital has
 * issued, plus an "Add record" flow (prescriptions run safety checks and
 * surface interaction/allergy alerts immediately).
 */
export default function PatientRecordsPanel({ link, accessToken, onClose }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  // Bumping this key remounts the safety net so it refetches after a record
  // is filed — a new record can auto-close an open loop.
  const [safetyNetKey, setSafetyNetKey] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await hospitalApi.listPatientRecords(link._id, accessToken);
      setRecords(res.data.records);
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [link._id, accessToken]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async (payload) => {
    const res = await hospitalApi.createPatientRecord(link._id, payload, accessToken);
    await load();
    // Filing a record can both create new follow-ups and auto-close existing
    // ones, so the safety net has to re-read after every write.
    setSafetyNetKey((k) => k + 1);
    return res; // RecordFormModal shows any safety alerts from res.data.alerts
  };

  const patientName = link.patient?.name || "Patient";

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-slate-900/40" />
      <aside className="relative flex h-full w-full max-w-2xl flex-col overflow-hidden bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="flex items-center gap-2 font-display text-lg font-bold text-brand-900">
              <FileText size={18} /> {patientName} — records
            </h2>
            <p className="text-xs text-slate-400">
              {link.patient?.patientId} · records issued by your hospital
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Scan sits beside "Add record" because both answer the same
                question — "I have a report in my hand, what now?" */}
            <button
              type="button"
              onClick={() => setScanOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3.5 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
            >
              <ScanLine size={14} /> Scan report
            </button>
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
            >
              <Plus size={14} /> Add record
            </button>
            <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-50">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* The safety net renders ABOVE the records, and renders nothing at
              all when there are no overdue loops. A clinician opening this
              chart for an unrelated reason cannot miss it. */}
          <FollowUpSafetyNet
            key={safetyNetKey}
            accessToken={accessToken}
            linkId={link._id}
            onResolved={() => setSafetyNetKey((k) => k + 1)}
          />

          {error && (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
              <CircleAlert size={15} /> {error}
            </div>
          )}
          {loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-slate-400">
              <Loader2 size={16} className="animate-spin" /> Loading records…
            </div>
          ) : records.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">
              No records issued yet. Add the first visit note, prescription or lab report for{" "}
              {patientName}.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {records.map((record) => (
                <RecordCard key={record._id} record={record} />
              ))}
            </div>
          )}
        </div>
      </aside>

      <RecordFormModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSubmit={handleCreate}
        heading={`Add record for ${patientName}`}
        subheading="Prescriptions are automatically checked against the patient's active medicines and recorded allergies."
      />

      <ScanReportModal
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        accessToken={accessToken}
        linkId={link._id}
        heading={`Scan a report for ${patientName}`}
        onSaved={() => setSafetyNetKey((k) => k + 1)}
      />
    </div>
  );
}
