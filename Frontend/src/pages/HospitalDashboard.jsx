import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  LayoutGrid,
  Users,
  MessageSquare,
  CalendarDays,
  FileText,
  ChartLine,
  Settings,
  LogOut,
  Search,
  Phone,
  Mail,
  MapPin,
  HeartPulse,
  Building2,
  BedDouble,
  Globe,
  Stethoscope,
  ClipboardList,
  Loader2,
  CircleAlert,
  BadgeCheck,
  Pencil,
  Siren,
  UserPlus,
  UserMinus,
  Droplets,
  X,
  QrCode,
} from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { hospitalApi } from "../lib/api.js";
import { initialsOf, formatDate, titleCase } from "../lib/format.js";
import TopbarActions from "../components/TopbarActions.jsx";
import ConsentAccessView from "../components/ConsentAccessView.jsx";
import PatientRecordsPanel from "../components/PatientRecordsPanel.jsx";

/*
  Hospital staff dashboard, wired to the real backend:
    GET   /api/hospitals/dashboard -> { hospital, dashboard } (profile + counts)
    PATCH /api/hospitals/profile   -> update editable profile fields

  No mock data: every field starts empty ("—") and fills in only with data the
  hospital has actually provided. The patient list shows an honest empty state
  until the Hospital<->Patient relationship models land in the backend.
  Clicking the hospital name in the top bar opens a slide-over profile panel
  with the hospital's records and an inline edit form (it no longer logs out).
*/

const SIDEBAR_ITEMS = [
  { key: "dashboard", label: "Dashboard", icon: LayoutGrid },
  { key: "patients", label: "Patients", icon: Users },
  { key: "consents", label: "Consent Access", icon: QrCode },
  { key: "messages", label: "Messages", icon: MessageSquare },
  { key: "calendar", label: "Calendar", icon: CalendarDays },
  { key: "records", label: "Records", icon: FileText },
  { key: "analytics", label: "Analytics", icon: ChartLine },
];

const TAB_KEYS = [...SIDEBAR_ITEMS.map((i) => i.key), "settings"];

function formFromHospital(hospital) {
  return {
    name: hospital?.name || "",
    mobileNumber: hospital?.mobileNumber || "",
    website: hospital?.website || "",
    totalBeds: hospital?.totalBeds != null ? String(hospital.totalBeds) : "",
    emergencyAvailable: !!hospital?.emergencyAvailable,
    specialities: (hospital?.specialities || []).join(", "),
    street: hospital?.address?.street || "",
    city: hospital?.address?.city || "",
    state: hospital?.address?.state || "",
    pincode: hospital?.address?.pincode || "",
    country: hospital?.address?.country || "",
  };
}

/** Build a PATCH payload containing only filled-in / meaningful fields. */
function payloadFromHospitalForm(form) {
  const put = (obj, key, value) => {
    const v = value.trim();
    if (v) obj[key] = v;
  };

  const payload = {};
  put(payload, "name", form.name);
  put(payload, "mobileNumber", form.mobileNumber);
  put(payload, "website", form.website);
  if (form.totalBeds.trim() !== "") payload.totalBeds = Number(form.totalBeds);
  payload.emergencyAvailable = form.emergencyAvailable;
  payload.specialities = form.specialities
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const address = {};
  put(address, "street", form.street);
  put(address, "city", form.city);
  put(address, "state", form.state);
  put(address, "pincode", form.pincode);
  put(address, "country", form.country);
  if (Object.keys(address).length) payload.address = address;

  return payload;
}

function addressTextOf(hospital) {
  return (
    [
      hospital?.address?.street,
      hospital?.address?.city,
      hospital?.address?.state,
      hospital?.address?.pincode,
      hospital?.address?.country,
    ]
      .filter(Boolean)
      .join(", ") || "—"
  );
}

