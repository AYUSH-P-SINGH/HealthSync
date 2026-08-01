/**
 * Consent service — time-bound, scope-limited record sharing.
 *
 * The patient issues a consent grant (scopes + duration) and receives a
 * one-time access code (shown once, stored only as a SHA-256 hash) plus a
 * QR payload. Any hospital can claim the code to get read access to just
 * the granted record types until expiry, unless the patient revokes first.
 * Every record access through a grant is counted and audit-logged.
 */
const ConsentGrant = require('../models/ConsentGrant');
const MedicalRecord = require('../models/MedicalRecord');
const auditService = require('./audit.service');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const { RECORD_TYPES } = require('../constants/recordTypes');

const QR_TYPE = 'healthsync-consent';

/** Patient issues a new grant. Returns the plaintext code exactly once. */
const issueConsent = async (patientId, { scopes, durationHours, purpose }, ip, userAgent) => {
  const normalizedScopes = scopes.includes('all') ? ['all'] : [...new Set(scopes)];

  const code = ConsentGrant.generateCode();
  const expiresAt = new Date(Date.now() + durationHours * 60 * 60 * 1000);

  const consent = await ConsentGrant.create({
    patient: patientId,
    codeHash: ConsentGrant.hashCode(code),
    scopes: normalizedScopes,
    purpose: purpose || null,
    durationHours,
    expiresAt,
  });

  auditService.logAuthEvent({
    userId: patientId,
    action: 'CONSENT_ISSUED',
    ip,
    userAgent,
    success: true,
    metadata: { consentId: consent._id, scopes: normalizedScopes, durationHours },
  });

  logger.info('Consent grant issued', { consentId: consent._id.toString(), durationHours });

  return {
    consent: consent.toJSON(),
    code, // shown to the patient once — never retrievable again
    qrData: JSON.stringify({ t: QR_TYPE, code }),
    message: `Access code generated. It grants ${
      normalizedScopes.includes('all') ? 'full record' : 'scoped'
    } access for ${durationHours} hour${durationHours > 1 ? 's' : ''}. Share it only with your hospital.`,
  };
};

/** Patient lists their grants (newest first) with hospital info. */
const listPatientConsents = async (patientId) => {
  const consents = await ConsentGrant.find({ patient: patientId })
    .sort({ createdAt: -1 })
    .limit(100)
    .populate('hospital', 'name hospitalType city');

  return { consents: consents.map((c) => c.toJSON()) };
};

/** Patient revokes a grant early. */
const revokeConsent = async (patientId, consentId, ip, userAgent) => {
  const consent = await ConsentGrant.findOne({ _id: consentId, patient: patientId });
  if (!consent) throw ApiError.notFound('Consent grant not found.');
  if (consent.status === 'revoked') throw ApiError.badRequest('This grant is already revoked.');
  if (consent.isExpired()) throw ApiError.badRequest('This grant has already expired.');

  consent.status = 'revoked';
  consent.revokedAt = new Date();
  await consent.save();

  auditService.logAuthEvent({
    userId: patientId,
    action: 'CONSENT_REVOKED',
    ip,
    userAgent,
    success: true,
    metadata: { consentId: consent._id, hospitalId: consent.hospital },
  });

  return { consent: consent.toJSON(), message: 'Access revoked. The hospital can no longer view these records.' };
};

// ─── Hospital side ─────────────────────────────────────

/** Compact patient identity attached to a claimed grant. */
const consentPatientSummary = (user, scopes) => {
  const summary = {
    patientId: user.patientId,
    name: `${user.fullName?.firstName || ''} ${user.fullName?.lastName || ''}`.trim(),
    gender: user.gender || null,
    age: user.age ?? null,
    bloodGroup: user.bloodGroup || null,
  };
  // Allergies are clinically essential when prescriptions are in scope
  if (scopes.includes('all') || scopes.includes('prescription')) {
    summary.allergies = user.allergies || [];
  }
  return summary;
};

