/**
 * Consent controller — time-bound scoped access grants (OTP/QR).
 * Logic lives in consent.service.
 */
const consentService = require('../services/consent.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');

// ─── Patient side ──────────────────────────────────────

/** POST /api/patients/consents — { scopes, durationHours, purpose? } */
const issueConsent = asyncHandler(async (req, res) => {
  const result = await consentService.issueConsent(
    req.user.id,
    {
      scopes: req.body.scopes,
      durationHours: req.body.durationHours,
      purpose: req.body.purpose,
    },
    req.ip,
    req.headers['user-agent']
  );
  const response = ApiResponse.created(result, result.message);
  res.status(response.statusCode).json(response);
});

/** GET /api/patients/consents */
const listMyConsents = asyncHandler(async (req, res) => {
  const result = await consentService.listPatientConsents(req.user.id);
  const response = ApiResponse.ok(result);
  res.status(response.statusCode).json(response);
});

/** PATCH /api/patients/consents/:consentId/revoke */
const revokeConsent = asyncHandler(async (req, res) => {
  const result = await consentService.revokeConsent(
    req.user.id,
    req.params.consentId,
    req.ip,
    req.headers['user-agent']
  );
  const response = ApiResponse.ok(result.consent, result.message);
  res.status(response.statusCode).json(response);
});

// ─── Hospital side ─────────────────────────────────────

/** POST /api/hospitals/consents/claim — { code } (plain code or QR payload) */
const claimConsent = asyncHandler(async (req, res) => {
  const result = await consentService.claimConsent(
    req.user.id,
    req.body.code,
    req.ip,
    req.headers['user-agent']
  );
  const response = ApiResponse.ok(result, result.message);
  res.status(response.statusCode).json(response);
});

/** GET /api/hospitals/consents */
const listHospitalConsents = asyncHandler(async (req, res) => {
  const result = await consentService.listHospitalConsents(req.user.id);
  const response = ApiResponse.ok(result);
  res.status(response.statusCode).json(response);
});

/** GET /api/hospitals/consents/:consentId/records?type= */
const getConsentRecords = asyncHandler(async (req, res) => {
  const result = await consentService.getConsentRecords(
    req.user.id,
    req.params.consentId,
    { type: req.query.type },
    req.ip,
    req.headers['user-agent']
  );
  const response = ApiResponse.ok(result);
  res.status(response.statusCode).json(response);
});

module.exports = {
  issueConsent,
  listMyConsents,
  revokeConsent,
  claimConsent,
  listHospitalConsents,
  getConsentRecords,
};
