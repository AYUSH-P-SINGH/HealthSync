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
const { profileUpload } = require('../config/upload.config');

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

module.exports = router;