/** Hospital redeems an access code (from OTP entry or scanned QR). */
const claimConsent = async (hospitalId, rawCode, ip, userAgent) => {
  // Accept either the plain code or the scanned QR JSON payload
  let code = String(rawCode || '').trim();
  try {
    const parsed = JSON.parse(code);
    if (parsed && parsed.t === QR_TYPE && parsed.code) code = parsed.code;
  } catch {
    /* not JSON — treat as a plain code */
  }

  const consent = await ConsentGrant.findOne({ codeHash: ConsentGrant.hashCode(code) }).populate(
    'patient'
  );

  const fail = (message) => {
    auditService.logAuthEvent({
      userId: hospitalId,
      action: 'CONSENT_CLAIMED',
      ip,
      userAgent,
      success: false,
      metadata: { reason: message },
    });
    return ApiError.badRequest(message);
  };

  if (!consent) throw fail('Invalid access code.');
  if (consent.status === 'revoked') throw fail('This access code has been revoked by the patient.');
  if (consent.isExpired()) throw fail('This access code has expired.');
  if (consent.status === 'claimed') {
    if (String(consent.hospital) === String(hospitalId)) {
      // Idempotent: re-claiming your own grant just returns it
      return {
        consent: consent.toJSON(),
        patient: consentPatientSummary(consent.patient, consent.scopes),
        message: 'This grant is already active for your hospital.',
      };
    }
    throw fail('This access code has already been used by another hospital.');
  }

  consent.hospital = hospitalId;
  consent.status = 'claimed';
  consent.claimedAt = new Date();
  await consent.save();

  auditService.logAuthEvent({
    userId: hospitalId,
    action: 'CONSENT_CLAIMED',
    ip,
    userAgent,
    success: true,
    metadata: { consentId: consent._id, patientId: consent.patient?._id, scopes: consent.scopes },
  });

  logger.info('Consent grant claimed', { consentId: consent._id.toString(), hospitalId });

  return {
    consent: consent.toJSON(),
    patient: consentPatientSummary(consent.patient, consent.scopes),
    message: `Access granted until ${consent.expiresAt.toLocaleString('en-IN')}.`,
  };
};

/** Hospital lists grants claimed by it. */
const listHospitalConsents = async (hospitalId) => {
  const consents = await ConsentGrant.find({ hospital: hospitalId })
    .sort({ claimedAt: -1 })
    .limit(100)
    .populate('patient');

  return {
    consents: consents.map((c) => {
      const obj = c.toJSON();
      obj.patient = c.patient ? consentPatientSummary(c.patient, c.scopes) : null;
      return obj;
    }),
  };
};

/**
 * Hospital reads records through a claimed, still-valid grant.
 * Enforces scope + expiry + revocation; increments the usage counter and
 * audit-logs the access (the patient can see this trail).
 */
const getConsentRecords = async (hospitalId, consentId, { type } = {}, ip, userAgent) => {
  const consent = await ConsentGrant.findOne({ _id: consentId, hospital: hospitalId }).populate(
    'patient'
  );
  if (!consent) throw ApiError.notFound('Consent grant not found.');
  if (consent.status === 'revoked') {
    throw ApiError.forbidden('The patient has revoked this access grant.');
  }
  if (consent.isExpired()) {
    throw ApiError.forbidden('This access grant has expired.');
  }

  const allowedTypes = consent.scopes.includes('all') ? RECORD_TYPES : consent.scopes;

  const query = { patient: consent.patient._id, type: { $in: allowedTypes } };
  if (type) {
    if (!allowedTypes.includes(type)) {
      throw ApiError.forbidden(`This grant does not include access to ${type} records.`);
    }
    query.type = type;
  }

  const records = await MedicalRecord.find(query)
    .sort({ recordDate: -1, createdAt: -1 })
    .limit(500)
    .populate('hospital', 'name hospitalType city');

  consent.accessCount += 1;
  consent.lastAccessedAt = new Date();
  await consent.save();

  auditService.logAuthEvent({
    userId: hospitalId,
    action: 'CONSENT_RECORDS_ACCESSED',
    ip,
    userAgent,
    success: true,
    metadata: {
      consentId: consent._id,
      patientId: consent.patient._id,
      type: type || 'all-in-scope',
      returned: records.length,
    },
  });

  return {
    consent: consent.toJSON(),
    patient: consentPatientSummary(consent.patient, consent.scopes),
    allowedTypes,
    records: records.map((r) => r.toJSON()),
    total: records.length,
  };
};

module.exports = {
  issueConsent,
  listPatientConsents,
  revokeConsent,
  claimConsent,
  listHospitalConsents,
  getConsentRecords,
};
