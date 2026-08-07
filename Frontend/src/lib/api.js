const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

// Origin of the backend (no /api suffix) — used to resolve statically served
// files such as profile pictures (Backend/src/app.js serves /uploads).
export const API_ORIGIN = BASE_URL.replace(/\/api\/?$/, "");

/**
 * Thin fetch wrapper for the HealthSync API.
 * - Attaches the access token (if present) as a Bearer token.
 * - Sends cookies (`credentials: "include"`) so the HttpOnly refresh-token
 *   cookie set by /auth/login and /auth/refresh is included automatically.
 * - Always parses JSON and throws an Error with the backend's message on
 *   failure, so callers can just try/catch and show err.message.
 *
 * Backend responses are wrapped as { success, statusCode, message, data }
 * on success, or { success: false, message, errors: [{field, message}] }
 * on failure (see Backend/src/utils/ApiResponse.js and ApiError.js).
 */
async function request(path, { method = "GET", body, formData, token } = {}) {
  // For multipart uploads (formData) the browser must set the Content-Type
  // (with boundary) itself, so we only set it for JSON bodies.
  const headers = {};
  if (!formData) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      credentials: "include",
      body: formData || (body ? JSON.stringify(body) : undefined),
    });
  } catch {
    throw new Error("Could not reach the server. Please check your connection and try again.");
  }

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    // non-JSON response body, fall through with payload = null
  }

  if (!res.ok || payload?.success === false) {
    const firstFieldError = payload?.errors?.[0]?.message || payload?.errors?.[0];
    const message = firstFieldError || payload?.message || `Request failed with status ${res.status}`;
    throw new Error(message);
  }

  return payload;
}

/** Build a query string from an object, skipping empty values. */
function qs(params = {}) {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null && v !== ""
  );
  if (entries.length === 0) return "";
  return `?${entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&")}`;
}

export const authApi = {
  // Patient registration lives at the plain /register endpoint (the
  // teammate's original patient-only route); hospital gets its own path.
  registerPatient: (payload) => request("/auth/register", { method: "POST", body: payload }),
  registerHospital: (payload) => request("/auth/register/hospital", { method: "POST", body: payload }),
  registerInsurance: (payload) => request("/auth/register/insurance", { method: "POST", body: payload }),
  // `role` must be 'user' (patient) or 'hospital'.
  login: (payload) => request("/auth/login", { method: "POST", body: payload }),
  verifyEmail: (token) => request("/auth/verify-email", { method: "POST", body: { token } }),
  resendVerification: (email) => request("/auth/resend-verification", { method: "POST", body: { email } }),
  refresh: () => request("/auth/refresh", { method: "POST" }),
  logout: (token) => request("/auth/logout", { method: "POST", token }),
  me: (token) => request("/auth/me", { token }),
};

/**
 * Patient endpoints (Backend/src/routes/patient.routes.js).
 * All require a patient ('user' role) access token.
 */