export default function HospitalDashboard() {
  const navigate = useNavigate();
  const { accessToken, user: authUser, logout } = useAuth();

  // The active tab lives in the URL (?tab=...) so every tab switch pushes a
  // history entry — the browser Back button steps back through tabs instead
  // of leaving the dashboard.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const activeSidebarItem = TAB_KEYS.includes(tabParam) ? tabParam : "dashboard";

  const [search, setSearch] = useState("");
  const [hospital, setHospital] = useState(authUser || null);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [editing, setEditing] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState("");

  const handleLogout = () => {
    logout();
    navigate("/");
  };

  const refresh = useCallback(async () => {
    const res = await hospitalApi.getDashboard(accessToken);
    setHospital(res.data.hospital);
    setSummary(res.data.dashboard);
  }, [accessToken]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setLoadError("");
      try {
        const res = await hospitalApi.getDashboard(accessToken);
        if (cancelled) return;
        setHospital(res.data.hospital);
        setSummary(res.data.dashboard);
      } catch (err) {
        if (!cancelled) setLoadError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    if (accessToken) load();
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  const displayName = hospital?.name || "Hospital";

  const handleProfileSaved = (updatedHospital, message) => {
    setHospital(updatedHospital);
    setEditing(false);
    setSaveSuccess(message || "Profile updated.");
    refresh().catch(() => {});
  };

  const goTo = (item) => {
    setEditing(false);
    if (item !== activeSidebarItem) setSearchParams({ tab: item });
  };

  /* Notifications, built from real patient-link activity. */
  const [notifications, setNotifications] = useState([]);
  const [notifLoading, setNotifLoading] = useState(true);

  const loadNotifications = useCallback(async () => {
    try {
      const res = await hospitalApi.listPatients(accessToken);
      const items = [];
      for (const link of res.data.links || []) {
        const name = link.patient?.name || "A patient";
        if (link.status === "pending") {
          items.push({
            id: `${link._id}:pending`,
            unread: true,
            title: "Link request pending",
            body: `Waiting for ${name} to approve your request.`,
            time: link.requestedAt,
            tab: "patients",
          });
        } else if (link.status === "active" && link.respondedAt) {
          items.push({
            id: `${link._id}:approved`,
            title: `${name} approved your request`,
            body: "Their full profile and contact details are now available.",
            time: link.respondedAt,
            tab: "patients",
          });
        } else if (link.status === "rejected") {
          items.push({
            id: `${link._id}:rejected`,
            title: `${name} declined your request`,
            body: "You can send a new request from the patient list.",
            time: link.respondedAt,
            tab: "patients",
          });
        }
      }
      items.sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));
      setNotifications(items.slice(0, 12));
    } catch {
      /* notifications are non-critical — fail quietly */
    } finally {
      setNotifLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    if (accessToken) loadNotifications();
  }, [accessToken, loadNotifications]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white">
      {/* Top bar */}
      <header className="flex h-16 shrink-0 items-center gap-4 border-b border-slate-800 bg-brand-900 px-5">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
            <HeartPulse size={18} />
          </span>
          <span className="font-display text-lg font-bold text-white">HealthSync</span>
        </div>

        <div className="mx-4 flex max-w-xl flex-1 items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-white/60">
          <Search size={16} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search Patient, Tag, Appointment"
            className="w-full bg-transparent text-sm text-white placeholder:text-white/50 focus:outline-none"
          />
        </div>

        <div className="ml-auto flex items-center gap-4 text-white/80">
          <TopbarActions
            notifications={notifications}
            loading={notifLoading}
            onRefresh={loadNotifications}
            onNotificationClick={(n) => goTo(n.tab)}
          />
          <div className="mx-1 h-6 w-px bg-white/15" />
          {/* Opens the profile panel — logging out lives in the sidebar. */}
          <button
            type="button"
            className="flex items-center gap-2 rounded-full py-1 pl-1 pr-3 transition hover:bg-white/10"
            onClick={() => setPanelOpen(true)}
            title="View hospital profile"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-900">
              {initialsOf(displayName)}
            </span>
            <span className="text-sm font-semibold text-white">{displayName}</span>
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Sidebar */}
        <nav className="flex w-[76px] shrink-0 flex-col items-center gap-2 border-r border-slate-100 bg-white py-5">
          {SIDEBAR_ITEMS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => goTo(key)}
              title={label}
              className={`flex h-11 w-11 items-center justify-center rounded-xl transition ${
                activeSidebarItem === key
                  ? "bg-brand-50 text-brand-600"
                  : "text-slate-400 hover:bg-slate-50 hover:text-slate-600"
              }`}
            >
              <Icon size={20} />
            </button>
          ))}
          <div className="mt-auto flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={() => goTo("settings")}
              title="Settings"
              className={`flex h-11 w-11 items-center justify-center rounded-xl transition ${
                activeSidebarItem === "settings"
                  ? "bg-brand-50 text-brand-600"
                  : "text-slate-400 hover:bg-slate-50 hover:text-slate-600"
              }`}
            >
              <Settings size={20} />
            </button>
            <button
              type="button"
              onClick={handleLogout}
              title="Log out"
              className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-50 hover:text-rose-600"
            >
              <LogOut size={20} />
            </button>
          </div>
        </nav>

        {/* Content */}
        <div className="min-w-0 flex-1 overflow-y-auto bg-slate-50/60">
          {loading ? (
            <div className="flex h-full items-center justify-center gap-2 text-slate-400">
              <Loader2 size={20} className="animate-spin" /> Loading your dashboard…
            </div>
          ) : loadError ? (
            <div className="mx-auto mt-16 flex max-w-md flex-col items-center gap-3 rounded-xl border border-rose-100 bg-rose-50 p-6 text-center">
              <CircleAlert size={22} className="text-rose-500" />
              <p className="text-sm text-rose-700">{loadError}</p>
              <button
                type="button"
                onClick={() => navigate(0)}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
              >
                Try again
              </button>
            </div>
          ) : activeSidebarItem === "dashboard" ? (
            <DashboardView
              hospital={hospital}
              summary={summary}
              accessToken={accessToken}
              editing={editing}
              setEditing={setEditing}
              saveSuccess={saveSuccess}
              setSaveSuccess={setSaveSuccess}
              onProfileSaved={handleProfileSaved}
              onStatClick={{
                completeness: () => setPanelOpen(true),
                patients: () => goTo("patients"),
                appointments: () => goTo("calendar"),
                records: () => goTo("records"),
              }}
            />
          ) : activeSidebarItem === "patients" ? (
            <PatientsView
              accessToken={accessToken}
              search={search}
              setSearch={setSearch}
              onChanged={() => refresh().catch(() => {})}
            />
          ) : activeSidebarItem === "consents" ? (
            <SimpleView title="Consent Access">
              <ConsentAccessView accessToken={accessToken} />
            </SimpleView>
          ) : activeSidebarItem === "messages" ? (
            <SimpleView title="Messages">
              <EmptyState
                icon={MessageSquare}
                title="No messages"
                message="Secure messaging with patients and staff is coming soon. Conversations will appear here."
              />
            </SimpleView>
          ) : activeSidebarItem === "calendar" ? (
            <SimpleView title="Calendar">
              <EmptyState
                icon={CalendarDays}
                title="No appointments scheduled"
                message="Appointments booked by patients will show up on your calendar once online booking opens."
              />
            </SimpleView>
          ) : activeSidebarItem === "records" ? (
            <SimpleView title="Medical Records">
              <EmptyState
                icon={FileText}
                title="No records yet"
                message="Medical records you create for your patients will be listed here."
              />
            </SimpleView>
          ) : activeSidebarItem === "analytics" ? (
            <SimpleView title="Analytics">
              <EmptyState
                icon={ChartLine}
                title="Not enough data yet"
                message="Once patients, appointments, and records start flowing in, insights and trends will appear here."
              />
            </SimpleView>
          ) : (
            <SettingsView
              hospital={hospital}
              onEditProfile={() => setPanelOpen(true)}
              onLogout={handleLogout}
            />
          )}
        </div>
      </div>

      {/* Slide-over profile panel */}
      <ProfilePanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        hospital={hospital}
        summary={summary}
        accessToken={accessToken}
        onProfileSaved={handleProfileSaved}
      />
    </div>
  );
}

