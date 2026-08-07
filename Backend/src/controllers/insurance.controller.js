const insuranceService = require('../services/insurance.service');
const authService = require('../services/auth.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

/**
 * GET /api/insurance/profile
 */
const getProfile = asyncHandler(async (req, res) => {
  const result = await authService.getCurrentUser(req.user.id, req.user.role);
  res.status(200).json(ApiResponse.success(result.user, 'Insurance profile retrieved successfully.'));
});

/**
 * GET /api/insurance/dashboard
 */
const getDashboardSummary = asyncHandler(async (req, res) => {
  const insuranceId = req.user.id || req.user._id;
  const userResult = await authService.getCurrentUser(insuranceId, req.user.role);

  const [pendingRequests, approvedPatients, policies, claims] = await Promise.all([
    insuranceService.getInsurancePatients(insuranceId, 'pending'),
    insuranceService.getInsurancePatients(insuranceId, 'approved'),
    insuranceService.getPolicies({ insurance: insuranceId }),
    insuranceService.getClaims({ insurance: insuranceId }),
  ]);

  res.status(200).json(
    ApiResponse.success(
      {
        pendingRequestsCount: pendingRequests.length,
        approvedPatientsCount: approvedPatients.length,
        activePoliciesCount: policies.filter((p) => p.status === 'active').length,
        pendingClaimsCount: claims.filter((c) => c.status === 'submitted' || c.status === 'in_review').length,
        insurance: userResult.user,
      },
      'Dashboard summary retrieved successfully.'
    )
  );
});

/**
 * GET /api/insurance/search/:healthSyncId
 */
const searchPatient = asyncHandler(async (req, res) => {
  const { healthSyncId } = req.params;
  const result = await insuranceService.searchPatientByHealthSyncId(healthSyncId);
  res.status(200).json(ApiResponse.success(result, 'Patient lookup successful.'));
});

/**
 * POST /api/insurance/request-access
 */
const requestAccess = asyncHandler(async (req, res) => {
  const insuranceId = req.user.id || req.user._id;
  const result = await insuranceService.requestAccess(insuranceId, req.body);
  res.status(201).json(ApiResponse.created(result, 'Access request sent to patient successfully.'));
});

/**
 * GET /api/insurance/patients
 */
const listPatients = asyncHandler(async (req, res) => {
  const insuranceId = req.user.id || req.user._id;
  const { status } = req.query;
  const result = await insuranceService.getInsurancePatients(insuranceId, status);
  res.status(200).json(ApiResponse.success(result, 'Patient list retrieved successfully.'));
});

/**
 * GET /api/insurance/patient/:id/records
 */
const getPatientRecords = asyncHandler(async (req, res) => {
  const insuranceId = req.user.id || req.user._id;
  const patientId = req.params.id;
  const records = await insuranceService.getPatientScopedRecords(insuranceId, patientId);
  res.status(200).json(ApiResponse.success(records, 'Scoped patient records retrieved successfully.'));
});

/**
 * POST /api/insurance/policy
 */
const issuePolicy = asyncHandler(async (req, res) => {
  const insuranceId = req.user.id || req.user._id;
  const result = await insuranceService.issuePolicy(insuranceId, req.body);
  res.status(201).json(ApiResponse.created(result, 'Policy issued and disclosure hash generated successfully.'));
});

/**
 * GET /api/insurance/policies
 */
const listPolicies = asyncHandler(async (req, res) => {
  const insuranceId = req.user.id || req.user._id;
  const policies = await insuranceService.getPolicies({ insurance: insuranceId });
  res.status(200).json(ApiResponse.success(policies, 'Insurance policies retrieved successfully.'));
});

/**
 * GET /api/insurance/claims
 */
const listClaims = asyncHandler(async (req, res) => {
  const insuranceId = req.user.id || req.user._id;
  const claims = await insuranceService.getClaims({ insurance: insuranceId });
  res.status(200).json(ApiResponse.success(claims, 'Insurance claims retrieved successfully.'));
});

/**
 * PATCH /api/insurance/claims/:claimId/status
 */
const updateClaimStatus = asyncHandler(async (req, res) => {
  const insuranceId = req.user.id || req.user._id;
  const { claimId } = req.params;
  const result = await insuranceService.updateClaimStatus(insuranceId, claimId, req.body);
  res.status(200).json(ApiResponse.success(result, 'Claim status updated successfully.'));
});

// ─── Claim Interaction (messaging, documents, appeals) ──

const claimInteractionService = require('../services/claimInteraction.service');

/**
 * GET /api/insurance/claims/:claimId
 * Fetch a single claim — used by the frontend to re-pull fresh state
 * after a real-time `claim:updated` socket event.
 */
const getClaimById = asyncHandler(async (req, res) => {
  const result = await claimInteractionService.getClaimById('insurance', req.user.id, req.params.claimId);
  res.status(200).json(ApiResponse.success(result, 'Claim retrieved successfully.'));
});

/**
 * GET /api/insurance/claims/unread
 */
const getClaimUnreadCounts = asyncHandler(async (req, res) => {
  const result = await claimInteractionService.getUnreadCounts('insurance', req.user.id);
  res.status(200).json(ApiResponse.success(result, 'Unread message counts retrieved.'));
});

/**
 * GET /api/insurance/claims/:claimId/messages
 */
const getClaimMessages = asyncHandler(async (req, res) => {
  const { messages } = await claimInteractionService.getMessages('insurance', req.user.id, req.params.claimId);
  res.status(200).json(ApiResponse.success(messages, 'Claim messages retrieved.'));
});

/**
 * POST /api/insurance/claims/:claimId/messages
 */
const sendClaimMessage = asyncHandler(async (req, res) => {
  const result = await claimInteractionService.sendMessage('insurance', req.user.id, req.params.claimId, req.body);
  res.status(201).json(ApiResponse.created(result, 'Message sent to patient.'));
});

/**
 * POST /api/insurance/claims/:claimId/document-requests
 */
const requestClaimDocuments = asyncHandler(async (req, res) => {
  const result = await claimInteractionService.requestDocuments(req.user.id, req.params.claimId, req.body.items);
  res.status(200).json(ApiResponse.success(result, 'Document request sent to patient.'));
});

/**
 * PATCH /api/insurance/claims/:claimId/appeal
 */
const resolveClaimAppeal = asyncHandler(async (req, res) => {
  const result = await claimInteractionService.resolveAppeal(req.user.id, req.params.claimId, req.body);
  res.status(200).json(ApiResponse.success(result, 'Appeal updated successfully.'));
});

module.exports = {
  getProfile,
  getDashboardSummary,
  searchPatient,
  requestAccess,
  listPatients,
  getPatientRecords,
  issuePolicy,
  listPolicies,
  listClaims,
  updateClaimStatus,
  getClaimById,
  getClaimUnreadCounts,
  getClaimMessages,
  sendClaimMessage,
  requestClaimDocuments,
  resolveClaimAppeal,
};
