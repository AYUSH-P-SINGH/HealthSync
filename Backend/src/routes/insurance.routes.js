const { Router } = require('express');
const insuranceController = require('../controllers/insurance.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const {
  searchPatientValidator,
  requestAccessValidator,
  issuePolicyValidator,
  updateClaimValidator,
} = require('../validators/insurance.validator');

const router = Router();

// All insurance routes require authentication and insurance role authorization
router.use(authenticate, authorize('insurance'));

// Profile & Dashboard
router.get('/profile', insuranceController.getProfile);
router.get('/dashboard', insuranceController.getDashboardSummary);

// Search patient by HealthSync ID
router.get('/search/:healthSyncId', searchPatientValidator, validate, insuranceController.searchPatient);

// Request access to patient records
router.post('/request-access', requestAccessValidator, validate, insuranceController.requestAccess);

// List patient connections (pending vs approved)
router.get('/patients', insuranceController.listPatients);

// Get permission-scoped patient medical records
router.get('/patient/:id/records', insuranceController.getPatientRecords);

// Policy issuance with SHA-256 Disclosure hash
router.post('/policy', issuePolicyValidator, validate, insuranceController.issuePolicy);
router.get('/policies', insuranceController.listPolicies);

// Claims processing
router.get('/claims', insuranceController.listClaims);
router.patch('/claims/:claimId/status', updateClaimValidator, validate, insuranceController.updateClaimStatus);

module.exports = router;
