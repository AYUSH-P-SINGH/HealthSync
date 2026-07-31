import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ShieldCheck,
  LogOut,
  ShieldAlert,
  Plus,
  Loader2,
  CircleAlert,
  BadgeCheck,
  Trash2,
  MapPin,
  X,
  Power,
} from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { advisoryApi } from "../lib/api.js";
import { severityMeta } from "../lib/records.js";
import { formatDate } from "../lib/format.js";

const inputCls =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100";

const SEVERITIES = ["info", "advisory", "warning", "critical"];

const emptyForm = () => ({
  title: "",
  summary: "",
  severity: "advisory",
  region: "Nationwide",
  precautionsText: "",
  expiresAt: "",
});

/**
 * Admin dashboard — health advisory management.
 * Advisories published here appear instantly on every patient's dashboard
 * banner and Health tab, with the listed precautions.
 */
export default function AdminDashboard() {
  const navigate = useNavigate();
  const { user, accessToken, logout } = useAuth();

  const [advisories, setAdvisories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const handleLogout = () => {
    logout();
    navigate("/");
  };

  const load = useCallback(async () => {
    try {
      const res = await advisoryApi.list(accessToken);
      setAdvisories(res.data.advisories);
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    if (accessToken) load();
  }, [accessToken, load]);

  const setField = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handlePublish = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = {
        title: form.title.trim(),
        summary: form.summary.trim(),
        severity: form.severity,
        region: form.region.trim() || "Nationwide",
        precautions: form.precautionsText
          .split("\n")
          .map((p) => p.trim())
          .filter(Boolean)
          .slice(0, 15),
        expiresAt: form.expiresAt || undefined,
      };
      const res = await advisoryApi.create(payload, accessToken);
      setNotice(res.message || "Advisory published.");
      setForm(emptyForm());
      setFormOpen(false);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (advisory) => {
    setBusyId(advisory._id);
    setError("");
    try {
      await advisoryApi.update(advisory._id, { isActive: !advisory.isActive }, accessToken);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (advisory) => {
    setBusyId(advisory._id);
    setError("");
    try {
      await advisoryApi.remove(advisory._id, accessToken);
      setNotice("Advisory deleted.");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-brand-900">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 text-white">
              <ShieldCheck size={20} />
            </span>
            <span className="font-display text-xl font-bold text-white">HealthSync Admin</span>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white/80 transition hover:bg-white/10 hover:text-white"
          >
            <LogOut size={16} />
            Log out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold text-brand-900">
              Welcome{user?.fullName?.firstName ? `, ${user.fullName.firstName}` : ""}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Publish disease advisories and precautions — they appear on every patient&apos;s
              dashboard immediately.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setFormOpen((o) => !o)}
            className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
          >
            {formOpen ? <X size={15} /> : <Plus size={15} />}
            {formOpen ? "Close" : "New Advisory"}
          </button>
        </div>

        {notice && (
          <div className="mt-4 flex items-center justify-between gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
            <span className="flex items-center gap-2">
              <BadgeCheck size={16} /> {notice}
            </span>
            <button type="button" onClick={() => setNotice("")} aria-label="Dismiss">
              <X size={15} />
            </button>
          </div>
        )}
        {error && (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
            <CircleAlert size={16} /> {error}
          </div>
        )}

        {/* Publish form */}
        {formOpen && (
          <form
            onSubmit={handlePublish}
            className="mt-6 rounded-xl border border-slate-100 bg-white p-6 shadow-sm"
          >
            <h2 className="flex items-center gap-2 font-display text-lg font-bold text-brand-900">
              <ShieldAlert size={18} /> Publish a health advisory
            </h2>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="block sm:col-span-2">
                <span className="mb-1.5 block text-xs font-semibold text-slate-500">Title *</span>
                <input
                  className={inputCls}
                  value={form.title}
                  onChange={setField("title")}
                  placeholder="e.g. Dengue outbreak — Delhi NCR"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-slate-500">Severity</span>
                <select className={inputCls} value={form.severity} onChange={setField("severity")}>
                  {SEVERITIES.map((s) => (
                    <option key={s} value={s}>
                      {severityMeta(s).label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-slate-500">Region</span>
                <input
                  className={inputCls}
                  value={form.region}
                  onChange={setField("region")}
                  placeholder="e.g. Delhi NCR"
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="mb-1.5 block text-xs font-semibold text-slate-500">Summary</span>
                <textarea
                  rows={3}
                  className={inputCls}
                  value={form.summary}
                  onChange={setField("summary")}
                  placeholder="What's happening, who is at risk, what to watch for…"
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="mb-1.5 block text-xs font-semibold text-slate-500">
                  Precautions (one per line)
                </span>
                <textarea
                  rows={4}
                  className={inputCls}
                  value={form.precautionsText}
                  onChange={setField("precautionsText")}
                  placeholder={"Use mosquito repellent and nets\nRemove standing water around the house\nSeek care immediately for high fever with rash"}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-slate-500">
                  Auto-expire on (optional)
                </span>
                <input
                  type="date"
                  className={inputCls}
                  value={form.expiresAt}
                  onChange={setField("expiresAt")}
                  min={new Date().toISOString().slice(0, 10)}
                />
              </label>
            </div>
            <button
              type="submit"
              disabled={saving || form.title.trim().length < 5}
              className="mt-5 flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
            >
              {saving && <Loader2 size={15} className="animate-spin" />}
              Publish Advisory
            </button>
          </form>
        )}

        {/* Advisory list */}
        <h2 className="mt-8 font-display text-lg font-bold text-brand-900">All advisories</h2>
        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-slate-400">
            <Loader2 size={16} className="animate-spin" /> Loading…
          </div>
        ) : advisories.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
            No advisories yet. Publish one to alert patients — until then, they see rotating daily
            health tips.
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            {advisories.map((a) => {
              const sev = severityMeta(a.severity);
              return (
                <div key={a._id} className="rounded-xl border border-slate-100 bg-white p-5 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase ${sev.chip}`}>
                        {sev.label}
                      </span>
                      <span className="font-display font-bold text-slate-800">{a.title}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                          a.isActive ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {a.isActive ? "Live" : "Inactive"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={busyId === a._id}
                        onClick={() => toggleActive(a)}
                        className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
                      >
                        <Power size={12} /> {a.isActive ? "Deactivate" : "Activate"}
                      </button>
                      <button
                        type="button"
                        disabled={busyId === a._id}
                        onClick={() => handleDelete(a)}
                        className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-60"
                      >
                        {busyId === a._id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                        Delete
                      </button>
                    </div>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 text-xs text-slate-400">
                    <span className="flex items-center gap-1">
                      <MapPin size={11} /> {a.region}
                    </span>
                    <span>Published {formatDate(a.createdAt)}</span>
                    {a.expiresAt && <span>Expires {formatDate(a.expiresAt)}</span>}
                    {(a.precautions?.length || 0) > 0 && (
                      <span>{a.precautions.length} precaution{a.precautions.length > 1 ? "s" : ""}</span>
                    )}
                  </div>
                  {a.summary && <p className="mt-2 text-sm text-slate-600">{a.summary}</p>}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
