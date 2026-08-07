/**
 * Follow-up obligation controller.
 * HTTP plumbing only — all logic and authorization lives in
 * followup.service.js, so there is exactly one place to audit it.
 */
const followupService = require('../services/followup.service');
const documentTextService = require('../services/documentText.service');
const ocrService = require('../services/ocr.service');
const { verifyBatchSize } = require('../config/reportUpload.config');
const MedicalRecord = require('../models/MedicalRecord');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const auditService = require('../services/audit.service');

// ─── Patient side ──────────────────────────────────────

/** GET /api/patients/followups */
const listMyFollowUps = asyncHandler(async (req, res) => {
  const result = await followupService.listForPatient(req.user.id, {
    status: req.query.status,
    includeResolved: req.query.includeResolved === 'true',
  });
  const response = ApiResponse.ok(result);
  res.status(response.statusCode).json(response);
});

/**
 * Read whatever the request carried — one file, a batch/folder, or pasted
 * text — into a single body of prose plus a `source` descriptor.
 *
 * Shared by the patient and hospital scan endpoints so the two can never
 * drift apart on something as consequential as "did we read the whole report".
 */
const resolveReportText = async ({ files, text, actorId, ip, userAgent, auditMeta = {} }) => {
  if (files && files.length > 0) {
    verifyBatchSize(files);

    const { results, readCount, failedCount } = await documentTextService.readBatch(files);

    if (readCount === 0) {
      // Surface the first real reason rather than a generic failure — the user
      // usually just needs to know it was blurry vs the wrong file type.
      const firstReason = results.find((r) => !r.ok)?.reason;
      throw ApiError.badRequest(
        firstReason || 'None of those files could be read. Try clearer photos, or paste the report text.'
      );
    }

    const combined = documentTextService.combineBatchText(results);
    const confidence = documentTextService.averageConfidence(results);
    const methods = [...new Set(results.filter((r) => r.ok).map((r) => r.method))];

    auditService.logAuthEvent({
      userId: actorId,
      action: 'FOLLOWUP_SCAN_UPLOADED',
      ip,
      userAgent,
      success: true,
      // Counts, sizes and how it was read. Report contents are PHI and have no
      // business being duplicated into an audit row.
      metadata: {
        ...auditMeta,
        fileCount: files.length,
        readCount,
        failedCount,
        methods,
        confidence,
        bytes: files.reduce((s, f) => s + (f.size || 0), 0),
      },
    });

    return {
      reportText: combined,
      source: {
        method: methods.length === 1 ? methods[0] : 'mixed',
        batch: true,
        fileCount: results.length,
        readCount,
        failedCount,
        // The single most important flag in this response.
        incomplete: failedCount > 0,
        confidence,
        lowConfidence: confidence > 0 && confidence < ocrService.MIN_CONFIDENCE,
        files: results.map(({ name, order, ok, method, confidence: c, reason }) => ({
          name,
          order,
          ok,
          method,
          confidence: c,
          reason,
        })),
      },
    };
  }

  if (text) {
    return {
      reportText: documentTextService.sanitizePastedText(text),
      source: { method: 'pasted', batch: false, pages: 0, incomplete: false },
    };
  }

  throw ApiError.badRequest('Upload a report PDF or photo, or paste the report text.');
};

/**
 * Build the response message.
 *
 * The combination that needs the loudest handling is "we could not read
 * everything AND we found nothing", because the natural reading of "no
 * follow-ups found" is "your report is clear" — a conclusion nobody should
 * draw from a report the system only partially read.
 */
const buildScanMessage = (result, source) => {
  const none = (result.candidates?.length || 0) === 0;

  if (source.incomplete && none) {
    return `${source.failedCount} of ${source.fileCount} pages could not be read, and no follow-ups were found in the rest. Please re-upload the missing pages before treating this report as clear.`;
  }
  if (source.incomplete) {
    return `${result.message} Note: ${source.failedCount} of ${source.fileCount} pages could not be read, so there may be more.`;
  }
  if (source.lowConfidence && none) {
    return 'That image was hard to read, and no follow-ups were found — this may be because the text was unclear rather than because there are none. Try a sharper photo, or paste the text.';
  }
  return result.message;
};

/**
 * POST /api/patients/followups/scan
 * Accepts multipart `report` (one or many PDFs/images) or JSON `text`.
 */
