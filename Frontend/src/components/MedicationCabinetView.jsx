import { useCallback, useEffect, useState } from "react";
import {
  Pill,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Building2,
  Calendar,
  Loader2,
  CircleAlert,
  Search,
  RotateCcw,
  Check,
  ShieldAlert,
} from "lucide-react";
import { patientApi } from "../lib/api.js";
import { formatDate } from "../lib/format.js";

export default function MedicationCabinetView({ accessToken }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("active");
  const [q, setQ] = useState("");
  const [updatingId, setUpdatingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await patientApi.getMedicationCabinet(accessToken);
      setData(res.data);
      setError("");
    } catch (err) {
      setError(err.message || "Failed to load medication cabinet.");
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    load();
  }, [load]);

  const handleToggleStatus = async (recordId, currentActive) => {
    setUpdatingId(recordId);
    try {
      await patientApi.setPrescriptionStatus(recordId, !currentActive, accessToken);
      await load();
    } catch (err) {
      alert(err.message || "Failed to update prescription status.");
    } finally {
      setUpdatingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-12 text-sm text-slate-400">
        <Loader2 size={18} className="animate-spin text-brand-600" /> Loading your medication cabinet…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-rose-100 bg-rose-50 p-4 text-sm text-rose-700">
        <CircleAlert size={16} /> {error}
      </div>
    );
  }

  const activeMeds = data?.activeMedications || [];
  const pastMeds = data?.pastMedications || [];
  const alerts = data?.activeAlerts || [];

  const filterList = (list) => {
    if (!q.trim()) return list;
    const term = q.toLowerCase();
    return list.filter((r) => {
      const matchTitle = (r.title || "").toLowerCase().includes(term);
      const matchCond = (r.condition || "").toLowerCase().includes(term);
      const matchDoc = (r.doctorName || "").toLowerCase().includes(term);
      const matchMed = (r.medicines || []).some(
        (m) => (m.name || "").toLowerCase().includes(term) || (m.dosage || "").toLowerCase().includes(term)
      );
      return matchTitle || matchCond || matchDoc || matchMed;
    });
  };

  const currentList = filterList(tab === "active" ? activeMeds : pastMeds);

  return (
    <div className="space-y-6">
      {/* Header Metric Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Active Prescriptions
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <Pill size={18} />
            </span>
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-800">{data?.totalActive ?? 0}</div>
          <p className="mt-1 text-xs text-slate-400">Currently taking</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Medication History
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
              <Clock size={18} />
            </span>
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-800">{data?.totalPast ?? 0}</div>
          <p className="mt-1 text-xs text-slate-400">Past & discontinued</p>
        </div>

        <div
          className={`rounded-xl border p-4 shadow-sm ${
            alerts.length > 0 ? "border-amber-200 bg-amber-50/50" : "border-slate-200 bg-white"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Interaction Risk
            </span>
            <span
              className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                alerts.length > 0 ? "bg-amber-100 text-amber-700" : "bg-emerald-50 text-emerald-600"
              }`}
            >
              {alerts.length > 0 ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
            </span>
          </div>
          <div
            className={`mt-2 text-2xl font-bold ${
              alerts.length > 0 ? "text-amber-800" : "text-slate-800"
            }`}
          >
            {alerts.length} {alerts.length === 1 ? "Alert" : "Alerts"}
          </div>
          <p className="mt-1 text-xs text-slate-400">
            {alerts.length > 0 ? "Conflicts detected in active meds" : "No drug interactions detected"}
          </p>
        </div>
      </div>

      {/* Polypharmacy & Drug Interaction Alerts Banner */}
      {alerts.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start gap-3">
            <ShieldAlert size={20} className="mt-0.5 shrink-0 text-amber-600" />
            <div>
              <h3 className="font-display font-bold text-amber-900">
                Active Drug-Drug / Allergy Warnings Detected
              </h3>
              <p className="mt-1 text-xs text-amber-700">
                HealthSync cross-referenced your active prescriptions and flagged the following potential conflicts:
              </p>
              <ul className="mt-2 space-y-1.5">
                {alerts.map((alt, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-xs text-amber-800">
                    <span className="font-semibold">• [{alt.severity?.toUpperCase() || "WARNING"}]</span>
                    <span>{alt.message || alt.reason || JSON.stringify(alt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Controls: Tabs + Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTab("active")}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition ${
              tab === "active"
                ? "bg-brand-600 text-white shadow-sm"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            <Pill size={14} /> Active Cabinet ({data?.totalActive ?? 0})
          </button>
          <button
            type="button"
            onClick={() => setTab("history")}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition ${
              tab === "history"
                ? "bg-brand-600 text-white shadow-sm"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            <Clock size={14} /> History / Discontinued ({data?.totalPast ?? 0})
          </button>
        </div>

        <div className="relative w-full sm:w-64">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search medicine or doctor…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full rounded-lg border border-slate-200 py-1.5 pl-8 pr-3 text-xs text-slate-700 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
          />
        </div>
      </div>

      {/* List of Medications */}
      {currentList.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white py-12 text-center">
          <Pill size={28} className="text-slate-300" />
          <h3 className="mt-2 text-sm font-bold text-slate-700">
            {q ? "No medications match your search" : tab === "active" ? "No active prescriptions" : "No past prescription history"}
          </h3>
          <p className="mt-1 max-w-sm text-xs text-slate-400">
            {tab === "active"
              ? "Prescriptions marked as active will appear here along with daily dosing details."
              : "Completed or discontinued prescriptions move here."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {currentList.map((rec) => (
            <div
              key={rec._id}
              className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-brand-300"
            >
              <div>
                {/* Card Top */}
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="inline-block rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                      Prescription
                    </span>
                    <h3 className="mt-1 font-display text-base font-bold text-slate-800">
                      {rec.title || "Prescription"}
                    </h3>
                  </div>
                  <button
                    type="button"
                    disabled={updatingId === rec._id}
                    onClick={() => handleToggleStatus(rec._id, rec.isActivePrescription !== false)}
                    className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                      rec.isActivePrescription !== false
                        ? "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                    }`}
                  >
                    {updatingId === rec._id ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : rec.isActivePrescription !== false ? (
                      <>
                        <Check size={12} /> Mark Completed
                      </>
                    ) : (
                      <>
                        <RotateCcw size={12} /> Mark Active
                      </>
                    )}
                  </button>
                </div>

                {/* Condition & Doctor Metadata */}
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                  {rec.doctorName && <span>Dr. {rec.doctorName}</span>}
                  {rec.hospital && (
                    <span className="flex items-center gap-1">
                      <Building2 size={12} /> {rec.hospital.name}
                    </span>
                  )}
                  {rec.recordDate && (
                    <span className="flex items-center gap-1">
                      <Calendar size={12} /> {formatDate(rec.recordDate)}
                    </span>
                  )}
                </div>

                {/* Medicines List */}
                <div className="mt-4 space-y-2">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Prescribed Medicines
                  </div>
                  {(rec.medicines || []).length === 0 ? (
                    <p className="text-xs text-slate-400 italic">No specific drugs listed</p>
                  ) : (
                    <div className="space-y-1.5">
                      {rec.medicines.map((m, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs"
                        >
                          <div className="flex items-center gap-2 font-semibold text-slate-700">
                            <Pill size={13} className="text-brand-600" />
                            {m.name}
                          </div>
                          <div className="flex items-center gap-2 text-slate-500">
                            {m.dosage && (
                              <span className="rounded bg-white px-1.5 py-0.5 text-[11px] font-medium border border-slate-200">
                                {m.dosage}
                              </span>
                            )}
                            {m.frequency && <span>{m.frequency}</span>}
                            {m.duration && <span className="opacity-75">({m.duration})</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
