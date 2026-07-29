/**
 * Hospital routes.
 * All routes prefixed with /api/hospitals (mounted in routes/index.js).
 * Every route requires authentication + hospital role authorization.
 */
const { Router } = require('express');
const hospitalController = require('../controllers/hospital.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const {
  updateHospitalProfileValidator,
  patientQueryValidator,
  listPatientsValidator,
  linkIdValidator,
} = require('../validators/hospital.validator');

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

module.exports = router;
