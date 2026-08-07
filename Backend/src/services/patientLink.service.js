/**
 * Patient-link service — consent-based Hospital <-> Patient linking.
 *
 * Flow: hospital looks a patient up (minimal info) -> sends a link request
 * (pending) -> the PATIENT approves or rejects it from their own dashboard ->
 * on approval the link becomes active. Either side can end an active link
 * (hospital: discharge, patient: revoke); records are kept, never deleted.
 */
const mongoose = require('mongoose');
const HospitalPatient = require('../models/HospitalPatient');
const User = require('../models/User');
const auditService = require('./audit.service');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const socket = require('../socket');

const PATIENT_ID_RE = /^HS-[0-9A-F]{8}$/i;

/** Mask a mobile number for pre-consent display: "9876543210" -> "••••••3210". */
const maskMobile = (mobile) => (mobile ? `••••••${mobile.slice(-4)}` : null);

/**
 * Resolve a patient by public Patient ID (HS-XXXXXXXX) or email.
 * The patient shares this identifier with the hospital themselves (front
 * desk / phone), which is the first, informal consent signal.
 */
const resolvePatient = async (query) => {
  const q = String(query || '').trim();

  if (PATIENT_ID_RE.test(q)) {
    const prefix = q.slice(3).toLowerCase();
    // patientId is a virtual (first 8 hex chars of _id) — match on _id prefix.
    return User.findOne({
      $expr: { $eq: [{ $substrCP: [{ $toString: '$_id' }, 0, 8] }, prefix] },
    });
  }

  if (q.includes('@')) {
    return User.findOne({ email: q.toLowerCase() });
  }

  throw ApiError.badRequest('Enter a valid Patient ID (HS-XXXXXXXX) or email address.');
};

/** Minimal identity shown to the hospital BEFORE the patient has consented. */
const preConsentSummary = (user) => ({
  patientId: user.patientId,
  name: `${user.fullName?.firstName || ''} ${user.fullName?.lastName || ''}`.trim(),
  gender: user.gender || null,
  age: user.age,
  maskedMobile: maskMobile(user.mobileNumber),
  profilePicture: user.profilePicture || null,
  isVerified: user.isVerified,
});

/** Fuller contact card, shared only after the patient approved the link. */
const postConsentSummary = (user) => ({
  ...preConsentSummary(user),
  mobileNumber: user.mobileNumber || null,
  email: user.email,
  bloodGroup: user.bloodGroup || null,
  dob: user.dob || null,
  emergencyContact: user.emergencyContact || null,
  address: user.address || null,
});

const linkToJSON = (link, { fullPatient = false } = {}) => {
  const obj = link.toJSON();
  if (link.populated('patient') && link.patient) {
    obj.patient =
      fullPatient && link.status === 'active'
        ? { id: link.patient._id, ...postConsentSummary(link.patient) }
        : { id: link.patient._id, ...preConsentSummary(link.patient) };
  }
  return obj;
};

// ─── Hospital side ─────────────────────────────────────

/**
 * Look up a patient so front-desk staff can visually confirm identity
 * before sending a link request. Returns minimal, masked info only.
 */
const lookupPatient = async (hospitalId, query, ip, userAgent) => {
  const user = await resolvePatient(query);

  auditService.logAuthEvent({
    userId: hospitalId,
    action: 'PATIENT_LOOKUP',
    ip,
    userAgent,
    success: !!user,
    metadata: { query: String(query).trim() },
  });

  if (!user) {
    throw ApiError.notFound('No patient found with that ID or email.');
  }

  const existing = await HospitalPatient.findOne({ hospital: hospitalId, patient: user._id });

  return {
    patient: preConsentSummary(user),
    linkStatus: existing ? existing.status : null,
  };
};

/**
 * Create (or re-open) a link request. The patient must approve it from
 * their own dashboard before the hospital sees anything beyond the
 * pre-consent summary.
 */
const requestLink = async (hospitalId, query, ip, userAgent) => {
  const user = await resolvePatient(query);

  if (!user) {
    throw ApiError.notFound('No patient found with that ID or email.');
  }

  let link = await HospitalPatient.findOne({ hospital: hospitalId, patient: user._id });

  if (link) {
    if (link.status === 'pending') {
      throw ApiError.badRequest('A request for this patient is already pending their approval.');
    }
    if (link.status === 'active') {
      throw ApiError.badRequest('This patient is already linked to your hospital.');
    }
    // rejected / discharged -> re-open the same record as a fresh request
    link.status = 'pending';
    link.endedBy = null;
    link.requestedAt = new Date();
    link.respondedAt = null;
    link.endedAt = null;
    await link.save();
  } else {
    link = await HospitalPatient.create({ hospital: hospitalId, patient: user._id });
  }

  auditService.logAuthEvent({
    userId: hospitalId,
    action: 'PATIENT_LINK_REQUESTED',
    ip,
    userAgent,
    success: true,
    metadata: { linkId: link._id, patientId: user.patientId },
  });

  logger.info('Patient link requested', { hospitalId, patientId: user.patientId });

  // Real-time: the patient sees the request instantly.
  socket.emitToUser(user._id, 'link:request', { linkId: link._id });

  await link.populate('patient');

  return {
    link: linkToJSON(link),
    message: 'Request sent. The patient must approve it from their HealthSync account.',
  };
};