/* ─── Dashboard (home) view ─────────────────────────────────────────── */

function DashboardView({
  hospital,
  summary,
  accessToken,
  editing,
  setEditing,
  saveSuccess,
  setSaveSuccess,
  onProfileSaved,
  onStatClick,
}) {
  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      {/* Heading */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-brand-900">
            {hospital?.name || "Your Hospital"}
          </h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-slate-500">
            Registration No.
            <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-bold text-brand-600">
              {hospital?.registrationNumber || "—"}
            </span>
            {hospital?.isVerified ? (
              <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600">
                <BadgeCheck size={14} /> Verified
              </span>
            ) : (
              <span className="text-xs font-semibold text-amber-600">Verification pending</span>
            )}
          </p>
        </div>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
          >
            <Pencil size={15} /> Edit Profile
          </button>
        )}
      </div>

      {saveSuccess && !editing && (
        <div className="mt-4 flex items-center justify-between gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
          <span className="flex items-center gap-2">
            <BadgeCheck size={16} /> {saveSuccess}
          </span>
          <button type="button" onClick={() => setSaveSuccess("")} aria-label="Dismiss">
            <X size={15} />
          </button>
        </div>
      )}

      {/* Stat cards — each one navigates to its section */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={ClipboardList}
          label="Profile Completeness"
          value={`${summary?.profileCompleteness ?? 0}%`}
          onClick={onStatClick.completeness}
          footer={
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-brand-600 transition-all"
                style={{ width: `${summary?.profileCompleteness ?? 0}%` }}
              />
            </div>
          }
        />
        <StatCard
          icon={Users}
          label="Total Patients"
          value={summary?.totalPatients ?? 0}
          onClick={onStatClick.patients}
          footer={
            <p className="mt-2 text-xs text-slate-400">
              {summary?.pendingRequests
                ? `${summary.pendingRequests} request${summary.pendingRequests > 1 ? "s" : ""} pending approval`
                : "View patient list"}
            </p>
          }
        />
        <StatCard
          icon={CalendarDays}
          label="Upcoming Appointments"
          value={summary?.upcomingAppointments ?? 0}
          onClick={onStatClick.appointments}
          footer={<p className="mt-2 text-xs text-slate-400">View calendar</p>}
        />
        <StatCard
          icon={FileText}
          label="Medical Records"
          value={summary?.totalRecords ?? 0}
          onClick={onStatClick.records}
          footer={<p className="mt-2 text-xs text-slate-400">View records</p>}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        {/* Hospital information / edit form */}
        <section className="rounded-xl border border-slate-100 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-bold text-brand-900">Hospital Information</h2>
            {editing && (
              <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                Editing
              </span>
            )}
          </div>

          {!editing ? (
            <>
              <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                <InfoRow label="Hospital Name" value={hospital?.name || "—"} icon={Building2} />
                <InfoRow label="Hospital Type" value={titleCase(hospital?.hospitalType)} />
                <InfoRow label="Contact Number" value={hospital?.mobileNumber || "—"} icon={Phone} />
                <InfoRow label="Email" value={hospital?.email || "—"} icon={Mail} />
                <InfoRow
                  label="Total Beds"
                  value={hospital?.totalBeds > 0 ? hospital.totalBeds : "—"}
                  icon={BedDouble}
                />
                <InfoRow
                  label="Emergency Services"
                  value={hospital?.emergencyAvailable ? "Available 24×7" : "Not available"}
                  icon={Siren}
                />
                <InfoRow label="Website" value={hospital?.website || "—"} icon={Globe} />
                <InfoRow label="Address" value={addressTextOf(hospital)} icon={MapPin} />
              </dl>

              <div className="mt-5">
                <div className="flex items-center gap-1.5 text-xs text-slate-400">
                  <Stethoscope size={13} /> Specialities
                </div>
                {hospital?.specialities?.length ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {hospital.specialities.map((s) => (
                      <span
                        key={s}
                        className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-600"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-slate-400">
                    No specialities added yet.{" "}
                    <button
                      type="button"
                      onClick={() => setEditing(true)}
                      className="font-semibold text-brand-600 hover:underline"
                    >
                      Add them
                    </button>
                  </p>
                )}
              </div>

              {(summary?.profileCompleteness ?? 100) < 100 && (
                <p className="mt-5 rounded-lg bg-brand-50 px-4 py-3 text-sm text-brand-700">
                  Your profile is {summary?.profileCompleteness}% complete. A complete profile helps
                  patients find and trust your hospital.
                </p>
              )}
            </>
          ) : (
            <div className="mt-5">
              <HospitalEditForm
                hospital={hospital}
                accessToken={accessToken}
                onSaved={onProfileSaved}
                onCancel={() => setEditing(false)}
              />
            </div>
          )}
        </section>

        {/* Right column — identity card */}
        <aside className="flex flex-col gap-6">
          <section className="rounded-xl border border-slate-100 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-4">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-100 text-lg font-bold text-brand-900">
                {initialsOf(hospital?.name || "H")}
              </span>
              <div className="min-w-0">
                <div className="truncate font-display font-bold text-slate-800">
                  {hospital?.name || "—"}
                </div>
                <div className="text-sm text-slate-400">{titleCase(hospital?.hospitalType)}</div>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-1.5 text-sm text-slate-500">
              <span className="flex items-center gap-2">
                <Phone size={14} /> {hospital?.mobileNumber || "—"}
              </span>
              <span className="flex items-center gap-2 break-all">
                <Mail size={14} /> {hospital?.email || "—"}
              </span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 text-sm">
              <div>
                <div className="text-xs text-slate-400">Beds</div>
                <div className="mt-0.5 font-semibold text-slate-800">
                  {hospital?.totalBeds > 0 ? hospital.totalBeds : "—"}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-400">Member Since</div>
                <div className="mt-0.5 font-semibold text-slate-800">
                  {formatDate(hospital?.createdAt)}
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-slate-100 bg-white p-6 shadow-sm">
            <h3 className="text-sm font-bold text-slate-800">Emergency Services</h3>
            <div className="mt-3 flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
              <span
                className={`flex h-9 w-9 items-center justify-center rounded-full bg-white ${
                  hospital?.emergencyAvailable ? "text-emerald-600" : "text-slate-400"
                }`}
              >
                <Siren size={16} />
              </span>
              <div className="text-sm font-semibold text-slate-800">
                {hospital?.emergencyAvailable ? "Available 24×7" : "Not available"}
                <div className="text-xs font-normal text-slate-400">
                  Shown to patients searching for emergency care.
                </div>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

/* ─── Slide-over profile panel ──────────────────────────────────────── */

function ProfilePanel({ open, onClose, hospital, summary, accessToken, onProfileSaved }) {
  const [panelEditing, setPanelEditing] = useState(false);

  // Reset to view mode whenever the panel is (re)opened.
  useEffect(() => {
    if (open) setPanelEditing(false);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close profile panel"
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/40"
      />

      {/* Panel */}
      <aside className="relative flex h-full w-full max-w-md flex-col overflow-y-auto bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold text-brand-900">
            <Building2 size={18} /> Hospital Profile
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-50"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 px-6 py-5">
          {/* Identity */}
          <div className="flex items-center gap-4">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-100 text-lg font-bold text-brand-900">
              {initialsOf(hospital?.name || "H")}
            </span>
            <div className="min-w-0">
              <div className="truncate font-display font-bold text-slate-800">
                {hospital?.name || "—"}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                <span className="rounded-full bg-brand-50 px-2 py-0.5 font-bold text-brand-600">
                  {hospital?.registrationNumber || "—"}
                </span>
                {hospital?.isVerified && (
                  <span className="flex items-center gap-1 font-semibold text-emerald-600">
                    <BadgeCheck size={13} /> Verified
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Completeness */}
          <div className="mt-5 rounded-xl border border-slate-100 bg-slate-50 p-4">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
              <span>Profile Completeness</span>
              <span className="text-brand-600">{summary?.profileCompleteness ?? 0}%</span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-brand-600 transition-all"
                style={{ width: `${summary?.profileCompleteness ?? 0}%` }}
              />
            </div>
          </div>

          {!panelEditing ? (
            <>
              <dl className="mt-6 grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
                <InfoRow label="Hospital Type" value={titleCase(hospital?.hospitalType)} />
                <InfoRow
                  label="Total Beds"
                  value={hospital?.totalBeds > 0 ? hospital.totalBeds : "—"}
                  icon={BedDouble}
                />
                <InfoRow label="Contact Number" value={hospital?.mobileNumber || "—"} icon={Phone} />
                <InfoRow label="Email" value={hospital?.email || "—"} icon={Mail} />
                <InfoRow
                  label="Emergency Services"
                  value={hospital?.emergencyAvailable ? "Available 24×7" : "Not available"}
                  icon={Siren}
                />
                <InfoRow label="Website" value={hospital?.website || "—"} icon={Globe} />
              </dl>
              <div className="mt-4">
                <InfoRow label="Address" value={addressTextOf(hospital)} icon={MapPin} />
              </div>
              <div className="mt-4">
                <InfoRow
                  label="Specialities"
                  icon={Stethoscope}
                  value={hospital?.specialities?.length ? hospital.specialities.join(", ") : "—"}
                />
              </div>
              <div className="mt-4">
                <InfoRow label="Member Since" value={formatDate(hospital?.createdAt)} />
              </div>

              <button
                type="button"
                onClick={() => setPanelEditing(true)}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
              >
                <Pencil size={15} /> Edit Profile
              </button>
              <p className="mt-3 text-center text-xs text-slate-400">
                Email, registration number, and hospital type can&apos;t be changed. Contact support
                if they&apos;re wrong.
              </p>
            </>
          ) : (
            <div className="mt-6">
              <HospitalEditForm
                hospital={hospital}
                accessToken={accessToken}
                compact
                onSaved={(h, message) => {
                  setPanelEditing(false);
                  onProfileSaved(h, message);
                }}
                onCancel={() => setPanelEditing(false)}
              />
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

/* ─── Reusable hospital edit form (dashboard section + panel) ───────── */

function HospitalEditForm({ hospital, accessToken, onSaved, onCancel, compact = false }) {
  const [form, setForm] = useState(() => formFromHospital(hospital));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const setField = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSaveError("");
    try {
      const res = await hospitalApi.updateProfile(payloadFromHospitalForm(form), accessToken);
      onSaved(res.data, res.message || "Profile updated.");
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const cols = compact ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2";

  return (
    <form onSubmit={handleSave}>
      {saveError && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
          <CircleAlert size={15} /> {saveError}
        </div>
      )}
      <div className={`grid gap-4 ${cols}`}>
        <Field label="Hospital Name" className={compact ? "" : "sm:col-span-2"}>
          <input className={inputCls} value={form.name} onChange={setField("name")} placeholder="Hospital name" />
        </Field>
        <Field label="Contact Number">
          <input className={inputCls} value={form.mobileNumber} onChange={setField("mobileNumber")} placeholder="10-digit mobile number" inputMode="numeric" />
        </Field>
        <Field label="Website">
          <input className={inputCls} value={form.website} onChange={setField("website")} placeholder="https://example.com" />
        </Field>
        <Field label="Total Beds">
          <input type="number" min="0" className={inputCls} value={form.totalBeds} onChange={setField("totalBeds")} placeholder="e.g. 120" />
        </Field>
        <Field label="Emergency Services">
          <label className="flex h-[42px] cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.emergencyAvailable}
              onChange={(e) => setForm((f) => ({ ...f, emergencyAvailable: e.target.checked }))}
              className="h-4 w-4 rounded border-slate-300 accent-brand-600"
            />
            Available 24×7
          </label>
        </Field>
        <Field label="Specialities (comma-separated)" className={compact ? "" : "sm:col-span-2"}>
          <input
            className={inputCls}
            value={form.specialities}
            onChange={setField("specialities")}
            placeholder="e.g. Cardiology, Orthopedics, Neurology"
          />
        </Field>
      </div>

      <h3 className="mt-6 text-sm font-bold text-slate-800">Address</h3>
      <div className={`mt-3 grid gap-4 ${cols}`}>
        <Field label="Street" className={compact ? "" : "sm:col-span-2"}>
          <input className={inputCls} value={form.street} onChange={setField("street")} placeholder="Street address" />
        </Field>
        <Field label="City">
          <input className={inputCls} value={form.city} onChange={setField("city")} placeholder="City" />
        </Field>
        <Field label="State">
          <input className={inputCls} value={form.state} onChange={setField("state")} placeholder="State" />
        </Field>
        <Field label="Pincode">
          <input className={inputCls} value={form.pincode} onChange={setField("pincode")} placeholder="6-digit pincode" inputMode="numeric" />
        </Field>
        <Field label="Country">
          <input className={inputCls} value={form.country} onChange={setField("country")} placeholder="Country" />
        </Field>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
        >
          {saving && <Loader2 size={15} className="animate-spin" />}
          Save Changes
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-lg border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/* ─── Patients view (real, consent-based links) ─────────────────────── */

const STATUS_BADGES = {
  pending: "bg-amber-100 text-amber-700",
  active: "bg-emerald-100 text-emerald-700",
  rejected: "bg-rose-100 text-rose-700",
  discharged: "bg-slate-100 text-slate-500",
};

const STATUS_LABELS = {
  pending: "Awaiting approval",
  active: "Active",
  rejected: "Rejected",
  discharged: "Discharged",
};

function PatientsView({ accessToken, search, setSearch, onChanged }) {
  const [links, setLinks] = useState([]);
  const [counts, setCounts] = useState({ pending: 0, active: 0, rejected: 0, discharged: 0 });
  const [tab, setTab] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [recordsLink, setRecordsLink] = useState(null); // link whose records panel is open

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await hospitalApi.listPatients(accessToken);
      setLinks(res.data.links);
      setCounts(res.data.counts);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    load();
  }, [load]);

  const total = counts.pending + counts.active + counts.rejected + counts.discharged;
  const tabs = [
    { key: "all", label: "All", count: total },
    { key: "active", label: "Active", count: counts.active },
    { key: "pending", label: "Pending", count: counts.pending },
    { key: "discharged", label: "Discharged", count: counts.discharged },
    { key: "rejected", label: "Rejected", count: counts.rejected },
  ];

  const q = search.trim().toLowerCase();
  const visible = links.filter((l) => {
    if (tab !== "all" && l.status !== tab) return false;
    if (!q) return true;
    return (
      l.patient?.name?.toLowerCase().includes(q) ||
      l.patient?.patientId?.toLowerCase().includes(q)
    );
  });

  const endLink = async (link) => {
    setBusyId(link._id);
    setError("");
    try {
      const res = await hospitalApi.dischargePatient(link._id, accessToken);
      setNotice(res.message || "Patient link ended.");
      await load();
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold text-brand-900">Patient List</h1>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
        >
          <UserPlus size={15} /> Add Patient
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

      <div className="mt-5 flex items-center gap-2 overflow-x-auto border-b border-slate-100">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`flex shrink-0 items-center gap-2 border-b-2 px-3 pb-3 text-sm font-semibold transition ${
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

      <div className="mt-4 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-400">
        <Search size={16} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or Patient ID"
          className="w-full text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none"
        />
      </div>

      <div className="mt-4">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-slate-400">
            <Loader2 size={18} className="animate-spin" /> Loading patients…
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={Users}
            title={total === 0 ? "No patients yet" : "Nothing matches"}
            message={
              total === 0
                ? "Add a patient with their Patient ID or email — they approve the request from their own HealthSync account, then appear here."
                : "No patient links match the current tab or search."
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-100 bg-white shadow-sm">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-slate-500">
                  <th className="py-3 pl-4 pr-4 font-semibold">Patient</th>
                  <th className="py-3 pr-4 font-semibold">Contact</th>
                  <th className="py-3 pr-4 font-semibold">Blood Group</th>
                  <th className="py-3 pr-4 font-semibold">Status</th>
                  <th className="py-3 pr-4 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((link) => {
                  const p = link.patient || {};
                  const isActive = link.status === "active";
                  return (
                    <tr key={link._id} className="border-b border-slate-50">
                      <td className="py-3 pl-4 pr-4">
                        <div className="flex items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-900">
                            {initialsOf(p.name || "?")}
                          </span>
                          <div>
                            <div className="font-semibold text-slate-800">{p.name || "—"}</div>
                            <div className="text-xs text-slate-400">
                              {p.patientId}
                              {p.age != null ? ` · ${p.age} Y` : ""}
                              {p.gender ? `, ${titleCase(p.gender)}` : ""}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-slate-600">
                        {isActive ? (
                          <>
                            <div>{p.mobileNumber || "—"}</div>
                            <div className="text-xs text-slate-400">{p.email}</div>
                          </>
                        ) : (
                          <span title="Full contact is shared after the patient approves">
                            {p.maskedMobile || "—"}
                          </span>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-slate-600">
                        {isActive && p.bloodGroup ? (
                          <span className="flex items-center gap-1.5">
                            <Droplets size={14} className="text-brand-600" /> {p.bloodGroup}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-3 pr-4">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_BADGES[link.status]}`}
                        >
                          {STATUS_LABELS[link.status]}
                        </span>
                        <div className="mt-1 text-xs text-slate-400">
                          {link.status === "active" && link.respondedAt
                            ? `Since ${formatDate(link.respondedAt)}`
                            : link.status === "pending"
                              ? `Requested ${formatDate(link.requestedAt)}`
                              : link.endedAt
                                ? formatDate(link.endedAt)
                                : formatDate(link.respondedAt)}
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2">
                          {isActive && (
                            <button
                              type="button"
                              onClick={() => setRecordsLink(link)}
                              className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700"
                            >
                              <FileText size={13} /> Records
                            </button>
                          )}
                          {(link.status === "active" || link.status === "pending") && (
                            <button
                              type="button"
                              disabled={busyId === link._id}
                              onClick={() => endLink(link)}
                              className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-60"
                            >
                              {busyId === link._id ? (
                                <Loader2 size={13} className="animate-spin" />
                              ) : (
                                <UserMinus size={13} />
                              )}
                              {link.status === "active" ? "Discharge" : "Withdraw"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AddPatientModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        accessToken={accessToken}
        onAdded={(message) => {
          setModalOpen(false);
          setNotice(message);
          load();
          onChanged();
        }}
      />

      {/* Per-patient records slide-over (view + add, with safety alerts) */}
      {recordsLink && (
        <PatientRecordsPanel
          link={recordsLink}
          accessToken={accessToken}
          onClose={() => setRecordsLink(null)}
        />
      )}
    </div>
  );
}

function AddPatientModal({ open, onClose, accessToken, onAdded }) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState(null); // { patient, linkStatus }
  const [error, setError] = useState("");
  const [looking, setLooking] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (open) {
      setQuery("");
      setResult(null);
      setError("");
    }
  }, [open]);

  if (!open) return null;

  const lookup = async (e) => {
    e.preventDefault();
    setLooking(true);
    setError("");
    setResult(null);
    try {
      const res = await hospitalApi.lookupPatient(query, accessToken);
      setResult(res.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLooking(false);
    }
  };

  const sendRequest = async () => {
    setSending(true);
    setError("");
    try {
      const res = await hospitalApi.addPatient(query, accessToken);
      onAdded(res.message || "Request sent.");
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  const p = result?.patient;
  const alreadyLinked = result?.linkStatus === "active" || result?.linkStatus === "pending";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/40"
      />
      <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold text-brand-900">
            <UserPlus size={18} /> Add Patient
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-50"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>
        <p className="mt-2 text-sm text-slate-500">
          Ask the patient for their Patient ID (HS-XXXXXXXX) or registered email. They&apos;ll
          approve your request from their own HealthSync account.
        </p>

        <form onSubmit={lookup} className="mt-4 flex gap-2">
          <input
            className={inputCls}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="HS-XXXXXXXX or email"
            autoFocus
          />
          <button
            type="submit"
            disabled={looking || !query.trim()}
            className="flex shrink-0 items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
          >
            {looking ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            Look up
          </button>
        </form>

        {error && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2.5 text-sm text-rose-700">
            <CircleAlert size={15} /> {error}
          </div>
        )}

        {p && (
          <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-4">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-900">
                {initialsOf(p.name || "?")}
              </span>
              <div>
                <div className="font-semibold text-slate-800">
                  {p.name || "—"}{" "}
                  {p.isVerified && <BadgeCheck size={14} className="inline text-emerald-500" />}
                </div>
                <div className="text-xs text-slate-400">
                  {p.patientId}
                  {p.age != null ? ` · ${p.age} Y` : ""}
                  {p.gender ? `, ${titleCase(p.gender)}` : ""}
                  {p.maskedMobile ? ` · ${p.maskedMobile}` : ""}
                </div>
              </div>
            </div>

            {result.linkStatus && (
              <p className="mt-3 text-xs font-medium text-slate-500">
                {result.linkStatus === "active" && "This patient is already linked to your hospital."}
                {result.linkStatus === "pending" && "A request for this patient is already pending."}
                {result.linkStatus === "rejected" &&
                  "A previous request was rejected — you can send a new one."}
                {result.linkStatus === "discharged" &&
                  "This patient was previously linked — you can send a new request."}
              </p>
            )}

            <button
              type="button"
              onClick={sendRequest}
              disabled={sending || alreadyLinked}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
            >
              {sending && <Loader2 size={14} className="animate-spin" />}
              Send Link Request
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Settings view ─────────────────────────────────────────────────── */

function SettingsView({ hospital, onEditProfile, onLogout }) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="font-display text-2xl font-bold text-brand-900">Settings</h1>

      {/* Account */}
      <section className="mt-6 rounded-xl border border-slate-100 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-800">Account</h2>
          <button
            type="button"
            onClick={onEditProfile}
            className="flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:underline"
          >
            <Pencil size={13} /> Edit profile
          </button>
        </div>
        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          <InfoRow label="Hospital Name" value={hospital?.name || "—"} icon={Building2} />
          <InfoRow label="Email" value={hospital?.email || "—"} icon={Mail} />
          <InfoRow label="Registration Number" value={hospital?.registrationNumber || "—"} />
          <InfoRow label="Hospital Type" value={titleCase(hospital?.hospitalType)} />
          <InfoRow
            label="Verification"
            value={hospital?.isVerified ? "Verified" : "Pending admin verification"}
            icon={BadgeCheck}
          />
          <InfoRow label="Member Since" value={formatDate(hospital?.createdAt)} />
        </dl>
      </section>

      {/* Session */}
      <section className="mt-6 rounded-xl border border-slate-100 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-bold text-slate-800">Session</h2>
        <p className="mt-2 text-sm text-slate-500">Sign out of HealthSync on this device.</p>
        <button
          type="button"
          onClick={onLogout}
          className="mt-4 flex items-center gap-2 rounded-lg border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-50"
        >
          <LogOut size={15} /> Log out
        </button>
      </section>
    </div>
  );
}

/* ─── Shared bits ───────────────────────────────────────────────────── */

function SimpleView({ title, children }) {
  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="font-display text-2xl font-bold text-brand-900">{title}</h1>
      <div className="mt-6">{children}</div>
    </div>
  );
}

function EmptyState({ icon: Icon, title, message }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-200 bg-white px-6 py-14 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
        <Icon size={22} />
      </span>
      <div className="font-display font-bold text-slate-700">{title}</div>
      <p className="max-w-md text-sm text-slate-400">{message}</p>
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-700 placeholder:text-slate-400 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100";

function Field({ label, children, className = "" }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-xs font-semibold text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function InfoRow({ label, value, icon: Icon }) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-xs text-slate-400">
        {Icon && <Icon size={13} />} {label}
      </dt>
      <dd className="mt-1 text-sm font-medium text-slate-700">{value}</dd>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, footer, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border border-slate-100 bg-white p-4 text-left shadow-sm transition hover:border-brand-200 hover:shadow focus:outline-none focus:ring-2 focus:ring-brand-100"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          <Icon size={18} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-xs text-slate-400">{label}</div>
          <div className="font-display text-xl font-bold text-slate-800">{value}</div>
        </div>
      </div>
      {footer}
    </button>
  );
}
