import { useState, useEffect } from "react";
import {
  ShieldCheck,
  Search,
  UserCheck,
  FileText,
  FileCheck2,
  Clock,
  LogOut,
  AlertCircle,
  CheckCircle2,
  XCircle,
  FileCode,
  Building2,
  Layers,
  ChevronRight,
  Send,
  Eye,
} from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { insuranceApi } from "../lib/api.js";
import ClaimDetailDrawer from "../components/ClaimDetailDrawer.jsx";
import { onSocketEvent } from "../lib/socket.js";

export default function InsuranceDashboard() {
  // AuthContext exposes `accessToken` (not `token`) — alias it locally.
  // Destructuring a non-existent `token` sent every request without an
  // Authorization header, causing 401 "not authorized" on this dashboard.
  const { user, accessToken: token, logout } = useAuth();
  const [activeTab, setActiveTab] = useState("overview");

  // State
  const [summary, setSummary] = useState(null);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // Search Patient
  const [searchId, setSearchId] = useState("");
  const [searching, setSearching] = useState(false);
  const [foundPatient, setFoundPatient] = useState(null);

  // Request Access Form
  const [requestPurpose, setRequestPurpose] = useState("Health Policy Underwriting & Risk Assessment");
  const [requestedPermissions, setRequestedPermissions] = useState([
    "medicalHistory",
    "allergies",
    "prescriptions",
    "reports",
    "bloodGroup",
  ]);
  const [requesting, setRequesting] = useState(false);

  // Patient Roster
  const [patients, setPatients] = useState([]);
  const [loadingPatients, setLoadingPatients] = useState(false);
  const [selectedPatientRecords, setSelectedPatientRecords] = useState(null);
  const [loadingRecords, setLoadingRecords] = useState(false);

  // Policy Issuance
  const [policies, setPolicies] = useState([]);
  const [loadingPolicies, setLoadingPolicies] = useState(false);
  const [policyForm, setPolicyForm] = useState({
    patientId: "",
    type: "Individual Health",
    coverageAmount: 500000,
    premium: 12000,
    durationMonths: 12,
  });
  const [issuingPolicy, setIssuingPolicy] = useState(false);
  const [selectedDisclosure, setSelectedDisclosure] = useState(null);

  // Claims
  const [claims, setClaims] = useState([]);
  const [loadingClaims, setLoadingClaims] = useState(false);
  const [selectedClaim, setSelectedClaim] = useState(null);
  const [openClaim, setOpenClaim] = useState(null);
  const [unreadCounts, setUnreadCounts] = useState({});
  const [claimActionForm, setClaimActionForm] = useState({
    status: "approved",
    approvedAmount: 0,
    rejectionReason: "",
    comment: "",
  });
  const [updatingClaim, setUpdatingClaim] = useState(false);

  // Fetch Dashboard Summary
  const fetchSummary = async () => {
    try {
      setLoadingSummary(true);
      const res = await insuranceApi.getDashboard(token);
      setSummary(res.data);
    } catch (err) {
      setError(err.message || "Failed to load dashboard summary.");
    } finally {
      setLoadingSummary(false);
    }
  };

  // Fetch Patients List
  const fetchPatients = async () => {
    try {
      setLoadingPatients(true);
      const res = await insuranceApi.listPatients(token);
      setPatients(res.data || []);
    } catch (err) {
      setError(err.message || "Failed to load patient connections.");
    } finally {
      setLoadingPatients(false);
    }
  };

  // Fetch Policies List
  const fetchPolicies = async () => {
    try {
      setLoadingPolicies(true);
      const res = await insuranceApi.listPolicies(token);
      setPolicies(res.data || []);
    } catch (err) {
      setError(err.message || "Failed to load policies.");
    } finally {
      setLoadingPolicies(false);
    }
  };

  // Fetch Claims List
  const fetchClaims = async () => {
    try {
      setLoadingClaims(true);
      const res = await insuranceApi.listClaims(token);
      setClaims(res.data || []);
      const unreadRes = await insuranceApi.getClaimUnreadCounts(token).catch(() => ({ data: {} }));
      setUnreadCounts(unreadRes.data || {});
    } catch (err) {
      setError(err.message || "Failed to load claims.");
    } finally {
      setLoadingClaims(false);
    }
  };

  useEffect(() => {
    fetchSummary();
  }, [token]);

  useEffect(() => {
    if (activeTab === "patients") fetchPatients();
    if (activeTab === "policies") {
      fetchPatients();
      fetchPolicies();
    }
    if (activeTab === "claims") fetchClaims();
  }, [activeTab]);

  // Live updates: refetch the dashboard summary and whichever tab is
  // currently open the instant a patient acts on a consent request or a
  // claim thread changes — no manual refresh, no polling.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const refresh = () => {
      fetchSummary();
      if (activeTab === "patients") fetchPatients();
      if (activeTab === "policies") {
        fetchPatients();
        fetchPolicies();
      }
      if (activeTab === "claims") fetchClaims();
    };

    const events = ["consent:updated", "claim:new", "claim:updated", "claim:message"];
    const unsubscribers = events.map((event) => onSocketEvent(event, refresh));
    return () => unsubscribers.forEach((unsub) => unsub());
  }, [activeTab, token]);

  // Handle Search Patient by HealthSync ID
  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchId.trim()) return;
    setError("");
    setMessage("");
    setSearching(true);
    setFoundPatient(null);
    try {
      const res = await insuranceApi.searchPatient(searchId.trim(), token);
      setFoundPatient(res.data);
    } catch (err) {
      setError(err.message || "Patient not found.");
    } finally {
      setSearching(false);
    }
  };

  // Handle Request Access
  const handleRequestAccess = async (e) => {
    e.preventDefault();
    if (!foundPatient) return;
    setError("");
    setMessage("");
    setRequesting(true);
    try {
      await insuranceApi.requestAccess(
        {
          healthSyncId: foundPatient.healthSyncId,
          purpose: requestPurpose,
          permissions: requestedPermissions,
        },
        token
      );
      setMessage(`Access request sent to patient ${foundPatient.patientName} successfully!`);
      setFoundPatient(null);
      setSearchId("");
      fetchSummary();
    } catch (err) {
      setError(err.message || "Failed to send access request.");
    } finally {
      setRequesting(false);
    }
  };

  // Toggle permission selection checkbox
  const togglePermission = (perm) => {
    if (requestedPermissions.includes(perm)) {
      setRequestedPermissions(requestedPermissions.filter((p) => p !== perm));
    } else {
      setRequestedPermissions([...requestedPermissions, perm]);
    }
  };

  // View Permission-Scoped Records
  const handleViewRecords = async (patientId) => {
    setError("");
    setLoadingRecords(true);
    try {
      const res = await insuranceApi.getPatientRecords(patientId, token);
      setSelectedPatientRecords(res.data);
    } catch (err) {
      setError(err.message || "Could not retrieve records.");
    } finally {
      setLoadingRecords(false);
    }
  };

  // Issue Policy
  const handleIssuePolicy = async (e) => {
    e.preventDefault();
    if (!policyForm.patientId) {
      setError("Please select an approved patient.");
      return;
    }
    setError("");
    setMessage("");
    setIssuingPolicy(true);
    try {
      const res = await insuranceApi.issuePolicy(
        {
          patientId: policyForm.patientId,
          type: policyForm.type,
          coverageAmount: Number(policyForm.coverageAmount),
          premium: Number(policyForm.premium),
          durationMonths: Number(policyForm.durationMonths),
        },
        token
      );
      setMessage(`Policy ${res.data.policy.policyNumber} issued with cryptographic disclosure record!`);
      fetchPolicies();
      fetchSummary();
      setSelectedDisclosure(res.data.disclosure);
    } catch (err) {
      setError(err.message || "Failed to issue policy.");
    } finally {
      setIssuingPolicy(false);
    }
  };

  // Update Claim Status
  const handleUpdateClaimStatus = async (e) => {
    e.preventDefault();
    if (!selectedClaim) return;
    setError("");
    setMessage("");
    setUpdatingClaim(true);
    try {
      await insuranceApi.updateClaimStatus(
        selectedClaim._id,
        {
          status: claimActionForm.status,
          approvedAmount: Number(claimActionForm.approvedAmount),
          rejectionReason: claimActionForm.rejectionReason,
          comment: claimActionForm.comment,
        },
        token
      );
      setMessage(`Claim ${selectedClaim.claimNumber} status updated to '${claimActionForm.status}'.`);
      setSelectedClaim(null);
      fetchClaims();
      fetchSummary();
    } catch (err) {
      setError(err.message || "Failed to update claim status.");
    } finally {
      setUpdatingClaim(false);
    }
  };

  const approvedPatientsList = patients.filter((p) => p.status === "approved");

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-800">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-brand-700 to-indigo-600 text-white shadow-md shadow-brand-500/20">
              <ShieldCheck size={22} />
            </span>
            <div>
              <h1 className="font-display text-lg font-bold text-slate-900 leading-tight">
                {user?.companyName || "Insurance Portal"}
              </h1>
              <p className="text-xs text-slate-500 flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-500"></span>
                IRDAI Reg: {user?.registrationNumber || "IRDAI-HLT-2026"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={logout}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
            >
              <LogOut size={15} />
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {/* Messages */}
        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <AlertCircle size={18} className="shrink-0" />
            <p className="flex-1">{error}</p>
            <button onClick={() => setError("")} className="text-red-500 font-bold">&times;</button>
          </div>
        )}

        {message && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            <CheckCircle2 size={18} className="shrink-0 text-emerald-600" />
            <p className="flex-1">{message}</p>
            <button onClick={() => setMessage("")} className="text-emerald-500 font-bold">&times;</button>
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="mb-6 flex space-x-1 overflow-x-auto rounded-2xl bg-white p-1.5 shadow-sm border border-slate-200">
          {[
            { id: "overview", label: "Dashboard Overview", icon: Layers },
            { id: "search", label: "Search Patient (HealthSync ID)", icon: Search },
            { id: "patients", label: "Consent & Patient Roster", icon: UserCheck },
            { id: "policies", label: "Policies & Disclosures", icon: FileCheck2 },
            { id: "claims", label: "Claims Processor", icon: FileText },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-xs font-semibold transition ${
                activeTab === id
                  ? "bg-brand-600 text-white shadow-md shadow-brand-500/20"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </div>

        {/* Tab 1: Overview */}
        {activeTab === "overview" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-500">Active Policies</span>
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                    <FileCheck2 size={18} />
                  </span>
                </div>
                <p className="mt-3 text-2xl font-bold text-slate-900">
                  {summary?.activePoliciesCount ?? 0}
                </p>
                <p className="mt-1 text-xs text-slate-400">Issued & active coverage</p>
              </div>

              <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-500">Pending Consent Requests</span>
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                    <Clock size={18} />
                  </span>
                </div>
                <p className="mt-3 text-2xl font-bold text-slate-900">
                  {summary?.pendingRequestsCount ?? 0}
                </p>
                <p className="mt-1 text-xs text-slate-400">Awaiting patient response</p>
              </div>

              <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-500">Approved Patients</span>
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                    <UserCheck size={18} />
                  </span>
                </div>
                <p className="mt-3 text-2xl font-bold text-slate-900">
                  {summary?.approvedPatientsCount ?? 0}
                </p>
                <p className="mt-1 text-xs text-slate-400">Permission-scoped record access</p>
              </div>

              <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-500">Claims in Review</span>
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-50 text-purple-600">
                    <FileText size={18} />
                  </span>
                </div>
                <p className="mt-3 text-2xl font-bold text-slate-900">
                  {summary?.pendingClaimsCount ?? 0}
                </p>
                <p className="mt-1 text-xs text-slate-400">Requires review/approval</p>
              </div>
            </div>

            {/* Banner */}
            <div className="rounded-2xl border border-brand-100 bg-gradient-to-r from-brand-900 via-brand-800 to-indigo-900 p-6 text-white shadow-xl">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h2 className="font-display text-xl font-bold">Privacy-First Consent-Based Underwriting</h2>
                  <p className="mt-1 text-sm text-brand-100 max-w-2xl">
                    HealthSync enables your organization to request verified medical history directly from patients. 
                    Every policy issued generates an immutable SHA-256 digitally signed disclosure record to eliminate claims disputes.
                  </p>
                </div>
                <button
                  onClick={() => setActiveTab("search")}
                  className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-xs font-bold text-brand-900 shadow-lg transition hover:bg-brand-50"
                >
                  <Search size={16} />
                  Search HealthSync ID
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Search Patient */}
        {activeTab === "search" && (
          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="font-display text-lg font-bold text-slate-900">
                Search Patient by HealthSync ID
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Enter the patient&apos;s unique HealthSync ID (e.g. HS-8F29A410). Insurers can preview masked basic demographics before sending an access request.
              </p>

              <form onSubmit={handleSearch} className="mt-4 flex gap-3">
                <input
                  type="text"
                  placeholder="Enter HealthSync ID (e.g. HS-8F29A410)"
                  value={searchId}
                  onChange={(e) => setSearchId(e.target.value)}
                  className="flex-1 rounded-xl border border-slate-200 px-4 py-3 text-sm font-mono uppercase tracking-wider outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                />
                <button
                  type="submit"
                  disabled={searching}
                  className="flex items-center gap-2 rounded-xl bg-brand-600 px-6 py-3 text-xs font-bold text-white shadow-md shadow-brand-500/20 transition hover:bg-brand-700 disabled:opacity-60"
                >
                  <Search size={16} />
                  {searching ? "Searching..." : "Lookup Patient"}
                </button>
              </form>

              {/* Found Patient Preview */}
              {foundPatient && (
                <div className="mt-6 rounded-2xl border border-brand-200 bg-brand-50/40 p-6">
                  <div className="flex items-center justify-between border-b border-brand-100 pb-4">
                    <div>
                      <h3 className="font-display text-base font-bold text-brand-900">
                        {foundPatient.patientName}
                      </h3>
                      <p className="text-xs text-brand-700 font-mono mt-0.5">
                        ID: {foundPatient.healthSyncId}
                      </p>
                    </div>
                    <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                      Verified HealthSync Member
                    </span>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-4 text-xs sm:grid-cols-4">
                    <div>
                      <span className="text-slate-500 block">Masked Email</span>
                      <span className="font-semibold text-slate-800">{foundPatient.maskedEmail}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Age</span>
                      <span className="font-semibold text-slate-800">{foundPatient.age ? `${foundPatient.age} yrs` : "N/A"}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Gender</span>
                      <span className="font-semibold text-slate-800 capitalize">{foundPatient.gender}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Blood Group</span>
                      <span className="font-semibold text-slate-800">{foundPatient.bloodGroup}</span>
                    </div>
                  </div>

                  {/* Access Request Form */}
                  <form onSubmit={handleRequestAccess} className="mt-6 border-t border-brand-100 pt-5 space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Purpose of Access Request
                      </label>
                      <input
                        type="text"
                        value={requestPurpose}
                        onChange={(e) => setRequestPurpose(e.target.value)}
                        required
                        className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-xs outline-none focus:border-brand-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-2">
                        Requested Scoped Data Permissions
                      </label>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {[
                          { key: "medicalHistory", label: "Medical History" },
                          { key: "allergies", label: "Allergies" },
                          { key: "prescriptions", label: "Prescriptions" },
                          { key: "reports", label: "Lab Reports" },
                          { key: "bloodGroup", label: "Blood Group" },
                        ].map(({ key, label }) => (
                          <label key={key} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-2.5 text-xs font-medium text-slate-700 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={requestedPermissions.includes(key)}
                              onChange={() => togglePermission(key)}
                              className="rounded text-brand-600 focus:ring-brand-500"
                            />
                            {label}
                          </label>
                        ))}
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={requesting}
                      className="flex items-center gap-2 rounded-xl bg-brand-600 px-6 py-3 text-xs font-bold text-white shadow-md shadow-brand-500/20 transition hover:bg-brand-700 disabled:opacity-60"
                    >
                      <Send size={15} />
                      {requesting ? "Sending..." : "Send Consent Request"}
                    </button>
                  </form>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 3: Consent & Patient Roster */}
        {activeTab === "patients" && (
          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-display text-lg font-bold text-slate-900">
                  Consent Requests & Approved Patients
                </h2>
                <button
                  onClick={fetchPatients}
                  className="text-xs font-semibold text-brand-600 hover:text-brand-700"
                >
                  Refresh Roster
                </button>
              </div>

              {loadingPatients ? (
                <p className="text-xs text-slate-500 py-6 text-center">Loading patient connections...</p>
              ) : patients.length === 0 ? (
                <p className="text-xs text-slate-500 py-8 text-center">No patient connections found. Search for a patient to request access.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-semibold">
                        <th className="p-3">Patient Name</th>
                        <th className="p-3">HealthSync ID</th>
                        <th className="p-3">Consent Status</th>
                        <th className="p-3">Purpose</th>
                        <th className="p-3">Permissions Granted</th>
                        <th className="p-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {patients.map((item) => (
                        <tr key={item._id} className="hover:bg-slate-50/80">
                          <td className="p-3 font-semibold text-slate-900">
                            {item.patient?.fullName ? `${item.patient.fullName.firstName} ${item.patient.fullName.lastName}` : "Patient"}
                          </td>
                          <td className="p-3 font-mono text-slate-600">{item.patient?.healthSyncId || "N/A"}</td>
                          <td className="p-3">
                            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                              item.status === "approved"
                                ? "bg-emerald-100 text-emerald-800"
                                : item.status === "pending"
                                ? "bg-amber-100 text-amber-800"
                                : "bg-red-100 text-red-800"
                            }`}>
                              {item.status === "approved" && <CheckCircle2 size={12} />}
                              {item.status === "pending" && <Clock size={12} />}
                              {item.status}
                            </span>
                          </td>
                          <td className="p-3 text-slate-600 max-w-xs truncate">{item.purpose}</td>
                          <td className="p-3">
                            <div className="flex flex-wrap gap-1">
                              {(item.permissions || []).map((perm) => (
                                <span key={perm} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                                  {perm}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="p-3 text-right">
                            {item.status === "approved" && (
                              <button
                                onClick={() => handleViewRecords(item.patient._id)}
                                className="inline-flex items-center gap-1 rounded-lg bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-100"
                              >
                                <Eye size={14} />
                                View Records
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Modal for viewing permission-scoped records */}
            {selectedPatientRecords && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
                <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                    <div>
                      <h3 className="font-display text-lg font-bold text-slate-900">
                        {selectedPatientRecords.patientName} &mdash; Permission Scoped Records
                      </h3>
                      <p className="text-xs text-slate-500 font-mono">
                        HealthSync ID: {selectedPatientRecords.healthSyncId}
                      </p>
                    </div>
                    <button
                      onClick={() => setSelectedPatientRecords(null)}
                      className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    >
                      &times;
                    </button>
                  </div>

                  <div className="mt-4 space-y-4 text-xs">
                    <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-amber-800">
                      <strong>Privacy Notice:</strong> These records are filtered strictly according to patient consent permissions: [{selectedPatientRecords.permissionsGranted.join(", ")}].
                    </div>

                    {selectedPatientRecords.medicalHistory && (
                      <div className="rounded-xl border border-slate-200 p-4">
                        <h4 className="font-bold text-slate-800 mb-2">Medical History Conditions</h4>
                        <ul className="space-y-1.5">
                          {selectedPatientRecords.medicalHistory.map((item, idx) => (
                            <li key={idx} className="flex justify-between border-b border-slate-100 pb-1">
                              <span className="font-semibold text-slate-700">{item.condition}</span>
                              <span className="text-slate-500">{item.status} (Diagnosed {item.diagnosedYear})</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {selectedPatientRecords.allergies && (
                      <div className="rounded-xl border border-slate-200 p-4">
                        <h4 className="font-bold text-slate-800 mb-2">Diagnosed Allergies</h4>
                        <ul className="space-y-1.5">
                          {selectedPatientRecords.allergies.map((item, idx) => (
                            <li key={idx} className="flex justify-between border-b border-slate-100 pb-1">
                              <span className="font-semibold text-slate-700">{item.name}</span>
                              <span className="text-red-600 font-medium">Severity: {item.severity}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {selectedPatientRecords.prescriptions && (
                      <div className="rounded-xl border border-slate-200 p-4">
                        <h4 className="font-bold text-slate-800 mb-2">Active Prescriptions</h4>
                        <ul className="space-y-1.5">
                          {selectedPatientRecords.prescriptions.map((item, idx) => (
                            <li key={idx} className="flex justify-between border-b border-slate-100 pb-1">
                              <div>
                                <p className="font-semibold text-slate-700">{item.medication}</p>
                                <p className="text-[11px] text-slate-400">Prescribed by {item.doctor}</p>
                              </div>
                              <span className="text-slate-600">{item.dosage}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {selectedPatientRecords.reports && (
                      <div className="rounded-xl border border-slate-200 p-4">
                        <h4 className="font-bold text-slate-800 mb-2">Verified Diagnostic Reports</h4>
                        <ul className="space-y-1.5">
                          {selectedPatientRecords.reports.map((item, idx) => (
                            <li key={idx} className="flex justify-between border-b border-slate-100 pb-1">
                              <div>
                                <p className="font-semibold text-slate-700">{item.title}</p>
                                <p className="text-[11px] text-slate-400">{item.lab} &bull; {item.testDate}</p>
                              </div>
                              <span className="font-bold text-emerald-700">{item.result}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  <div className="mt-6 flex justify-end">
                    <button
                      onClick={() => setSelectedPatientRecords(null)}
                      className="rounded-xl bg-slate-900 px-5 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                    >
                      Close Viewer
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 4: Policies & Disclosures */}
        {activeTab === "policies" && (
          <div className="space-y-6">
            {/* Issue Policy Card */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="font-display text-lg font-bold text-slate-900 mb-1">
                Issue Insurance Policy & Digital Disclosure
              </h2>
              <p className="text-xs text-slate-500 mb-4">
                Issuing a policy automatically snapshots the approved patient medical history and generates a cryptographically signed SHA-256 Disclosure Record.
              </p>

              <form onSubmit={handleIssuePolicy} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Select Approved Patient
                  </label>
                  <select
                    value={policyForm.patientId}
                    onChange={(e) => setPolicyForm({ ...policyForm, patientId: e.target.value })}
                    required
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-xs outline-none focus:border-brand-500"
                  >
                    <option value="">-- Choose Approved Patient --</option>
                    {approvedPatientsList.map((p) => (
                      <option key={p.patient?._id || p._id} value={p.patient?._id}>
                        {p.patient?.fullName ? `${p.patient.fullName.firstName} ${p.patient.fullName.lastName}` : "Patient"} ({p.patient?.healthSyncId})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Policy Type
                  </label>
                  <select
                    value={policyForm.type}
                    onChange={(e) => setPolicyForm({ ...policyForm, type: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-xs outline-none focus:border-brand-500"
                  >
                    <option value="Individual Health">Individual Health</option>
                    <option value="Family Floater">Family Floater</option>
                    <option value="Critical Illness">Critical Illness</option>
                    <option value="Senior Citizen">Senior Citizen</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Coverage Amount (₹)
                  </label>
                  <input
                    type="number"
                    value={policyForm.coverageAmount}
                    onChange={(e) => setPolicyForm({ ...policyForm, coverageAmount: e.target.value })}
                    required
                    min={10000}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-xs outline-none focus:border-brand-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Annual Premium (₹)
                  </label>
                  <input
                    type="number"
                    value={policyForm.premium}
                    onChange={(e) => setPolicyForm({ ...policyForm, premium: e.target.value })}
                    required
                    min={0}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-xs outline-none focus:border-brand-500"
                  />
                </div>

                <div className="sm:col-span-2 lg:col-span-4 flex justify-end">
                  <button
                    type="submit"
                    disabled={issuingPolicy}
                    className="flex items-center gap-2 rounded-xl bg-brand-600 px-6 py-2.5 text-xs font-bold text-white shadow-md shadow-brand-500/20 transition hover:bg-brand-700 disabled:opacity-60"
                  >
                    <FileCheck2 size={16} />
                    {issuingPolicy ? "Issuing Policy..." : "Issue Policy & Generate SHA-256 Disclosure"}
                  </button>
                </div>
              </form>
            </div>

            {/* Issued Policies List */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="font-display text-base font-bold text-slate-900 mb-3">
                Issued Policies Registry
              </h3>

              {loadingPolicies ? (
                <p className="text-xs text-slate-500 py-4">Loading policies...</p>
              ) : policies.length === 0 ? (
                <p className="text-xs text-slate-500 py-6 text-center">No policies issued yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-semibold">
                        <th className="p-3">Policy Number</th>
                        <th className="p-3">Patient</th>
                        <th className="p-3">Type</th>
                        <th className="p-3">Coverage</th>
                        <th className="p-3">Premium</th>
                        <th className="p-3">Status</th>
                        <th className="p-3">Issue Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {policies.map((p) => (
                        <tr key={p._id} className="hover:bg-slate-50">
                          <td className="p-3 font-mono font-semibold text-brand-900">{p.policyNumber}</td>
                          <td className="p-3 font-semibold text-slate-800">
                            {p.patient?.fullName ? `${p.patient.fullName.firstName} ${p.patient.fullName.lastName}` : "Patient"}
                          </td>
                          <td className="p-3">{p.type}</td>
                          <td className="p-3 font-semibold text-emerald-700">₹{p.coverageAmount?.toLocaleString("en-IN")}</td>
                          <td className="p-3 text-slate-600">₹{p.premium?.toLocaleString("en-IN")}/yr</td>
                          <td className="p-3">
                            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800 uppercase">
                              {p.status}
                            </span>
                          </td>
                          <td className="p-3 text-slate-500">{new Date(p.issueDate).toLocaleDateString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* SHA-256 Disclosure Record Modal */}
            {selectedDisclosure && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
                <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <h3 className="font-display text-base font-bold text-brand-900 flex items-center gap-2">
                      <FileCode size={18} className="text-brand-600" />
                      SHA-256 Cryptographically Signed Disclosure
                    </h3>
                    <button onClick={() => setSelectedDisclosure(null)} className="text-slate-400 hover:text-slate-700">&times;</button>
                  </div>

                  <div className="mt-4 space-y-3 text-xs">
                    <div className="rounded-xl bg-slate-900 p-4 text-emerald-400 font-mono text-[11px] break-all">
                      <p className="text-slate-400 mb-1 text-[10px]">RECORD_HASH (SHA-256):</p>
                      {selectedDisclosure.recordHash}
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-slate-600 pt-2">
                      <div><span className="font-semibold text-slate-800">Consent Version:</span> {selectedDisclosure.consentVersion}</div>
                      <div><span className="font-semibold text-slate-800">Signed Timestamps:</span> {new Date(selectedDisclosure.issuedAt).toLocaleString()}</div>
                      <div><span className="font-semibold text-slate-800">Signed by Patient:</span> ✅ Yes</div>
                      <div><span className="font-semibold text-slate-800">Signed by Insurer:</span> ✅ Yes</div>
                    </div>
                  </div>

                  <div className="mt-6 flex justify-end">
                    <button
                      onClick={() => setSelectedDisclosure(null)}
                      className="rounded-xl bg-brand-600 px-5 py-2 text-xs font-semibold text-white hover:bg-brand-700"
                    >
                      Acknowledge & Close
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 5: Claims Processor */}
        {activeTab === "claims" && (
          <div className="space-y-6">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-display text-lg font-bold text-slate-900">
                  Insurance Claims Processing
                </h2>
                <button onClick={fetchClaims} className="text-xs font-semibold text-brand-600 hover:text-brand-700">
                  Refresh Claims
                </button>
              </div>

              {loadingClaims ? (
                <p className="text-xs text-slate-500 py-6 text-center">Loading claims...</p>
              ) : claims.length === 0 ? (
                <p className="text-xs text-slate-500 py-8 text-center">No claims submitted yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-semibold">
                        <th className="p-3">Claim Number</th>
                        <th className="p-3">Patient</th>
                        <th className="p-3">Hospital & Diagnosis</th>
                        <th className="p-3">Claim Amount</th>
                        <th className="p-3">Approved Amount</th>
                        <th className="p-3">Status</th>
                        <th className="p-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {claims.map((c) => (
                        <tr key={c._id} className="hover:bg-slate-50">
                          <td className="p-3 font-mono font-semibold text-slate-900">{c.claimNumber}</td>
                          <td className="p-3 font-semibold text-slate-800">
                            {c.patient?.fullName ? `${c.patient.fullName.firstName} ${c.patient.fullName.lastName}` : "Patient"}
                          </td>
                          <td className="p-3">
                            <p className="font-semibold text-slate-700">{c.hospitalName}</p>
                            <p className="text-[11px] text-slate-400">{c.diagnosis}</p>
                          </td>
                          <td className="p-3 font-semibold text-slate-900">₹{c.claimAmount?.toLocaleString("en-IN")}</td>
                          <td className="p-3 font-semibold text-emerald-700">
                            {c.approvedAmount ? `₹${c.approvedAmount.toLocaleString("en-IN")}` : "₹0"}
                          </td>
                          <td className="p-3">
                            <span className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase ${
                              c.status === "approved"
                                ? "bg-emerald-100 text-emerald-800"
                                : c.status === "rejected"
                                ? "bg-red-100 text-red-800"
                                : "bg-amber-100 text-amber-800"
                            }`}>
                              {c.status}
                            </span>
                          </td>
                          <td className="p-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => setOpenClaim(c)}
                                className="relative rounded-lg bg-brand-600 px-3 py-1 text-xs font-semibold text-white hover:bg-brand-700"
                              >
                                Open
                                {unreadCounts[c._id] > 0 && (
                                  <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                                    {unreadCounts[c._id]}
                                  </span>
                                )}
                              </button>
                              <button
                                onClick={() => {
                                  setSelectedClaim(c);
                                  setClaimActionForm({
                                    status: c.status,
                                    approvedAmount: c.claimAmount,
                                    rejectionReason: "",
                                    comment: "",
                                  });
                                }}
                                className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200"
                              >
                                Process
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Claim Action Modal */}
            {selectedClaim && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
                <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <h3 className="font-display text-base font-bold text-slate-900">
                      Process Claim {selectedClaim.claimNumber}
                    </h3>
                    <button onClick={() => setSelectedClaim(null)} className="text-slate-400 hover:text-slate-700">&times;</button>
                  </div>

                  <form onSubmit={handleUpdateClaimStatus} className="mt-4 space-y-4 text-xs">
                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Claim Status</label>
                      <select
                        value={claimActionForm.status}
                        onChange={(e) => setClaimActionForm({ ...claimActionForm, status: e.target.value })}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-xs outline-none focus:border-brand-500"
                      >
                        <option value="in_review">Under Review</option>
                        <option value="approved">Approve Claim</option>
                        <option value="rejected">Reject Claim</option>
                        <option value="more_documents_required">Request More Documents</option>
                      </select>
                    </div>

                    {claimActionForm.status === "approved" && (
                      <div>
                        <label className="block font-semibold text-slate-700 mb-1">Approved Settlement Amount (₹)</label>
                        <input
                          type="number"
                          value={claimActionForm.approvedAmount}
                          onChange={(e) => setClaimActionForm({ ...claimActionForm, approvedAmount: e.target.value })}
                          required
                          max={selectedClaim.claimAmount}
                          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:border-brand-500"
                        />
                      </div>
                    )}

                    {claimActionForm.status === "rejected" && (
                      <div>
                        <label className="block font-semibold text-slate-700 mb-1">Rejection Reason</label>
                        <input
                          type="text"
                          value={claimActionForm.rejectionReason}
                          onChange={(e) => setClaimActionForm({ ...claimActionForm, rejectionReason: e.target.value })}
                          required
                          placeholder="e.g. Pre-existing condition excluded from policy coverage"
                          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:border-brand-500"
                        />
                      </div>
                    )}

                    <div>
                      <label className="block font-semibold text-slate-700 mb-1">Review Comment</label>
                      <textarea
                        rows={2}
                        value={claimActionForm.comment}
                        onChange={(e) => setClaimActionForm({ ...claimActionForm, comment: e.target.value })}
                        placeholder="Add review notes..."
                        className="w-full rounded-xl border border-slate-200 p-2.5 text-xs outline-none focus:border-brand-500"
                      />
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setSelectedClaim(null)}
                        className="rounded-xl border border-slate-200 px-4 py-2 font-semibold text-slate-600 hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={updatingClaim}
                        className="rounded-xl bg-brand-600 px-5 py-2 font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                      >
                        {updatingClaim ? "Updating..." : "Save Claim Decision"}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Claim workspace drawer: timeline, messaging, documents, appeal */}
        {openClaim && (
          <ClaimDetailDrawer
            claim={openClaim}
            role="insurance"
            token={token}
            onClose={() => {
              setOpenClaim(null);
              fetchClaims();
            }}
            onClaimUpdated={(updated) => {
              setOpenClaim(updated);
              setClaims((prev) => prev.map((c) => (c._id === updated._id ? updated : c)));
            }}
          />
        )}
      </main>
    </div>
  );
}
