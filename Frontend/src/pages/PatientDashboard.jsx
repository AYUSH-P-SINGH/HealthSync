import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  LayoutGrid,
  CalendarDays,
  FileText,
  MessageSquare,
  Settings,
  LogOut,
  HeartPulse,
  Phone,
  Mail,
  MapPin,
  Droplets,
  PhoneCall,
  Pencil,
  Camera,
  Pill,
  ClipboardList,
  Loader2,
  CircleAlert,
  BadgeCheck,
  Trash2,
  User,
  Building2,
  Check,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { patientApi, API_ORIGIN } from "../lib/api.js";
import { initialsOf, formatDate, titleCase } from "../lib/format.js";
import TopbarActions from "../components/TopbarActions.jsx";

/*
  Patient-facing dashboard, wired to the real backend:
    GET   /api/patients/dashboard        -> { user, dashboard } (profile + counts)
    PATCH /api/patients/profile          -> update editable profile fields
    POST  /api/patients/profile/picture  -> upload profile photo (multipart)
    DELETE /api/patients/profile/picture -> remove profile photo

  Every field starts empty ("—") and fills in only with data the patient has
  actually provided. Clicking the profile chip in the top bar opens a
  slide-over panel with the patient's basic records and an inline edit form
  (it no longer logs the user out). The sidebar tabs each render a real view;
  Appointments / Records / Messages show honest empty states until those
  backend modules ship.
*/

const SIDEBAR_ITEMS = [
  { key: "dashboard", label: "Dashboard", icon: LayoutGrid },
  { key: "appointments", label: "Appointments", icon: CalendarDays },
  { key: "records", label: "Records", icon: FileText },
  { key: "messages", label: "Messages", icon: MessageSquare },
];

const TAB_KEYS = [...SIDEBAR_ITEMS.map((i) => i.key), "settings"];

const GENDERS = ["male", "female", "other"];
const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

function formFromUser(user) {
  return {
    firstName: user?.fullName?.firstName || "",
    lastName: user?.fullName?.lastName || "",
    mobileNumber: user?.mobileNumber || "",
    dob: user?.dob ? user.dob.slice(0, 10) : "",
    gender: user?.gender || "",
    bloodGroup: user?.bloodGroup || "",
    street: user?.address?.street || "",
    city: user?.address?.city || "",
    state: user?.address?.state || "",
    pincode: user?.address?.pincode || "",
    country: user?.address?.country || "",
    ecName: user?.emergencyContact?.name || "",
    ecRelation: user?.emergencyContact?.relation || "",
    ecPhone: user?.emergencyContact?.phone || "",
  };
}

/** Build a PATCH payload containing only filled-in fields. */
function payloadFromForm(form) {
  const put = (obj, key, value) => {
    const v = value.trim();
    if (v) obj[key] = v;
  };

  const payload = {};
  put(payload, "firstName", form.firstName);
  put(payload, "lastName", form.lastName);
  put(payload, "mobileNumber", form.mobileNumber);
  put(payload, "dob", form.dob);
  put(payload, "gender", form.gender);
  put(payload, "bloodGroup", form.bloodGroup);

  const address = {};
  put(address, "street", form.street);
  put(address, "city", form.city);
  put(address, "state", form.state);
  put(address, "pincode", form.pincode);
  put(address, "country", form.country);
  if (Object.keys(address).length) payload.address = address;

  const emergencyContact = {};
  put(emergencyContact, "name", form.ecName);
  put(emergencyContact, "relation", form.ecRelation);
  put(emergencyContact, "phone", form.ecPhone);
  if (Object.keys(emergencyContact).length) payload.emergencyContact = emergencyContact;

  return payload;
}

