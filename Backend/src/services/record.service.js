/**
 * Medical record service — create/list/update records and build the
 * patient's chronological health timeline.
 *
 * Access model:
 *   - Patients manage their own records (self-reported ones are editable).
 *   - Hospitals create records for patients with an ACTIVE link, and can
 *     list the records they themselves created for that patient.
 *   - Broader hospital read access goes through consent grants
 *     (consent.service.js), not through this module.
 */
const mongoose = require('mongoose');
const MedicalRecord = require('../models/MedicalRecord');
const HospitalPatient = require('../models/HospitalPatient');
const Hospital = require('../models/Hospital');
const interactionService = require('./interaction.service');
const auditService = require('./audit.service');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const { RECORD_TYPES } = require('../constants/recordTypes');

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Normalize the type-specific payload for a record body. */
const buildRecordFields = (body) => {
  const fields = {
    type: body.type,
    title: body.title,
    description: body.description || '',
    condition: body.condition || null,
    doctorName: body.doctorName || null,
    recordDate: body.recordDate ? new Date(body.recordDate) : new Date(),
    medicines: [],
    labResults: [],
    isActivePrescription: null,
  };

  if (body.type === 'prescription') {
    fields.medicines = (body.medicines || []).filter((m) => m && m.name);
    fields.isActivePrescription = true;
  }
  if (body.type === 'lab_report') {
    fields.labResults = (body.labResults || []).filter((r) => r && r.name);
  }

  return fields;
};

/**
 * Shared creation path. For prescriptions, runs the drug-interaction and
 * allergy safety check; alerts are stored on the record AND returned so the
 * creating UI can surface them immediately.
 */
const createRecord = async ({ patientId, hospitalId, createdByRole, body, ip, userAgent, actorId }) => {
  const fields = buildRecordFields(body);

  let alerts = [];
  if (fields.type === 'prescription' && fields.medicines.length > 0) {
    alerts = await interactionService.checkPrescription(patientId, fields.medicines);
  }

  const record = await MedicalRecord.create({
    ...fields,
    patient: patientId,
    hospital: hospitalId || null,
    createdByRole,
    alerts,
  });

  auditService.logAuthEvent({
    userId: actorId,
    action: 'RECORD_CREATED',
    ip,
    userAgent,
    success: true,
    metadata: {
      recordId: record._id,
      patientId,
      type: fields.type,
      createdByRole,
      alertCount: alerts.length,
    },
  });

  logger.info('Medical record created', {
    recordId: record._id.toString(),
    type: fields.type,
    createdByRole,
    alerts: alerts.length,
  });

  if (record.hospital) await record.populate('hospital', 'name hospitalType city');

  return {
    record: record.toJSON(),
    alerts,
    message:
      alerts.length > 0
        ? `Record added — ${alerts.length} safety alert${alerts.length > 1 ? 's' : ''} found. Please review.`
        : 'Record added successfully.',
  };
};

/** Build the mongo query for a patient's records from filter params. */
const buildFilterQuery = (patientId, { type, hospitalId, condition, from, to, q, selfOnly } = {}) => {
  const query = { patient: patientId };

  if (type && RECORD_TYPES.includes(type)) query.type = type;
  if (hospitalId === 'self' || selfOnly) query.hospital = null;
  else if (hospitalId) query.hospital = hospitalId;
  if (condition) query.condition = { $regex: escapeRegex(condition), $options: 'i' };

  if (from || to) {
    query.recordDate = {};
    if (from) query.recordDate.$gte = new Date(from);
    if (to) {
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);
      query.recordDate.$lte = end;
    }
  }

  if (q) {
    const rx = { $regex: escapeRegex(q), $options: 'i' };
    query.$or = [
      { title: rx },
      { description: rx },
      { condition: rx },
      { doctorName: rx },
      { 'medicines.name': rx },
      { 'labResults.name': rx },
    ];
  }

  return query;
};

/** List a patient's own records (flat, newest first). */
const listPatientRecords = async (patientId, filters = {}) => {
  const query = buildFilterQuery(patientId, filters);
  const records = await MedicalRecord.find(query)
    .sort({ recordDate: -1, createdAt: -1 })
    .limit(500)
    .populate('hospital', 'name hospitalType city');

  return { records: records.map((r) => r.toJSON()), total: records.length };
};

/**
 * Chronological timeline: same filtered records, grouped by month, plus
 * facet data (type counts + the hospitals that appear) for the filter UI.
 */
const getTimeline = async (patientId, filters = {}) => {
  const query = buildFilterQuery(patientId, filters);

  const [records, typeCounts, hospitalFacet] = await Promise.all([
    MedicalRecord.find(query)
      .sort({ recordDate: -1, createdAt: -1 })
      .limit(500)
      .populate('hospital', 'name hospitalType city'),
    MedicalRecord.aggregate([
      { $match: { patient: new mongoose.Types.ObjectId(String(patientId)) } },
      { $group: { _id: '$type', count: { $sum: 1 } } },
    ]),
    MedicalRecord.aggregate([
      { $match: { patient: new mongoose.Types.ObjectId(String(patientId)), hospital: { $ne: null } } },
      { $group: { _id: '$hospital' } },
    ]),
  ]);

  // Group by "Month Year"
  const groups = [];
  let current = null;
  for (const rec of records) {
    const d = rec.recordDate || rec.createdAt;
    const label = d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    if (!current || current.label !== label) {
      current = { label, items: [] };
      groups.push(current);
    }
    current.items.push(rec.toJSON());
  }

  const counts = {};
  for (const t of RECORD_TYPES) counts[t] = 0;
  for (const c of typeCounts) counts[c._id] = c.count;

  // Resolve hospital names for the filter dropdown
  const hospitals = await Hospital.find({ _id: { $in: hospitalFacet.map((h) => h._id) } }).select(
    'name city'
  );

  return {
    groups,
    total: records.length,
    counts,
    hospitals: hospitals.map((h) => ({ id: h._id, name: h.name, city: h.city || null })),
  };
};

