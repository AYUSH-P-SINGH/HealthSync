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

// ─── Claim Interaction: insurer ↔ patient ──────────────
const {
  sendMessageValidator,
  getMessagesValidator,
  requestDocumentsValidator,
  resolveAppealValidator,
} = require('../validators/claimInteraction.validator');

// Unread message counts across all claims (for badges)
router.get('/claims/unread', insuranceController.getClaimUnreadCounts);

// Fetch a single claim (used to refresh after a live socket event)
router.get('/claims/:claimId', getMessagesValidator, validate, insuranceController.getClaimById);

// Secure messaging thread with the patient, scoped to a claim
router.get('/claims/:claimId/messages', getMessagesValidator, validate, insuranceController.getClaimMessages);
router.post('/claims/:claimId/messages', sendMessageValidator, validate, insuranceController.sendClaimMessage);

// Raise structured document requests on a claim
router.post('/claims/:claimId/document-requests', requestDocumentsValidator, validate, insuranceController.requestClaimDocuments);

// Progress / resolve a patient appeal
router.patch('/claims/:claimId/appeal', resolveAppealValidator, validate, insuranceController.resolveClaimAppeal);

module.exports = router;
