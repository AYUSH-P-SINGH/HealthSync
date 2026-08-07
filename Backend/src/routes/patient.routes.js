/**
 * Patient routes.
 * All routes prefixed with /api/patients (mounted in routes/index.js).
 * Every route requires authentication + user role authorization.
 */
const { Router } = require('express');
const patientController = require('../controllers/patient.controller');
const recordController = require('../controllers/record.controller');
const consentController = require('../controllers/consent.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const {
  updateProfileValidator,
  listHospitalLinksValidator,
  respondValidator,
  revokeValidator,
} = require('../validators/patient.validator');
const {
  recordBodyValidator,
  listRecordsValidator,
  recordIdValidator,
  updateRecordValidator,
  prescriptionStatusValidator,
} = require('../validators/record.validator');
const {
  issueConsentValidator,
  consentIdValidator,
} = require('../validators/consent.validator');
const followupController = require('../controllers/followup.controller');
const {
  followUpIdValidator,
  scanValidator,
  listFollowUpsValidator,
  confirmValidator,
  scheduleValidator,
  dismissValidator,
} = require('../validators/followup.validator');
const { profileUpload } = require('../config/upload.config');
const { reportUpload, handleUploadError } = require('../config/reportUpload.config');
const { reportScanLimiter } = require('../middleware/rateLimiter');

const router = Router();

// All patient routes require authentication and user role
router.use(authenticate, authorize('user'));

// ─── Profile ───────────────────────────────────────────

// Get full patient profile
router.get('/profile', patientController.getProfile);

// Update patient profile
router.patch(
  '/profile',
  updateProfileValidator,
  validate,
  patientController.updateProfile
);

// Upload profile picture
router.post(
  '/profile/picture',
  profileUpload.single('profilePicture'),
  patientController.uploadProfilePicture
);

// Delete profile picture
router.delete('/profile/picture', patientController.deleteProfilePicture);

// ─── Dashboard ─────────────────────────────────────────

// Get dashboard summary (profile completeness, counts)
router.get('/dashboard', patientController.getDashboardSummary);

// ─── Hospital linking (consent) ────────────────────────

// List my hospital links (pending = requests awaiting my approval)
router.get('/hospitals', listHospitalLinksValidator, validate, patientController.listHospitalLinks);

// Approve / reject a pending hospital request
router.patch(
  '/hospitals/:linkId/respond',
  respondValidator,
  validate,
  patientController.respondToHospitalRequest
);

// Revoke an active hospital link
router.patch(
  '/hospitals/:linkId/revoke',
  revokeValidator,
  validate,
  patientController.revokeHospitalLink
);

// ─── Insurance linking (consent) ───────────────────────

// List my insurance requests (pending, approved, rejected, revoked)
router.get('/insurance-requests', patientController.listInsuranceRequests);

// Approve / reject an incoming insurance access request
router.patch('/insurance-requests/:linkId/respond', patientController.respondToInsuranceRequest);

// Revoke active consent for an insurance organization
router.patch('/insurance-requests/:linkId/revoke', patientController.revokeInsuranceConsent);

// ─── Insurance Policies & Claims ───────────────────────

// List patient's issued insurance policies & disclosure records
router.get('/policies', patientController.listPatientPolicies);

// Submit and track insurance claims
const { submitClaimValidator } = require('../validators/insurance.validator');
router.post('/claims', submitClaimValidator, validate, patientController.submitPatientClaim);
router.get('/claims', patientController.listPatientClaims);

// ─── Claim Interaction: patient ↔ insurer ──────────────
const {
  sendMessageValidator,
  getMessagesValidator,
  fulfillDocumentValidator,
  fileAppealValidator,
} = require('../validators/claimInteraction.validator');

// Unread message counts across all my claims (for badges)
router.get('/claims/unread', patientController.getClaimUnreadCounts);

// Fetch a single claim (used to refresh after a live socket event)
router.get('/claims/:claimId', getMessagesValidator, validate, patientController.getClaimById);

// Secure messaging thread with the insurer, scoped to a claim
router.get('/claims/:claimId/messages', getMessagesValidator, validate, patientController.getClaimMessages);
router.post('/claims/:claimId/messages', sendMessageValidator, validate, patientController.sendClaimMessage);

// Upload a document against a specific insurer request
router.post('/claims/:claimId/documents/:requestId', fulfillDocumentValidator, validate, patientController.fulfillClaimDocument);

// File a formal appeal against a claim decision
router.post('/claims/:claimId/appeal', fileAppealValidator, validate, patientController.appealClaim);

// ─── Medical records ───────────────────────────────────

// List my records (filters: type, hospitalId, condition, from, to, q)
router.get('/records', listRecordsValidator, validate, recordController.listMyRecords);

// Add a self-reported record
router.post('/records', recordBodyValidator, validate, recordController.createMyRecord);

// Chronological health timeline (grouped by month, with filter facets)
router.get('/timeline', listRecordsValidator, validate, recordController.getMyTimeline);

// Edit / delete one of my self-reported records
router.patch('/records/:recordId', updateRecordValidator, validate, recordController.updateMyRecord);
router.delete('/records/:recordId', recordIdValidator, validate, recordController.deleteMyRecord);

// Mark a prescription as active / completed
router.patch(
  '/records/:recordId/prescription',
  prescriptionStatusValidator,
  validate,
  recordController.setPrescriptionStatus
);

// Dedicated medication cabinet & active interaction warnings
router.get('/medications', recordController.getMedicationCabinet);


// ─── Consent grants (time-bound OTP/QR access) ─────────

// Issue a scoped, time-bound access code
router.post('/consents', issueConsentValidator, validate, consentController.issueConsent);

// List my consent grants (with usage + status)
router.get('/consents', consentController.listMyConsents);

// Revoke a grant early
router.patch(
  '/consents/:consentId/revoke',
  consentIdValidator,
  validate,
  consentController.revokeConsent
);

// ─── Follow-up obligations (clinical loop closure) ─────
//
// A follow-up is a promise a report made about the future ("repeat CT in 6
// months"). These endpoints let the patient see, confirm and resolve those
// promises — the hospital-side safety net lives in hospital.routes.js.

// List my follow-ups (?status=active|open|overdue|... , ?includeResolved=true)
router.get(
  '/followups',
  listFollowUpsValidator,
  validate,
  followupController.listMyFollowUps
);

// Scan one or more reports for follow-up recommendations.
// Accepts multipart `report` (a single PDF/image, or a whole folder of page
// images) or JSON `text`. Rate-limited per user because this decodes binaries
// and runs OCR.
router.post(
  '/followups/scan',
  reportScanLimiter,
  reportUpload.array('report'),
  handleUploadError,
  scanValidator,
  validate,
  followupController.scanMyReport
);

// Promote a low-confidence extraction into a tracked obligation
router.patch(
  '/followups/:followUpId/confirm',
  confirmValidator,
  validate,
  followupController.confirmFollowUp
);

// Mark as booked / done
router.patch(
  '/followups/:followUpId/schedule',
  scheduleValidator,
  validate,
  followupController.scheduleFollowUp
);
router.patch(
  '/followups/:followUpId/complete',
  followUpIdValidator,
  validate,
  followupController.completeFollowUp
);

// Dismiss — reason is mandatory and recorded against the actor
router.patch(
  '/followups/:followUpId/dismiss',
  dismissValidator,
  validate,
  followupController.dismissFollowUp
);

module.exports = router;