/**
 * List this hospital's links, newest activity first, with status counts.
 */
const listHospitalPatients = async (hospitalId, status) => {
  const filter = { hospital: hospitalId };
  if (status) filter.status = status;

  const [links, countsRaw] = await Promise.all([
    HospitalPatient.find(filter).sort({ updatedAt: -1 }).populate('patient'),
    HospitalPatient.aggregate([
      { $match: { hospital: new mongoose.Types.ObjectId(String(hospitalId)) } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
  ]);

  const counts = { pending: 0, active: 0, rejected: 0, discharged: 0 };
  for (const row of countsRaw) counts[row._id] = row.count;

  return {
    links: links.map((l) => linkToJSON(l, { fullPatient: true })),
    counts,
  };
};

/**
 * End a link from the hospital side (discharge an active patient, or
 * withdraw a pending request).
 */
const dischargePatient = async (hospitalId, linkId, ip, userAgent) => {
  const link = await HospitalPatient.findOne({ _id: linkId, hospital: hospitalId });

  if (!link) {
    throw ApiError.notFound('Patient link not found.');
  }
  if (link.status !== 'active' && link.status !== 'pending') {
    throw ApiError.badRequest('Only active patients or pending requests can be ended.');
  }

  link.status = 'discharged';
  link.endedBy = 'hospital';
  link.endedAt = new Date();
  await link.save();

  auditService.logAuthEvent({
    userId: hospitalId,
    action: 'PATIENT_DISCHARGED',
    ip,
    userAgent,
    success: true,
    metadata: { linkId: link._id },
  });

  return { link: link.toJSON(), message: 'Patient link ended.' };
};

// ─── Patient side ──────────────────────────────────────

/**
 * List the patient's own links (pending = incoming requests,
 * active = "my hospitals").
 */
const listPatientLinks = async (userId, status) => {
  const filter = { patient: userId };
  if (status) filter.status = status;

  const links = await HospitalPatient.find(filter)
    .sort({ updatedAt: -1 })
    .populate('hospital', 'name hospitalType address.city address.state isVerified emergencyAvailable');

  return {
    links: links.map((l) => {
      const obj = l.toJSON();
      if (l.populated('hospital') && l.hospital) {
        obj.hospital = {
          id: l.hospital._id,
          name: l.hospital.name,
          hospitalType: l.hospital.hospitalType,
          city: l.hospital.address?.city || null,
          state: l.hospital.address?.state || null,
          isVerified: l.hospital.isVerified,
          emergencyAvailable: l.hospital.emergencyAvailable,
        };
      }
      return obj;
    }),
  };
};

/**
 * Patient approves or rejects a pending hospital request. This is the
 * explicit consent step — nothing is shared until this returns 'active'.
 */
const respondToRequest = async (userId, linkId, action, ip, userAgent) => {
  const link = await HospitalPatient.findOne({ _id: linkId, patient: userId });

  if (!link) {
    throw ApiError.notFound('Request not found.');
  }
  if (link.status !== 'pending') {
    throw ApiError.badRequest('This request has already been responded to.');
  }

  const approved = action === 'approve';
  link.status = approved ? 'active' : 'rejected';
  link.respondedAt = new Date();
  await link.save();

  auditService.logAuthEvent({
    userId,
    action: approved ? 'PATIENT_LINK_APPROVED' : 'PATIENT_LINK_REJECTED',
    ip,
    userAgent,
    success: true,
    metadata: { linkId: link._id, hospitalId: link.hospital },
  });

  logger.info('Patient responded to hospital link request', { userId, linkId, approved });

  // Real-time: the hospital sees the decision instantly.
  socket.emitToUser(link.hospital, 'link:updated', { linkId: link._id, status: link.status });

  return {
    link: link.toJSON(),
    message: approved
      ? 'Hospital request approved. You are now linked.'
      : 'Hospital request rejected.',
  };
};

/**
 * Patient revokes an active link — the hospital loses access.
 */
const revokeLink = async (userId, linkId, ip, userAgent) => {
  const link = await HospitalPatient.findOne({ _id: linkId, patient: userId });

  if (!link) {
    throw ApiError.notFound('Hospital link not found.');
  }
  if (link.status !== 'active') {
    throw ApiError.badRequest('Only active hospital links can be revoked.');
  }

  link.status = 'discharged';
  link.endedBy = 'patient';
  link.endedAt = new Date();
  await link.save();

  auditService.logAuthEvent({
    userId,
    action: 'PATIENT_LINK_REVOKED',
    ip,
    userAgent,
    success: true,
    metadata: { linkId: link._id, hospitalId: link.hospital },
  });

  socket.emitToUser(link.hospital, 'link:updated', { linkId: link._id, status: 'discharged' });

  return { link: link.toJSON(), message: 'Hospital access revoked.' };
};

module.exports = {
  lookupPatient,
  requestLink,
  listHospitalPatients,
  dischargePatient,
  listPatientLinks,
  respondToRequest,
  revokeLink,
};