const scanMyReport = asyncHandler(async (req, res) => {
  const { text, sourceRecordId, recordDate, dryRun } = req.body;

  const { reportText, source } = await resolveReportText({
    files: req.files,
    text,
    actorId: req.user.id,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  /**
   * If the scan is attached to an existing record, confirm the caller owns
   * that record before linking. Without this, a valid sourceRecordId
   * belonging to another patient would attach provenance to a record the
   * caller cannot see.
   */
  let sourceRecord = null;
  let sourceHospital = null;
  let anchorDate = recordDate ? new Date(recordDate) : new Date();

  if (sourceRecordId) {
    const record = await MedicalRecord.findOne({
      _id: sourceRecordId,
      patient: req.user.id,
    }).select('_id hospital recordDate createdAt');
    if (!record) throw ApiError.notFound('Record not found.');

    sourceRecord = record._id;
    sourceHospital = record.hospital || null;
    if (!recordDate) anchorDate = record.recordDate || record.createdAt;
  }

  const result = await followupService.scanText({
    patientId: req.user.id,
    text: reportText,
    anchorDate,
    sourceRecord,
    sourceHospital,
    actorId: req.user.id,
    actorRole: 'patient',
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    dryRun: dryRun === true || dryRun === 'true',
  });

  const response = ApiResponse.ok({ ...result, source }, buildScanMessage(result, source));
  res.status(response.statusCode).json(response);
});

/** PATCH /api/patients/followups/:followUpId/confirm */
const confirmFollowUp = asyncHandler(async (req, res) => {
  const result = await followupService.confirm(
    req.user.id,
    req.params.followUpId,
    { dueAt: req.body.dueAt },
    req.ip,
    req.headers['user-agent']
  );
  const response = ApiResponse.ok(result.followUp, result.message);
  res.status(response.statusCode).json(response);
});

/** PATCH /api/patients/followups/:followUpId/schedule */
const scheduleFollowUp = asyncHandler(async (req, res) => {
  const result = await followupService.markScheduled({
    patientId: req.user.id,
    followUpId: req.params.followUpId,
    scheduledFor: req.body.scheduledFor,
    actorRole: 'patient',
    actorId: req.user.id,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });
  const response = ApiResponse.ok(result.followUp, result.message);
  res.status(response.statusCode).json(response);
});

/** PATCH /api/patients/followups/:followUpId/complete */
const completeFollowUp = asyncHandler(async (req, res) => {
  const result = await followupService.markCompleted({
    patientId: req.user.id,
    followUpId: req.params.followUpId,
    actorRole: 'patient',
    actorId: req.user.id,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });
  const response = ApiResponse.ok(result.followUp, result.message);
  res.status(response.statusCode).json(response);
});

/** PATCH /api/patients/followups/:followUpId/dismiss */
const dismissFollowUp = asyncHandler(async (req, res) => {
  const result = await followupService.dismiss({
    patientId: req.user.id,
    followUpId: req.params.followUpId,
    reason: req.body.reason,
    actorRole: 'patient',
    actorId: req.user.id,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });
  const response = ApiResponse.ok(result.followUp, result.message);
  res.status(response.statusCode).json(response);
});

// ─── Hospital side ─────────────────────────────────────

/**
 * GET /api/hospitals/followups?linkId=... | ?consentId=...
 * The cross-institution safety net.
 */
const listPatientFollowUps = asyncHandler(async (req, res) => {
  const result = await followupService.listForProvider(
    req.user.id,
    { linkId: req.query.linkId, consentId: req.query.consentId },
    req.ip,
    req.headers['user-agent']
  );
  const response = ApiResponse.ok(result);
  res.status(response.statusCode).json(response);
});

/** PATCH /api/hospitals/followups/:followUpId */
const actOnPatientFollowUp = asyncHandler(async (req, res) => {
  const result = await followupService.providerAct({
    hospitalId: req.user.id,
    linkId: req.body.linkId,
    consentId: req.body.consentId,
    followUpId: req.params.followUpId,
    action: req.body.action,
    reason: req.body.reason,
    scheduledFor: req.body.scheduledFor,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });
  const response = ApiResponse.ok(result.followUp, result.message);
  res.status(response.statusCode).json(response);
});

/**
 * POST /api/hospitals/patients/:linkId/followups/scan
 * A hospital scanning a report it is filing for a linked patient.
 */
const scanForPatient = asyncHandler(async (req, res) => {
  const access = await followupService.resolveHospitalAccess(req.user.id, {
    linkId: req.params.linkId,
  });

  const { reportText, source } = await resolveReportText({
    files: req.files,
    text: req.body.text,
    actorId: req.user.id,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    auditMeta: { patientId: String(access.patientId) },
  });

  const result = await followupService.scanText({
    patientId: access.patientId,
    text: reportText,
    anchorDate: req.body.recordDate ? new Date(req.body.recordDate) : new Date(),
    sourceHospital: req.user.id,
    actorId: req.user.id,
    actorRole: 'hospital',
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    dryRun: req.body.dryRun === true || req.body.dryRun === 'true',
  });

  const response = ApiResponse.ok({ ...result, source }, buildScanMessage(result, source));
  res.status(response.statusCode).json(response);
});

module.exports = {
  listMyFollowUps,
  scanMyReport,
  confirmFollowUp,
  scheduleFollowUp,
  completeFollowUp,
  dismissFollowUp,
  listPatientFollowUps,
  actOnPatientFollowUp,
  scanForPatient,
};
