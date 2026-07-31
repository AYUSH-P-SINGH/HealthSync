import { useState } from "react";
import { X, Plus, Trash2, Loader2, CircleAlert, TriangleAlert } from "lucide-react";
import { RECORD_TYPES, ALERT_STYLES } from "../lib/records.js";

const inputCls =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100";

const emptyMedicine = () => ({ name: "", dosage: "", frequency: "", duration: "" });
const emptyLabResult = () => ({ name: "", value: "", unit: "", referenceRange: "", flag: "" });

/**
 * Shared "add medical record" modal.
 * Used by the patient (self-reported records) and the hospital (records for
 * a linked patient). `onSubmit(payload)` must return the API response; if the
 * response carries safety alerts (prescriptions), they're shown before close.
 */
export default function RecordFormModal({ open, onClose, onSubmit, heading, subheading }) {
  const [type, setType] = useState("visit");
  const [form, setForm] = useState({ title: "", description: "", condition: "", doctorName: "", recordDate: "" });
  const [medicines, setMedicines] = useState([emptyMedicine()]);
  const [labResults, setLabResults] = useState([emptyLabResult()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [resultAlerts, setResultAlerts] = useState(null); // alerts returned after save

  if (!open) return null;

  const setField = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const reset = () => {
    setType("visit");
    setForm({ title: "", description: "", condition: "", doctorName: "", recordDate: "" });
    setMedicines([emptyMedicine()]);
    setLabResults([emptyLabResult()]);
    setError("");
    setResultAlerts(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const payload = {
      type,
      title: form.title.trim(),
      description: form.description.trim(),
      condition: form.condition.trim() || undefined,
      doctorName: form.doctorName.trim() || undefined,
      recordDate: form.recordDate || undefined,
    };
    if (type === "prescription") {
      payload.medicines = medicines.filter((m) => m.name.trim());
      if (payload.medicines.length === 0) {
        setError("Add at least one medicine to the prescription.");
        return;
      }
    }
    if (type === "lab_report") {
      payload.labResults = labResults
        .filter((r) => r.name.trim())
        .map((r) => ({ ...r, flag: r.flag || undefined }));
    }

    setSaving(true);
    setError("");
    try {
      const res = await onSubmit(payload);
      const alerts = res?.data?.alerts || [];
      if (alerts.length > 0) {
        setResultAlerts(alerts); // show safety alerts before closing
      } else {
        close();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Close" onClick={close} className="absolute inset-0 bg-slate-900/40" />
      <div className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        {resultAlerts ? (
          /* Post-save safety alert review */
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-100 text-rose-600">
                <TriangleAlert size={19} />
              </span>
              <div>
                <h2 className="font-display text-lg font-bold text-slate-800">
                  Record saved — review safety alerts
                </h2>
                <p className="text-xs text-slate-500">
                  Automated interaction &amp; allergy checks flagged the following:
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-2">
              {resultAlerts.map((alert, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${
                    ALERT_STYLES[alert.severity] || ALERT_STYLES.info
                  }`}
                >
                  <TriangleAlert size={15} className="mt-0.5 shrink-0" />
                  <span>
                    {alert.message} <span className="opacity-60">({alert.source})</span>
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-slate-400">
              These checks are informational and do not replace clinical judgement.
            </p>
            <button
              type="button"
              onClick={close}
              className="mt-4 w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
            >
              Understood
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display text-lg font-bold text-brand-900">{heading}</h2>
                {subheading && <p className="mt-0.5 text-xs text-slate-500">{subheading}</p>}
              </div>
              <button type="button" onClick={close} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-50">
                <X size={18} />
              </button>
            </div>

            {error && (
              <div className="mt-4 flex items-center gap-2 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
                <CircleAlert size={15} /> {error}
              </div>
            )}

            {/* Type selector */}
            <div className="mt-4 flex flex-wrap gap-2">
              {RECORD_TYPES.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setType(t.key)}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                    type === t.key ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  <t.icon size={13} /> {t.label}
                </button>
              ))}
            </div>

            <form onSubmit={handleSubmit} className="mt-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block sm:col-span-2">
                  <span className="mb-1.5 block text-xs font-semibold text-slate-500">Title *</span>
                  <input
                    className={inputCls}
                    value={form.title}
                    onChange={setField("title")}
                    placeholder={
                      type === "prescription"
                        ? "e.g. Post-viral fever prescription"
                        : type === "lab_report"
                          ? "e.g. Complete Blood Count"
                          : "e.g. OPD consultation — fever"
                    }
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold text-slate-500">Date</span>
                  <input
                    type="date"
                    className={inputCls}
                    value={form.recordDate}
                    onChange={setField("recordDate")}
                    max={new Date().toISOString().slice(0, 10)}
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold text-slate-500">Condition / diagnosis tag</span>
                  <input
                    className={inputCls}
                    value={form.condition}
                    onChange={setField("condition")}
                    placeholder="e.g. Type 2 Diabetes"
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="mb-1.5 block text-xs font-semibold text-slate-500">Doctor</span>
                  <input
                    className={inputCls}
                    value={form.doctorName}
                    onChange={setField("doctorName")}
                    placeholder="Treating doctor's name"
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="mb-1.5 block text-xs font-semibold text-slate-500">Notes</span>
                  <textarea
                    rows={2}
                    className={inputCls}
                    value={form.description}
                    onChange={setField("description")}
                    placeholder="Summary, symptoms, advice given…"
                  />
                </label>
              </div>

              {/* Prescription: medicines */}
              {type === "prescription" && (
                <div className="mt-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-800">Medicines *</h3>
                    <button
                      type="button"
                      onClick={() => setMedicines((m) => [...m, emptyMedicine()])}
                      className="flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline"
                    >
                      <Plus size={13} /> Add medicine
                    </button>
                  </div>
                  <div className="mt-2 flex flex-col gap-2">
                    {medicines.map((m, i) => (
                      <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border border-slate-100 bg-slate-50/60 p-2 sm:grid-cols-[1fr_90px_110px_90px_32px]">
                        <input className={inputCls} placeholder="Medicine name" value={m.name}
                          onChange={(e) => setMedicines((all) => all.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                        <input className={inputCls} placeholder="Dosage" value={m.dosage}
                          onChange={(e) => setMedicines((all) => all.map((x, j) => (j === i ? { ...x, dosage: e.target.value } : x)))} />
                        <input className={inputCls} placeholder="Frequency" value={m.frequency}
                          onChange={(e) => setMedicines((all) => all.map((x, j) => (j === i ? { ...x, frequency: e.target.value } : x)))} />
                        <input className={inputCls} placeholder="Duration" value={m.duration}
                          onChange={(e) => setMedicines((all) => all.map((x, j) => (j === i ? { ...x, duration: e.target.value } : x)))} />
                        <button type="button" title="Remove" disabled={medicines.length === 1}
                          onClick={() => setMedicines((all) => all.filter((_, j) => j !== i))}
                          className="flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 disabled:opacity-30">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-slate-400">
                    Saving runs automatic drug-interaction and allergy checks against the patient&apos;s
                    active medicines and recorded allergies.
                  </p>
                </div>
              )}

              {/* Lab report: results */}
              {type === "lab_report" && (
                <div className="mt-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-800">Test results</h3>
                    <button
                      type="button"
                      onClick={() => setLabResults((r) => [...r, emptyLabResult()])}
                      className="flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline"
                    >
                      <Plus size={13} /> Add result
                    </button>
                  </div>
                  <div className="mt-2 flex flex-col gap-2">
                    {labResults.map((r, i) => (
                      <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border border-slate-100 bg-slate-50/60 p-2 sm:grid-cols-[1fr_80px_70px_110px_90px_32px]">
                        <input className={inputCls} placeholder="Test name" value={r.name}
                          onChange={(e) => setLabResults((all) => all.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                        <input className={inputCls} placeholder="Value" value={r.value}
                          onChange={(e) => setLabResults((all) => all.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                        <input className={inputCls} placeholder="Unit" value={r.unit}
                          onChange={(e) => setLabResults((all) => all.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))} />
                        <input className={inputCls} placeholder="Ref. range" value={r.referenceRange}
                          onChange={(e) => setLabResults((all) => all.map((x, j) => (j === i ? { ...x, referenceRange: e.target.value } : x)))} />
                        <select className={inputCls} value={r.flag}
                          onChange={(e) => setLabResults((all) => all.map((x, j) => (j === i ? { ...x, flag: e.target.value } : x)))}>
                          <option value="">Flag…</option>
                          <option value="normal">Normal</option>
                          <option value="low">Low</option>
                          <option value="high">High</option>
                          <option value="critical">Critical</option>
                        </select>
                        <button type="button" title="Remove" disabled={labResults.length === 1}
                          onClick={() => setLabResults((all) => all.filter((_, j) => j !== i))}
                          className="flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 disabled:opacity-30">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-6 flex items-center gap-3">
                <button
                  type="submit"
                  disabled={saving || !form.title.trim()}
                  className="flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
                >
                  {saving && <Loader2 size={15} className="animate-spin" />}
                  Save Record
                </button>
                <button
                  type="button"
                  onClick={close}
                  disabled={saving}
                  className="rounded-lg border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
