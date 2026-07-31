import { useCallback, useEffect, useState } from "react";
import { FileText, Pill, Plus, Loader2, CircleAlert } from "lucide-react";
import { patientApi } from "../lib/api.js";
import RecordCard from "./RecordCard.jsx";
import RecordFormModal from "./RecordFormModal.jsx";

/**
 * Patient "Health Records" view — real records + prescriptions from the
 * backend, with self-upload for digitizing old paper reports.
 */
export default function RecordsView({ accessToken, initialTab = "records", onCountsChanged }) {
  const [tab, setTab] = useState(initialTab); // "records" | "prescriptions"
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await patientApi.listRecords(accessToken);
      setRecords(res.data.records);
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

  const prescriptions = records.filter((r) => r.type === "prescription");
  const shown = tab === "prescriptions" ? prescriptions : records;

  const handleCreated = async (payload) => {
    const res = await patientApi.createRecord(payload, accessToken);
    await load();
    onCountsChanged?.();
    return res;
  };

  const togglePrescription = async (record, active) => {
    setBusyId(record._id);
    try {
      await patientApi.setPrescriptionStatus(record._id, active, accessToken);
      await load();
      onCountsChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (record) => {
    setBusyId(record._id);
    try {
      await patientApi.deleteRecord(record._id, accessToken);
      await load();
      onCountsChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 border-b border-slate-100">
          {[
            { key: "records", label: "Medical Records", count: records.length },
            { key: "prescriptions", label: "Prescriptions", count: prescriptions.length },
          ].map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 border-b-2 px-3 pb-3 text-sm font-semibold transition ${
                tab === t.key
                  ? "border-brand-600 text-brand-600"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {t.label}
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                  tab === t.key ? "bg-brand-50 text-brand-600" : "bg-slate-100 text-slate-500"
                }`}
              >
                {t.count}
              </span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          <Plus size={15} /> Add Record
        </button>
      </div>

      {error && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <CircleAlert size={15} /> {error}
        </div>
      )}

      <div className="mt-6">
        {loading ? (
          <div className="flex items-center gap-2 py-10 text-sm text-slate-400">
            <Loader2 size={16} className="animate-spin" /> Loading records…
          </div>
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-200 bg-white px-6 py-14 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
              {tab === "prescriptions" ? <Pill size={22} /> : <FileText size={22} />}
            </span>
            <div className="font-display font-bold text-slate-700">
              {tab === "prescriptions" ? "No prescriptions yet" : "No medical records yet"}
            </div>
            <p className="max-w-md text-sm text-slate-400">
              Records added by your linked hospitals appear here automatically. You can also add
              your own — old reports, past prescriptions — using the Add Record button.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {shown.map((record) => (
              <RecordCard
                key={record._id}
                record={record}
                busy={busyId === record._id}
                onTogglePrescription={togglePrescription}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>

      <RecordFormModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSubmit={handleCreated}
        heading="Add a self-reported record"
        subheading="Digitize an old report or note something your doctor told you. Self-reported entries are labelled as such."
      />
    </div>
  );
}
