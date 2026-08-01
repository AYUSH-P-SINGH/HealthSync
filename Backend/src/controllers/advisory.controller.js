/**
 * Health advisory controller.
 * `getActive` serves patients/hospitals; the rest are admin-only.
 */
const advisoryService = require('../services/advisory.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

/** GET /api/advisories/active — advisories + WHO alerts + daily tips */
const getActive = asyncHandler(async (req, res) => {
  const result = await advisoryService.getActive();
  const response = ApiResponse.ok(result);
  res.status(response.statusCode).json(response);
});

/** POST /api/advisories (admin) */
const createAdvisory = asyncHandler(async (req, res) => {
  const result = await advisoryService.createAdvisory(
    req.user.id,
    req.body,
    req.ip,
    req.headers['user-agent']
  );
  const response = ApiResponse.created(result.advisory, result.message);
  res.status(response.statusCode).json(response);
});

/** GET /api/advisories (admin — includes inactive) */
const listAll = asyncHandler(async (req, res) => {
  const result = await advisoryService.listAll();
  const response = ApiResponse.ok(result);
  res.status(response.statusCode).json(response);
});

/** PATCH /api/advisories/:advisoryId (admin) */
const updateAdvisory = asyncHandler(async (req, res) => {
  const result = await advisoryService.updateAdvisory(
    req.user.id,
    req.params.advisoryId,
    req.body,
    req.ip,
    req.headers['user-agent']
  );
  const response = ApiResponse.ok(result.advisory, result.message);
  res.status(response.statusCode).json(response);
});

/** DELETE /api/advisories/:advisoryId (admin) */
const deleteAdvisory = asyncHandler(async (req, res) => {
  const result = await advisoryService.deleteAdvisory(
    req.user.id,
    req.params.advisoryId,
    req.ip,
    req.headers['user-agent']
  );
  const response = ApiResponse.ok(null, result.message);
  res.status(response.statusCode).json(response);
});

module.exports = { getActive, createAdvisory, listAll, updateAdvisory, deleteAdvisory };
