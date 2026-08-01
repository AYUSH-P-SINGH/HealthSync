/**
 * Medical record controller.
 * Patient-side + hospital-side HTTP handlers; logic lives in record.service.
 */
const recordService = require('../services/record.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

const filtersFrom = (query) => ({
  type: query.type,
  hospitalId: query.hospitalId,
  condition: query.condition,
  from: query.from,
  to: query.to,
  q: query.q,
});

// ─── Patient side ──────────────────────────────────────

/** POST /api/patients/records — self-reported record */
const createMyRecord = asyncHandler(async (req, res) => {
  const result = await recordService.createRecord({
    patientId: req.user.id,
    hospitalId: null,
    createdByRole: 'patient',
    body: req.body,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    actorId: req.user.id,
  });

  const response = ApiResponse.created(result, result.message);
  res.status(response.statusCode).json(response);
});

/** GET /api/patients/records */
const listMyRecords = asyncHandler(async (req, res) => {
  const result = await recordService.listPatientRecords(req.user.id, filtersFrom(req.query));
  const response = ApiResponse.ok(result);
  res.status(response.statusCode).json(response);
});

/** GET /api/patients/timeline */
const getMyTimeline = asyncHandler(async (req, res) => {
  const result = await recordService.getTimeline(req.user.id, filtersFrom(req.query));
  const response = ApiResponse.ok(result);
  res.status(response.statusCode).json(response);
});

/** PATCH /api/patients/records/:recordId */
const updateMyRecord = asyncHandler(async (req, res) => {
  const result = await recordService.updatePatientRecord(
    req.user.id,
    req.params.recordId,
    req.body,
    req.ip,
    req.headers['user-agent']
  );
  const response = ApiResponse.ok(result.record, result.message);
  res.status(response.statusCode).json(response);
});

/** DELETE /api/patients/records/:recordId */
const deleteMyRecord = asyncHandler(async (req, res) => {
  const result = await recordService.deletePatientRecord(
    req.user.id,
    req.params.recordId,
    req.ip,
    req.headers['user-agent']
  );
  const response = ApiResponse.ok(null, result.message);
  res.status(response.statusCode).json(response);
});

/** PATCH /api/patients/records/:recordId/prescription — { active: boolean } */
const setPrescriptionStatus = asyncHandler(async (req, res) => {
  const result = await recordService.setPrescriptionStatus(
    req.user.id,
    req.params.recordId,
    req.body.active,
    req.ip,
    req.headers['user-agent']
  );
  const response = ApiResponse.ok(result.record, result.message);
  res.status(response.statusCode).json(response);
});

// ─── Hospital side ─────────────────────────────────────

/** POST /api/hospitals/patients/:linkId/records */
const createRecordForPatient = asyncHandler(async (req, res) => {
  const result = await recordService.createRecordForLink(
    req.user.id,
    req.params.linkId,
    req.body,
    req.ip,
    req.headers['user-agent']
  );
  const response = ApiResponse.created(result, result.message);
  res.status(response.statusCode).json(response);
});

/** GET /api/hospitals/patients/:linkId/records — records this hospital created */
const listRecordsForPatient = asyncHandler(async (req, res) => {
  const result = await recordService.listRecordsForLink(
    req.user.id,
    req.params.linkId,
    filtersFrom(req.query)
  );
  const response = ApiResponse.ok(result);
  res.status(response.statusCode).json(response);
});

module.exports = {
  createMyRecord,
  listMyRecords,
  getMyTimeline,
  updateMyRecord,
  deleteMyRecord,
  setPrescriptionStatus,
  createRecordForPatient,
  listRecordsForPatient,
};