export const patientApi = {
  getProfile: (token) => request("/patients/profile", { token }),
  updateProfile: (payload, token) =>
    request("/patients/profile", { method: "PATCH", body: payload, token }),
  getDashboard: (token) => request("/patients/dashboard", { token }),
  uploadProfilePicture: (file, token) => {
    const formData = new FormData();
    formData.append("profilePicture", file);
    return request("/patients/profile/picture", { method: "POST", formData, token });
  },
  deleteProfilePicture: (token) =>
    request("/patients/profile/picture", { method: "DELETE", token }),

  // ─── Hospital linking (consent) ───
  listHospitalLinks: (token, status) =>
    request(`/patients/hospitals${status ? `?status=${status}` : ""}`, { token }),
  respondToHospitalRequest: (linkId, action, token) =>
    request(`/patients/hospitals/${linkId}/respond`, { method: "PATCH", body: { action }, token }),
  revokeHospitalLink: (linkId, token) =>
    request(`/patients/hospitals/${linkId}/revoke`, { method: "PATCH", token }),


  // ─── Insurance & Claims (consent) ───
  listInsuranceRequests: (token) =>
    request("/patients/insurance-requests", { token }),
  respondToInsuranceRequest: (linkId, payload, token) =>
    request(`/patients/insurance-requests/${linkId}/respond`, { method: "PATCH", body: payload, token }),
  revokeInsuranceConsent: (linkId, token) =>
    request(`/patients/insurance-requests/${linkId}/revoke`, { method: "PATCH", token }),
  listPolicies: (token) =>
    request("/patients/policies", { token }),
  submitClaim: (payload, token) =>
    request("/patients/claims", { method: "POST", body: payload, token }),
  listClaims: (token) =>
    request("/patients/claims", { token }),

  // ─── Claim interaction (messaging, documents, appeals) ───
  getClaimUnreadCounts: (token) =>
    request("/patients/claims/unread", { token }),
  getClaim: (claimId, token) =>
    request(`/patients/claims/${claimId}`, { token }),
  getClaimMessages: (claimId, token) =>
    request(`/patients/claims/${claimId}/messages`, { token }),
  sendClaimMessage: (claimId, payload, token) =>
    request(`/patients/claims/${claimId}/messages`, { method: "POST", body: payload, token }),
  fulfillClaimDocument: (claimId, requestId, payload, token) =>
    request(`/patients/claims/${claimId}/documents/${requestId}`, { method: "POST", body: payload, token }),
  appealClaim: (claimId, reason, token) =>
    request(`/patients/claims/${claimId}/appeal`, { method: "POST", body: { reason }, token }),

  // ─── Medical records & timeline ───
  // filters: { type, hospitalId ('self' = self-reported), condition, from, to, q }
  listRecords: (token, filters) => request(`/patients/records${qs(filters)}`, { token }),
  createRecord: (payload, token) =>
    request("/patients/records", { method: "POST", body: payload, token }),
  getTimeline: (token, filters) => request(`/patients/timeline${qs(filters)}`, { token }),
  updateRecord: (recordId, payload, token) =>
    request(`/patients/records/${recordId}`, { method: "PATCH", body: payload, token }),
  deleteRecord: (recordId, token) =>
    request(`/patients/records/${recordId}`, { method: "DELETE", token }),
  setPrescriptionStatus: (recordId, active, token) =>
    request(`/patients/records/${recordId}/prescription`, {
      method: "PATCH",
      body: { active },
      token,
    }),

  // ─── Consent grants (time-bound OTP/QR access) ───
  issueConsent: (payload, token) =>
    request("/patients/consents", { method: "POST", body: payload, token }),
  listConsents: (token) => request("/patients/consents", { token }),
  revokeConsent: (consentId, token) =>
    request(`/patients/consents/${consentId}/revoke`, { method: "PATCH", token }),

  // ─── Follow-up obligations (clinical loop closure) ───
  // filters: { status: 'active'|'open'|'overdue'|'pending_confirm', includeResolved }
  listFollowUps: (token, filters) => request(`/patients/followups${qs(filters)}`, { token }),

  /**
   * Scan one or more reports for follow-up recommendations.
   *
   * `files` may be a single File or an array (a folder of page images). They
   * are appended in the order given, and the server re-sorts by filename
   * naturally, so page10 never lands before page2.
   *
   * `dryRun` previews the extraction without storing anything, so the patient
   * sees what we found before it becomes a tracked obligation.
   */
  scanReport: ({ file, files, text, recordDate, sourceRecordId, dryRun }, token) => {
    const list = files?.length ? files : file ? [file] : [];

    if (list.length) {
      const formData = new FormData();
      // Same field name for every file — the server takes `report` as an array.
      list.forEach((f) => formData.append("report", f, f.name));
      if (recordDate) formData.append("recordDate", recordDate);
      if (sourceRecordId) formData.append("sourceRecordId", sourceRecordId);
      if (dryRun) formData.append("dryRun", "true");
      return request("/patients/followups/scan", { method: "POST", formData, token });
    }
    return request("/patients/followups/scan", {
      method: "POST",
      body: { text, recordDate, sourceRecordId, dryRun },
      token,
    });
  },

  confirmFollowUp: (followUpId, dueAt, token) =>
    request(`/patients/followups/${followUpId}/confirm`, {
      method: "PATCH",
      body: { dueAt },
      token,
    }),
  scheduleFollowUp: (followUpId, scheduledFor, token) =>
    request(`/patients/followups/${followUpId}/schedule`, {
      method: "PATCH",
      body: { scheduledFor },
      token,
    }),
  completeFollowUp: (followUpId, token) =>
    request(`/patients/followups/${followUpId}/complete`, { method: "PATCH", token }),
  dismissFollowUp: (followUpId, reason, token) =>
    request(`/patients/followups/${followUpId}/dismiss`, {
      method: "PATCH",
      body: { reason },
      token,
    }),

  // Development-only demo helper — fast-forwards the caller's own follow-up
  // clock so the escalation ladder can be shown without waiting months.
  advanceFollowUpClock: (days, token) =>
    request("/dev/followups/advance-clock", { method: "POST", body: { days }, token }),
};

/**
 * Hospital endpoints (Backend/src/routes/hospital.routes.js).
 * All require a hospital-role access token.
 */
