/**
 * Hospital controller.
 * Handles HTTP concerns for hospital profile management.
 * Delegates all business logic to hospital.service.
 */
const hospitalService = require('../services/hospital.service');
const patientLinkService = require('../services/patientLink.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

/**
 * GET /api/hospitals/profile
 */
const getProfile = asyncHandler(async (req, res) => {
  const result = await hospitalService.getProfile(req.user.id);

  const response = ApiResponse.ok(result.hospital);
  res.status(response.statusCode).json(response);
});

/**
 * PATCH /api/hospitals/profile
 */
const updateProfile = asyncHandler(async (req, res) => {
  const result = await hospitalService.updateProfile(
    req.user.id,
    req.body,
    req.ip,
    req.headers['user-agent']
  );

  const response = ApiResponse.ok(result.hospital, result.message);
  res.status(response.statusCode).json(response);
});

/**
 * GET /api/hospitals/dashboard
 */
const getDashboardSummary = asyncHandler(async (req, res) => {
  const result = await hospitalService.getDashboardSummary(req.user.id);

  const response = ApiResponse.ok(result);
  res.status(response.statusCode).json(response);
});

// ─── Patient linking ───────────────────────────────────

/**
 * POST /api/hospitals/patients/lookup
 */
const lookupPatient = asyncHandler(async (req, res) => {
  const result = await patientLinkService.lookupPatient(
    req.user.id,
    req.body.query,
    req.ip,
    req.headers['user-agent']
  );

  const response = ApiResponse.ok(result);
  res.status(response.statusCode).json(response);
});

/**
 * POST /api/hospitals/patients
 */
const addPatient = asyncHandler(async (req, res) => {
  const result = await patientLinkService.requestLink(
    req.user.id,
    req.body.query,
    req.ip,
    req.headers['user-agent']
  );

  const response = ApiResponse.created(result.link, result.message);
  res.status(response.statusCode).json(response);
});

/**
 * GET /api/hospitals/patients?status=
 */
const listPatients = asyncHandler(async (req, res) => {
  const result = await patientLinkService.listHospitalPatients(req.user.id, req.query.status);

  const response = ApiResponse.ok(result);
  res.status(response.statusCode).json(response);
});

/**
 * PATCH /api/hospitals/patients/:linkId/discharge
 */
const dischargePatient = asyncHandler(async (req, res) => {
  const result = await patientLinkService.dischargePatient(
    req.user.id,
    req.params.linkId,
    req.ip,
    req.headers['user-agent']
  );

  const response = ApiResponse.ok(result.link, result.message);
  res.status(response.statusCode).json(response);
});

module.exports = {
  getProfile,
  updateProfile,
  getDashboardSummary,
  lookupPatient,
  addPatient,
  listPatients,
  dischargePatient,
};