export default function PatientDashboard() {
  const navigate = useNavigate();
  const { accessToken, user: authUser, logout } = useAuth();
  const fileInputRef = useRef(null);

  // The active tab lives in the URL (?tab=...) so every tab switch pushes a
  // history entry — the browser Back button steps back through tabs instead
  // of leaving the dashboard.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const activeSidebarItem = TAB_KEYS.includes(tabParam) ? tabParam : "dashboard";

  const [recordsTab, setRecordsTab] = useState("records"); // "records" | "prescriptions"
  const [profile, setProfile] = useState(authUser || null);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [editing, setEditing] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState("");
  const [photoError, setPhotoError] = useState("");
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const handleLogout = () => {
    logout();
    navigate("/");
  };

  const refresh = useCallback(async () => {
    const res = await patientApi.getDashboard(accessToken);
    setProfile(res.data.user);
    setSummary(res.data.dashboard);
  }, [accessToken]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setLoadError("");
      try {
        const res = await patientApi.getDashboard(accessToken);
        if (cancelled) return;
        setProfile(res.data.user);
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

  const displayName = profile?.fullName?.firstName
    ? `${profile.fullName.firstName} ${profile.fullName.lastName || ""}`.trim()
    : "Patient";

  const photoUrl = profile?.profilePicture
    ? `${API_ORIGIN}/${profile.profilePicture.replace(/^\/+/, "")}`
    : null;

  /** Shared success path for profile edits (dashboard form + panel form). */
  const handleProfileSaved = (updatedUser, message) => {
    setProfile(updatedUser);
    setEditing(false);
    setSaveSuccess(message || "Profile updated.");
    // Completeness changes with every edit — refresh counts quietly.
    refresh().catch(() => {});
  };

  const handlePhotoChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadingPhoto(true);
    setPhotoError("");
    try {
      const res = await patientApi.uploadProfilePicture(file, accessToken);
      setProfile(res.data);
      refresh().catch(() => {});
    } catch (err) {
      setPhotoError(err.message);
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handlePhotoDelete = async () => {
    setUploadingPhoto(true);
    setPhotoError("");
    try {
      const res = await patientApi.deleteProfilePicture(accessToken);
      setProfile(res.data);
      refresh().catch(() => {});
    } catch (err) {
      setPhotoError(err.message);
    } finally {
      setUploadingPhoto(false);
    }
  };

  const goTo = (item) => {
    setEditing(false);
    if (item !== activeSidebarItem) setSearchParams({ tab: item });
  };

  /* Notifications, built from real hospital-link activity. */
  const [notifications, setNotifications] = useState([]);
  const [notifLoading, setNotifLoading] = useState(true);

  const loadNotifications = useCallback(async () => {
    try {
      const res = await patientApi.listHospitalLinks(accessToken);
      const items = [];
      for (const link of res.data.links || []) {
        const name = link.hospital?.name || "A hospital";
        if (link.status === "pending") {
          items.push({
            id: `${link._id}:pending`,
            unread: true,
            title: `${name} wants to add you`,
            body: "Approve or decline the request from your dashboard.",
            time: link.requestedAt,
            tab: "dashboard",
          });
        } else if (link.status === "active" && link.respondedAt) {
          items.push({
            id: `${link._id}:linked`,
            title: `Linked with ${name}`,
            body: "They can now view your profile and contact details.",
            time: link.respondedAt,
            tab: "dashboard",
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
      {/* Top bar — mirrors HospitalDashboard */}
      <header className="flex h-16 shrink-0 items-center gap-4 border-b border-slate-800 bg-brand-900 px-5">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
            <HeartPulse size={18} />
          </span>
          <span className="font-display text-lg font-bold text-white">HealthSync</span>
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
            title="View profile"
          >
            <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-brand-100 text-sm font-semibold text-brand-900">
              {photoUrl ? (
                <img src={photoUrl} alt={displayName} className="h-full w-full object-cover" />
              ) : (
                initialsOf(displayName)
              )}
            </span>
            <span className="text-sm font-semibold text-white">{displayName}</span>
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Icon rail */}
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
              profile={profile}
              summary={summary}
              displayName={displayName}
              photoUrl={photoUrl}
              accessToken={accessToken}
              editing={editing}
              setEditing={setEditing}
              saveSuccess={saveSuccess}
              setSaveSuccess={setSaveSuccess}
              photoError={photoError}
              uploadingPhoto={uploadingPhoto}
              fileInputRef={fileInputRef}
              onPhotoChange={handlePhotoChange}
              onProfileSaved={handleProfileSaved}
              onSummaryChanged={() => refresh().catch(() => {})}
              onStatClick={{
                completeness: () => setPanelOpen(true),
                appointments: () => goTo("appointments"),
                records: () => {
                  setRecordsTab("records");
                  goTo("records");
                },
                prescriptions: () => {
                  setRecordsTab("prescriptions");
                  goTo("records");
                },
              }}
            />
          ) : activeSidebarItem === "appointments" ? (
            <SimpleView title="Appointments">
              <EmptyState
                icon={CalendarDays}
                title="No appointments yet"
                message="You have no upcoming appointments. Online booking with your hospital opens soon — appointments scheduled for you will appear here."
              />
            </SimpleView>
          ) : activeSidebarItem === "records" ? (
            <SimpleView title="Health Records">
              <div className="flex items-center gap-2 border-b border-slate-100">
                {[
                  { key: "records", label: "Medical Records", count: summary?.totalRecords ?? 0 },
                  { key: "prescriptions", label: "Prescriptions", count: summary?.activePrescriptions ?? 0 },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setRecordsTab(tab.key)}
                    className={`flex items-center gap-2 border-b-2 px-3 pb-3 text-sm font-semibold transition ${
                      recordsTab === tab.key
                        ? "border-brand-600 text-brand-600"
                        : "border-transparent text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    {tab.label}
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                        recordsTab === tab.key ? "bg-brand-50 text-brand-600" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {tab.count}
                    </span>
                  </button>
                ))}
              </div>
              <div className="mt-6">
                {recordsTab === "records" ? (
                  <EmptyState
                    icon={FileText}
                    title="No medical records yet"
                    message="Records shared by your hospitals after visits will be listed here automatically."
                  />
                ) : (
                  <EmptyState
                    icon={Pill}
                    title="No active prescriptions"
                    message="Prescriptions issued by your physicians will appear here once your hospital adds them."
                  />
                )}
              </div>
            </SimpleView>
          ) : activeSidebarItem === "messages" ? (
            <SimpleView title="Messages">
              <EmptyState
                icon={MessageSquare}
                title="No messages"
                message="Secure messaging with your care team is coming soon. Conversations will appear here."
              />
            </SimpleView>
          ) : (
            <SettingsView
              profile={profile}
              displayName={displayName}
              photoUrl={photoUrl}
              uploadingPhoto={uploadingPhoto}
              photoError={photoError}
              fileInputRef={fileInputRef}
              onPhotoChange={handlePhotoChange}
              onPhotoDelete={handlePhotoDelete}
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
        profile={profile}
        summary={summary}
        displayName={displayName}
        photoUrl={photoUrl}
        accessToken={accessToken}
        onProfileSaved={handleProfileSaved}
      />
    </div>
  );
}

/* ─── Dashboard (home) view ─────────────────────────────────────────── */

function DashboardView({
  profile,
  summary,
  displayName,
  photoUrl,
  accessToken,
  editing,
  setEditing,
  saveSuccess,
  setSaveSuccess,
  photoError,
  uploadingPhoto,
  fileInputRef,
  onPhotoChange,
  onProfileSaved,
  onSummaryChanged,
  onStatClick,
}) {
  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      {/* Heading */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-brand-900">
            Welcome back, {profile?.fullName?.firstName || "there"}
          </h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-slate-500">
            Patient ID
            <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-bold text-brand-600">
              {profile?.patientId || "—"}
            </span>
            {profile?.isVerified && (
              <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600">
                <BadgeCheck size={14} /> Verified
              </span>
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
      {photoError && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
          <CircleAlert size={16} /> {photoError}
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
          icon={CalendarDays}
          label="Upcoming Appointments"
          value={summary?.upcomingAppointments ?? 0}
          onClick={onStatClick.appointments}
          footer={<p className="mt-2 text-xs text-slate-400">View appointments</p>}
        />
        <StatCard
          icon={FileText}
          label="Medical Records"
          value={summary?.totalRecords ?? 0}
          onClick={onStatClick.records}
          footer={<p className="mt-2 text-xs text-slate-400">View records</p>}
        />
        <StatCard
          icon={Pill}
          label="Active Prescriptions"
          value={summary?.activePrescriptions ?? 0}
          onClick={onStatClick.prescriptions}
          footer={<p className="mt-2 text-xs text-slate-400">View prescriptions</p>}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        {/* Personal information / edit form */}
        <section className="rounded-xl border border-slate-100 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-bold text-brand-900">Personal Information</h2>
            {editing && (
              <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                Editing
              </span>
            )}
          </div>

          {!editing ? (
            <>
              <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                <InfoRow label="Full Name" value={displayName} />
                <InfoRow label="Date of Birth" value={formatDate(profile?.dob)} />
                <InfoRow label="Age" value={profile?.age != null ? `${profile.age} years` : "—"} />
                <InfoRow label="Gender" value={titleCase(profile?.gender)} />
                <InfoRow label="Blood Group" value={profile?.bloodGroup || "—"} icon={Droplets} />
                <InfoRow label="Mobile" value={profile?.mobileNumber || "—"} icon={Phone} />
                <InfoRow label="Email" value={profile?.email || "—"} icon={Mail} />
                <InfoRow
                  label="Address"
                  icon={MapPin}
                  value={
                    [
                      profile?.address?.street,
                      profile?.address?.city,
                      profile?.address?.state,
                      profile?.address?.pincode,
                      profile?.address?.country,
                    ]
                      .filter(Boolean)
                      .join(", ") || "—"
                  }
                />
              </dl>
              {(summary?.profileCompleteness ?? 100) < 100 && (
                <p className="mt-5 rounded-lg bg-brand-50 px-4 py-3 text-sm text-brand-700">
                  Your profile is {summary?.profileCompleteness}% complete. A complete profile helps
                  hospitals treat you faster.
                </p>
              )}
            </>
          ) : (
            <div className="mt-5">
              <ProfileEditForm
                profile={profile}
                accessToken={accessToken}
                onSaved={onProfileSaved}
                onCancel={() => setEditing(false)}
              />
            </div>
          )}
        </section>

        {/* Right column */}
        <aside className="flex flex-col gap-6">
          {/* Profile card */}
          <section className="rounded-xl border border-slate-100 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-4">
              <div className="relative">
                <span className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-brand-100 text-lg font-bold text-brand-900">
                  {photoUrl ? (
                    <img src={photoUrl} alt={displayName} className="h-full w-full object-cover" />
                  ) : (
                    initialsOf(displayName)
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingPhoto}
                  title="Change photo"
                  className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-brand-900 text-white transition hover:bg-brand-700 disabled:opacity-60"
                >
                  {uploadingPhoto ? <Loader2 size={13} className="animate-spin" /> : <Camera size={13} />}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={onPhotoChange}
                />
              </div>
              <div className="min-w-0">
                <div className="truncate font-display font-bold text-slate-800">{displayName}</div>
                <div className="text-sm text-slate-400">
                  {profile?.age != null ? `${profile.age} Y` : "Age —"}
                  {profile?.gender ? `, ${titleCase(profile.gender)}` : ""}
                </div>
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-1.5 text-sm text-slate-500">
              <span className="flex items-center gap-2">
                <Phone size={14} /> {profile?.mobileNumber || "—"}
              </span>
              <span className="flex items-center gap-2 break-all">
                <Mail size={14} /> {profile?.email || "—"}
              </span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 text-sm">
              <div>
                <div className="text-xs text-slate-400">Blood Group</div>
                <div className="mt-0.5 font-semibold text-slate-800">{profile?.bloodGroup || "—"}</div>
              </div>
              <div>
                <div className="text-xs text-slate-400">Member Since</div>
                <div className="mt-0.5 font-semibold text-slate-800">{formatDate(profile?.createdAt)}</div>
              </div>
            </div>
          </section>

          {/* Emergency contact */}
          <section className="rounded-xl border border-slate-100 bg-white p-6 shadow-sm">
            <h3 className="text-sm font-bold text-slate-800">Emergency Contact</h3>
            {profile?.emergencyContact?.name ? (
              <div className="mt-3 flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-brand-600">
                  <PhoneCall size={16} />
                </span>
                <div>
                  <div className="text-sm font-semibold text-slate-800">
                    {profile.emergencyContact.name}{" "}
                    {profile.emergencyContact.relation && (
                      <span className="font-normal text-slate-400">
                        ({profile.emergencyContact.relation})
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-slate-500">
                    {profile.emergencyContact.phone || "No phone on file"}
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-3 rounded-xl border border-dashed border-slate-200 p-4 text-center text-sm text-slate-400">
                No emergency contact yet.{" "}
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="font-semibold text-brand-600 hover:underline"
                >
                  Add one
                </button>
              </div>
            )}
          </section>

          {/* Hospitals: pending consent requests + linked hospitals */}
          <HospitalLinksCard accessToken={accessToken} onChanged={onSummaryChanged} />
        </aside>
      </div>
    </div>
  );
}

/* ─── My Hospitals card (consent requests + linked hospitals) ───────── */

function HospitalLinksCard({ accessToken, onChanged }) {
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await patientApi.listHospitalLinks(accessToken);
      setLinks(res.data.links);
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

  const pending = links.filter((l) => l.status === "pending");
  const active = links.filter((l) => l.status === "active");

  const respond = async (link, action) => {
    setBusyId(`${link._id}:${action}`);
    setError("");
    try {
      await patientApi.respondToHospitalRequest(link._id, action, accessToken);
      await load();
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const revoke = async (link) => {
    setBusyId(`${link._id}:revoke`);
    setError("");
    try {
      await patientApi.revokeHospitalLink(link._id, accessToken);
      await load();
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="rounded-xl border border-slate-100 bg-white p-6 shadow-sm">
      <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800">
        <Building2 size={15} /> My Hospitals
        {pending.length > 0 && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">
            {pending.length} pending
          </span>
        )}
      </h3>

      {error && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          <CircleAlert size={13} /> {error}
        </div>
      )}

      {loading ? (
        <div className="mt-3 flex items-center gap-2 py-4 text-sm text-slate-400">
          <Loader2 size={15} className="animate-spin" /> Loading…
        </div>
      ) : (
        <>
          {/* Incoming consent requests */}
          {pending.map((link) => (
            <div
              key={link._id}
              className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3"
            >
              <div className="text-sm font-semibold text-slate-800">
                {link.hospital?.name || "A hospital"}
              </div>
              <div className="text-xs text-slate-500">
                {titleCase(link.hospital?.hospitalType, "")}
                {link.hospital?.city ? ` · ${link.hospital.city}` : ""} — wants to add you as a
                patient. Approving shares your profile and contact details with them.
              </div>
              <div className="mt-2.5 flex items-center gap-2">
                <button
                  type="button"
                  disabled={busyId === `${link._id}:approve`}
                  onClick={() => respond(link, "approve")}
                  className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                >
                  {busyId === `${link._id}:approve` ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Check size={13} />
                  )}
                  Approve
                </button>
                <button
                  type="button"
                  disabled={busyId === `${link._id}:reject`}
                  onClick={() => respond(link, "reject")}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-60"
                >
                  <X size={13} /> Decline
                </button>
              </div>
            </div>
          ))}

          {/* Linked hospitals */}
          {active.map((link) => (
            <div
              key={link._id}
              className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50 p-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 truncate text-sm font-semibold text-slate-800">
                  {link.hospital?.name || "—"}
                  {link.hospital?.isVerified && (
                    <BadgeCheck size={13} className="shrink-0 text-emerald-500" />
                  )}
                </div>
                <div className="text-xs text-slate-400">
                  {titleCase(link.hospital?.hospitalType, "")}
                  {link.hospital?.city ? ` · ${link.hospital.city}` : ""} · since{" "}
                  {formatDate(link.respondedAt)}
                </div>
              </div>
              <button
                type="button"
                disabled={busyId === `${link._id}:revoke`}
                onClick={() => revoke(link)}
                title="Revoke this hospital's access"
                className="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-60"
              >
                {busyId === `${link._id}:revoke` ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  "Revoke"
                )}
              </button>
            </div>
          ))}

          {pending.length === 0 && active.length === 0 && (
            <p className="mt-3 rounded-xl border border-dashed border-slate-200 p-4 text-center text-sm text-slate-400">
              No hospitals linked yet. Share your Patient ID with a hospital and approve their
              request here.
            </p>
          )}
        </>
      )}
    </section>
  );
}

/* ─── Slide-over profile panel ──────────────────────────────────────── */

function ProfilePanel({ open, onClose, profile, summary, displayName, photoUrl, accessToken, onProfileSaved }) {
  const [panelEditing, setPanelEditing] = useState(false);

  // Reset to view mode whenever the panel is (re)opened.
  useEffect(() => {
    if (open) setPanelEditing(false);
  }, [open]);

  if (!open) return null;

  const addressText =
    [
      profile?.address?.street,
      profile?.address?.city,
      profile?.address?.state,
      profile?.address?.pincode,
      profile?.address?.country,
    ]
      .filter(Boolean)
      .join(", ") || "—";

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
            <User size={18} /> My Profile
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
            <span className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-brand-100 text-lg font-bold text-brand-900">
              {photoUrl ? (
                <img src={photoUrl} alt={displayName} className="h-full w-full object-cover" />
              ) : (
                initialsOf(displayName)
              )}
            </span>
            <div className="min-w-0">
              <div className="truncate font-display font-bold text-slate-800">{displayName}</div>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                <span className="rounded-full bg-brand-50 px-2 py-0.5 font-bold text-brand-600">
                  {profile?.patientId || "—"}
                </span>
                {profile?.isVerified && (
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
              {/* Basic records */}
              <dl className="mt-6 grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
                <InfoRow label="Date of Birth" value={formatDate(profile?.dob)} />
                <InfoRow label="Age" value={profile?.age != null ? `${profile.age} years` : "—"} />
                <InfoRow label="Gender" value={titleCase(profile?.gender)} />
                <InfoRow label="Blood Group" value={profile?.bloodGroup || "—"} icon={Droplets} />
                <InfoRow label="Mobile" value={profile?.mobileNumber || "—"} icon={Phone} />
                <InfoRow label="Email" value={profile?.email || "—"} icon={Mail} />
              </dl>
              <div className="mt-4">
                <InfoRow label="Address" value={addressText} icon={MapPin} />
              </div>
              <div className="mt-4">
                <InfoRow
                  label="Emergency Contact"
                  icon={PhoneCall}
                  value={
                    profile?.emergencyContact?.name
                      ? `${profile.emergencyContact.name}${
                          profile.emergencyContact.relation
                            ? ` (${profile.emergencyContact.relation})`
                            : ""
                        }${profile.emergencyContact.phone ? ` — ${profile.emergencyContact.phone}` : ""}`
                      : "—"
                  }
                />
              </div>
              <div className="mt-4">
                <InfoRow label="Member Since" value={formatDate(profile?.createdAt)} />
              </div>

              <button
                type="button"
                onClick={() => setPanelEditing(true)}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
              >
                <Pencil size={15} /> Edit Profile
              </button>
              <p className="mt-3 text-center text-xs text-slate-400">
                Email and Patient ID can&apos;t be changed. Contact support if they&apos;re wrong.
              </p>
            </>
          ) : (
            <div className="mt-6">
              <ProfileEditForm
                profile={profile}
                accessToken={accessToken}
                compact
                onSaved={(user, message) => {
                  setPanelEditing(false);
                  onProfileSaved(user, message);
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

/* ─── Reusable profile edit form (dashboard section + panel) ────────── */

function ProfileEditForm({ profile, accessToken, onSaved, onCancel, compact = false }) {
  const [form, setForm] = useState(() => formFromUser(profile));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const setField = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSave = async (e) => {
    e.preventDefault();
    const payload = payloadFromForm(form);
    if (Object.keys(payload).length === 0) {
      setSaveError("Fill in at least one field before saving.");
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      const res = await patientApi.updateProfile(payload, accessToken);
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
        <Field label="First Name">
          <input className={inputCls} value={form.firstName} onChange={setField("firstName")} placeholder="First name" />
        </Field>
        <Field label="Last Name">
          <input className={inputCls} value={form.lastName} onChange={setField("lastName")} placeholder="Last name" />
        </Field>
        <Field label="Mobile Number">
          <input className={inputCls} value={form.mobileNumber} onChange={setField("mobileNumber")} placeholder="10-digit mobile number" inputMode="numeric" />
        </Field>
        <Field label="Date of Birth">
          <input type="date" className={inputCls} value={form.dob} onChange={setField("dob")} max={new Date().toISOString().slice(0, 10)} />
        </Field>
        <Field label="Gender">
          <select className={inputCls} value={form.gender} onChange={setField("gender")}>
            <option value="">Select gender</option>
            {GENDERS.map((g) => (
              <option key={g} value={g}>{titleCase(g)}</option>
            ))}
          </select>
        </Field>
        <Field label="Blood Group">
          <select className={inputCls} value={form.bloodGroup} onChange={setField("bloodGroup")}>
            <option value="">Select blood group</option>
            {BLOOD_GROUPS.map((bg) => (
              <option key={bg} value={bg}>{bg}</option>
            ))}
          </select>
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

      <h3 className="mt-6 text-sm font-bold text-slate-800">Emergency Contact</h3>
      <div className={`mt-3 grid gap-4 ${compact ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-3"}`}>
        <Field label="Name">
          <input className={inputCls} value={form.ecName} onChange={setField("ecName")} placeholder="Contact name" />
        </Field>
        <Field label="Relation">
          <input className={inputCls} value={form.ecRelation} onChange={setField("ecRelation")} placeholder="e.g. Spouse" />
        </Field>
        <Field label="Phone">
          <input className={inputCls} value={form.ecPhone} onChange={setField("ecPhone")} placeholder="10-digit mobile number" inputMode="numeric" />
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

/* ─── Settings view ─────────────────────────────────────────────────── */

function SettingsView({
  profile,
  displayName,
  photoUrl,
  uploadingPhoto,
  photoError,
  fileInputRef,
  onPhotoChange,
  onPhotoDelete,
  onEditProfile,
  onLogout,
}) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="font-display text-2xl font-bold text-brand-900">Settings</h1>

      {photoError && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
          <CircleAlert size={16} /> {photoError}
        </div>
      )}

      {/* Profile photo */}
      <section className="mt-6 rounded-xl border border-slate-100 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-bold text-slate-800">Profile Photo</h2>
        <div className="mt-4 flex items-center gap-4">
          <span className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-brand-100 text-lg font-bold text-brand-900">
            {photoUrl ? (
              <img src={photoUrl} alt={displayName} className="h-full w-full object-cover" />
            ) : (
              initialsOf(displayName)
            )}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingPhoto}
              className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-60"
            >
              {uploadingPhoto ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
              {photoUrl ? "Change photo" : "Upload photo"}
            </button>
            {photoUrl && (
              <button
                type="button"
                onClick={onPhotoDelete}
                disabled={uploadingPhoto}
                className="flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-rose-600"
              >
                <Trash2 size={14} /> Remove
              </button>
            )}
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onPhotoChange} />
        </div>
      </section>

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
          <InfoRow label="Full Name" value={displayName} />
          <InfoRow label="Email" value={profile?.email || "—"} icon={Mail} />
          <InfoRow label="Patient ID" value={profile?.patientId || "—"} />
          <InfoRow
            label="Email Verification"
            value={profile?.isVerified ? "Verified" : "Not verified"}
            icon={BadgeCheck}
          />
          <InfoRow label="Member Since" value={formatDate(profile?.createdAt)} />
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