export const hospitalApi = {
  getProfile: (token) => request("/hospitals/profile", { token }),
  updateProfile: (payload, token) =>
    request("/hospitals/profile", { method: "PATCH", body: payload, token }),
  getDashboard: (token) => request("/hospitals/dashboard", { token }),

  // ─── Patient linking (consent-based) ───
  // `query` is a Patient ID (HS-XXXXXXXX) or email the patient shared.
  lookupPatient: (query, token) =>
    request("/hospitals/patients/lookup", { method: "POST", body: { query }, token }),
  addPatient: (query, token) =>
    request("/hospitals/patients", { method: "POST", body: { query }, token }),
  listPatients: (token, status) =>
    request(`/hospitals/patients${status ? `?status=${status}` : ""}`, { token }),
  dischargePatient: (linkId, token) =>
    request(`/hospitals/patients/${linkId}/discharge`, { method: "PATCH", token }),

  // ─── Medical records (active link required) ───
  createPatientRecord: (linkId, payload, token) =>
    request(`/hospitals/patients/${linkId}/records`, { method: "POST", body: payload, token }),
  listPatientRecords: (linkId, token, filters) =>
    request(`/hospitals/patients/${linkId}/records${qs(filters)}`, { token }),

  // ─── Consent grants (claim a patient's OTP/QR code) ───
  claimConsent: (code, token) =>
    request("/hospitals/consents/claim", { method: "POST", body: { code }, token }),
  listConsents: (token) => request("/hospitals/consents", { token }),
  getConsentRecords: (consentId, token, type) =>
    request(`/hospitals/consents/${consentId}/records${qs({ type })}`, { token }),

  // ─── Follow-up safety net ───
  // Overdue follow-ups for this patient from ANY hospital. Requires exactly
  // one access basis: an active link, or a claimed consent grant.
  listPatientFollowUps: (token, { linkId, consentId }) =>
    request(`/hospitals/followups${qs({ linkId, consentId })}`, { token }),

  // action: 'schedule' | 'complete' | 'dismiss' (dismiss requires a reason)
  actOnFollowUp: (followUpId, payload, token) =>
    request(`/hospitals/followups/${followUpId}`, { method: "PATCH", body: payload, token }),

  scanPatientReport: (linkId, { file, files, text, recordDate, dryRun }, token) => {
    const list = files?.length ? files : file ? [file] : [];

    if (list.length) {
      const formData = new FormData();
      list.forEach((f) => formData.append("report", f, f.name));
      if (recordDate) formData.append("recordDate", recordDate);
      if (dryRun) formData.append("dryRun", "true");
      return request(`/hospitals/patients/${linkId}/followups/scan`, {
        method: "POST",
        formData,
        token,
      });
    }
    return request(`/hospitals/patients/${linkId}/followups/scan`, {
      method: "POST",
      body: { text, recordDate, dryRun },
      token,
    });
  },
};

/**
 * Health advisories (Backend/src/routes/advisory.routes.js).
 * `getActive` works for any signed-in role; the rest are admin-only.
 */
export const advisoryApi = {
  getActive: (token) => request("/advisories/active", { token }),
  list: (token) => request("/advisories", { token }),
  create: (payload, token) => request("/advisories", { method: "POST", body: payload, token }),
  update: (advisoryId, payload, token) =>
    request(`/advisories/${advisoryId}`, { method: "PATCH", body: payload, token }),
  remove: (advisoryId, token) =>
    request(`/advisories/${advisoryId}`, { method: "DELETE", token }),
};

/**
 * Insurance company endpoints (Backend/src/routes/insurance.routes.js).
 * All require an insurance-role access token.
 */
export const insuranceApi = {
  getProfile: (token) => request("/insurance/profile", { token }),
  getDashboard: (token) => request("/insurance/dashboard", { token }),
  searchPatient: (healthSyncId, token) =>
    request(`/insurance/search/${healthSyncId}`, { token }),
  requestAccess: (payload, token) =>
    request("/insurance/request-access", { method: "POST", body: payload, token }),
  listPatients: (token, status) =>
    request(`/insurance/patients${status ? `?status=${status}` : ""}`, { token }),
  getPatientRecords: (patientId, token) =>
    request(`/insurance/patient/${patientId}/records`, { token }),
  issuePolicy: (payload, token) =>
    request("/insurance/policy", { method: "POST", body: payload, token }),
  listPolicies: (token) => request("/insurance/policies", { token }),
  listClaims: (token) => request("/insurance/claims", { token }),
  updateClaimStatus: (claimId, payload, token) =>
    request(`/insurance/claims/${claimId}/status`, { method: "PATCH", body: payload, token }),

  // ─── Claim interaction (messaging, documents, appeals) ───
  getClaimUnreadCounts: (token) =>
    request("/insurance/claims/unread", { token }),
  getClaim: (claimId, token) =>
    request(`/insurance/claims/${claimId}`, { token }),
  getClaimMessages: (claimId, token) =>
    request(`/insurance/claims/${claimId}/messages`, { token }),
  sendClaimMessage: (claimId, payload, token) =>
    request(`/insurance/claims/${claimId}/messages`, { method: "POST", body: payload, token }),
  requestClaimDocuments: (claimId, items, token) =>
    request(`/insurance/claims/${claimId}/document-requests`, { method: "POST", body: { items }, token }),
  resolveClaimAppeal: (claimId, payload, token) =>
    request(`/insurance/claims/${claimId}/appeal`, { method: "PATCH", body: payload, token }),
};