/** Patient updates one of their SELF-REPORTED records. */
const updatePatientRecord = async (patientId, recordId, body, ip, userAgent) => {
  const record = await MedicalRecord.findOne({ _id: recordId, patient: patientId });
  if (!record) throw ApiError.notFound('Record not found.');
  if (record.createdByRole !== 'patient') {
    throw ApiError.forbidden('Hospital-issued records cannot be edited.');
  }

  const editable = ['title', 'description', 'condition', 'doctorName', 'recordDate'];
  for (const key of editable) {
    if (body[key] !== undefined) record[key] = body[key];
  }
  if (record.type === 'prescription' && Array.isArray(body.medicines)) {
    record.medicines = body.medicines.filter((m) => m && m.name);
  }
  if (record.type === 'lab_report' && Array.isArray(body.labResults)) {
    record.labResults = body.labResults.filter((r) => r && r.name);
  }
  await record.save();

  auditService.logAuthEvent({
    userId: patientId,
    action: 'RECORD_UPDATED',
    ip,
    userAgent,
    success: true,
    metadata: { recordId: record._id },
  });

  return { record: record.toJSON(), message: 'Record updated.' };
};

/** Patient deletes one of their SELF-REPORTED records. */
const deletePatientRecord = async (patientId, recordId, ip, userAgent) => {
  const record = await MedicalRecord.findOne({ _id: recordId, patient: patientId });
  if (!record) throw ApiError.notFound('Record not found.');
  if (record.createdByRole !== 'patient') {
    throw ApiError.forbidden('Hospital-issued records cannot be deleted.');
  }

  await record.deleteOne();

  auditService.logAuthEvent({
    userId: patientId,
    action: 'RECORD_DELETED',
    ip,
    userAgent,
    success: true,
    metadata: { recordId },
  });

  return { message: 'Record deleted.' };
};

/** Patient marks a prescription as still-taking / completed. */
const setPrescriptionStatus = async (patientId, recordId, active, ip, userAgent) => {
  const record = await MedicalRecord.findOne({
    _id: recordId,
    patient: patientId,
    type: 'prescription',
  });
  if (!record) throw ApiError.notFound('Prescription not found.');

  record.isActivePrescription = Boolean(active);
  await record.save();

  auditService.logAuthEvent({
    userId: patientId,
    action: 'RECORD_UPDATED',
    ip,
    userAgent,
    success: true,
    metadata: { recordId, isActivePrescription: record.isActivePrescription },
  });

  return {
    record: record.toJSON(),
    message: active ? 'Prescription marked as active.' : 'Prescription marked as completed.',
  };
};

// ─── Hospital side ─────────────────────────────────────

/** Assert the hospital has an ACTIVE link for this linkId; return the link. */
const requireActiveLink = async (hospitalId, linkId) => {
  const link = await HospitalPatient.findOne({ _id: linkId, hospital: hospitalId });
  if (!link) throw ApiError.notFound('Patient link not found.');
  if (link.status !== 'active') {
    throw ApiError.forbidden('This patient link is not active. Records require patient consent.');
  }
  return link;
};

/** Hospital creates a record for a linked (active) patient. */
const createRecordForLink = async (hospitalId, linkId, body, ip, userAgent) => {
  const link = await requireActiveLink(hospitalId, linkId);
  return createRecord({
    patientId: link.patient,
    hospitalId,
    createdByRole: 'hospital',
    body,
    ip,
    userAgent,
    actorId: hospitalId,
  });
};

/** Hospital lists the records IT created for a linked patient. */
const listRecordsForLink = async (hospitalId, linkId, filters = {}) => {
  const link = await requireActiveLink(hospitalId, linkId);
  const query = buildFilterQuery(link.patient, { ...filters, hospitalId });
  const records = await MedicalRecord.find(query)
    .sort({ recordDate: -1, createdAt: -1 })
    .limit(500);

  return { records: records.map((r) => r.toJSON()), total: records.length };
};

/** Dashboard counts for the patient summary. */
const countsForPatient = async (patientId) => {
  const [totalRecords, activePrescriptions] = await Promise.all([
    MedicalRecord.countDocuments({ patient: patientId }),
    MedicalRecord.countDocuments({
      patient: patientId,
      type: 'prescription',
      isActivePrescription: true,
    }),
  ]);
  return { totalRecords, activePrescriptions };
};

module.exports = {
  createRecord,
  listPatientRecords,
  getTimeline,
  updatePatientRecord,
  deletePatientRecord,
  setPrescriptionStatus,
  createRecordForLink,
  listRecordsForLink,
  countsForPatient,
};
