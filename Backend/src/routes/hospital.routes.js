/**
 * Hospital routes.
 * All routes prefixed with /api/hospitals (mounted in routes/index.js).
 * Every route requires authentication + hospital role authorization.
 */
const { Router } = require('express');
const hospitalController = require('../controllers/hospital.controller');
const recordController = require('../controllers/record.controller');
const consentController = require('../controllers/consent.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const {
  updateHospitalProfileValidator,
  patientQueryValidator,
  listPatientsValidator,
  linkIdValidator,
} = require('../validators/hospital.validator');
const {
  linkRecordValidator,
  linkRecordsListValidator,
} = require('../validators/record.validator');
const {
  claimConsentValidator,
  consentRecordsValidator,
} = require('../validators/consent.validator');

const router = Router();

// All hospital routes require authentication and hospital role
router.use(authenticate, authorize('hospital'));

// ─── Profile ───────────────────────────────────────────

// Get full hospital profile
router.get('/profile', hospitalController.getProfile);

// Update hospital profile
router.patch(
  '/profile',
  updateHospitalProfileValidator,
  validate,
  hospitalController.updateProfile
);

// ─── Dashboard ─────────────────────────────────────────

// Get dashboard summary (profile completeness, counts)
router.get('/dashboard', hospitalController.getDashboardSummary);

// ─── Patient linking (consent-based) ───────────────────

// Look up a patient by Patient ID / email (minimal, masked info)
router.post('/patients/lookup', patientQueryValidator, validate, hospitalController.lookupPatient);

// Send a link request (patient must approve from their account)
router.post('/patients', patientQueryValidator, validate, hospitalController.addPatient);

// List this hospital's patient links (optionally filtered by status)
router.get('/patients', listPatientsValidator, validate, hospitalController.listPatients);

// Discharge an active patient / withdraw a pending request
router.patch(
  '/patients/:linkId/discharge',
  linkIdValidator,
  validate,
  hospitalController.dischargePatient
);

// ─── Medical records (active link required) ────────────

// Create a record for a linked patient (prescriptions run safety checks)
router.post(
  '/patients/:linkId/records',
  linkRecordValidator,
  validate,
  recordController.createRecordForPatient
);

// List records this hospital created for a linked patient
router.get(
  '/patients/:linkId/records',
  linkRecordsListValidator,
  validate,
  recordController.listRecordsForPatient
);

// ─── Consent grants (time-bound OTP/QR access) ─────────

// Redeem a patient's access code (plain code or scanned QR payload)
router.post('/consents/claim', claimConsentValidator, validate, consentController.claimConsent);

// List grants claimed by this hospital
router.get('/consents', consentController.listHospitalConsents);

// Read records through a still-valid grant (scope + expiry enforced)
router.get(
  '/consents/:consentId/records',
  consentRecordsValidator,
  validate,
  consentController.getConsentRecords
);

module.exports = router;
