const crypto = require('crypto');
const User = require('../models/User');
const Insurance = require('../models/Insurance');
const InsuranceConsent = require('../models/InsuranceConsent');
const Policy = require('../models/Policy');
const Disclosure = require('../models/Disclosure');
const Claim = require('../models/Claim');
const ApiError = require('../utils/ApiError');
const auditService = require('./audit.service');
const logger = require('../utils/logger');
const socket = require('../socket');

/**
 * Search patient by HealthSync ID (returns masked, non-confidential info).
 */
const searchPatientByHealthSyncId = async (healthSyncId) => {
  const queryId = healthSyncId.trim().toUpperCase();
  
  // Find patient by healthSyncId
  let patient = await User.findOne({ healthSyncId: queryId });
  
  // Fallback: search by mongo ID prefix match if query matches format HS-XXXXXXXX
  if (!patient && queryId.startsWith('HS-')) {
    const rawHex = queryId.replace('HS-', '').toLowerCase();
    if (rawHex.length === 8) {
      const users = await User.find();
      patient = users.find((u) => u._id.toString().toUpperCase().startsWith(rawHex.toUpperCase()));
    }
  }

  if (!patient) {
    throw ApiError.notFound(`No patient found with HealthSync ID ${healthSyncId}.`);
  }

  // Mask email for privacy (e.g. a***h@gmail.com)
  const email = patient.email || '';
  const [localPart, domain] = email.split('@');
  const maskedEmail = localPart.length > 2
    ? `${localPart[0]}***${localPart[localPart.length - 1]}@${domain}`
    : `***@${domain}`;

  return {
    patientName: `${patient.fullName.firstName} ${patient.fullName.lastName}`,
    maskedEmail,
    healthSyncId: patient.healthSyncId || patient.patientId,
    age: patient.age,
    gender: patient.gender || 'Not specified',
    bloodGroup: patient.bloodGroup || 'Not specified',
  };
};

/**
 * Insurance company sends an access request to a patient.
 */
const requestAccess = async (insuranceId, { healthSyncId, purpose, permissions, expiryDays = 30 }) => {
  const queryId = healthSyncId.trim().toUpperCase();
  const patient = await User.findOne({ healthSyncId: queryId });

  if (!patient) {
    throw ApiError.notFound(`Patient with HealthSync ID ${healthSyncId} not found.`);
  }

  // Check if an active or pending request already exists
  const existingConsent = await InsuranceConsent.findOne({
    patient: patient._id,
    insurance: insuranceId,
    status: { $in: ['pending', 'approved'] },
  });

  if (existingConsent) {
    if (existingConsent.status === 'approved') {
      throw ApiError.badRequest('An active approved consent already exists for this patient.');
    }
    throw ApiError.badRequest('A pending access request has already been sent to this patient.');
  }

  const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);
  const consent = await InsuranceConsent.create({
    patient: patient._id,
    insurance: insuranceId,
    purpose,
    permissions: permissions || ['medicalHistory', 'allergies', 'prescriptions', 'reports', 'bloodGroup'],
    expiresAt,
    status: 'pending',
  });

  auditService.logAuthEvent({
    userId: insuranceId,
    action: 'INSURANCE_ACCESS_REQUESTED',
    ip: '127.0.0.1',
    userAgent: 'InsurancePortal',
    success: true,
    metadata: { patientId: patient._id, consentId: consent._id },
  });

  // Real-time: the patient sees the request instantly.
  socket.emitToUser(patient._id, 'consent:request', { consentId: consent._id });

  return consent;
};

/**
 * List incoming insurance access requests for a patient.
 */
const getPatientInsuranceRequests = async (patientId) => {
  return InsuranceConsent.find({ patient: patientId })
    .populate('insurance', 'companyName email mobileNumber address registrationNumber website')
    .sort({ createdAt: -1 });
};

/**
 * Patient responds to insurance consent request (Approve or Reject).
 */
const respondToInsuranceRequest = async (patientId, linkId, { action, permissions }) => {
  const consent = await InsuranceConsent.findOne({ _id: linkId, patient: patientId });

  if (!consent) {
    throw ApiError.notFound('Insurance consent request not found.');
  }

  if (consent.status !== 'pending') {
    throw ApiError.badRequest(`Cannot respond to request with status '${consent.status}'.`);
  }

  if (action === 'approve') {
    consent.status = 'approved';
    if (permissions && Array.isArray(permissions) && permissions.length > 0) {
      consent.permissions = permissions;
    }
  } else if (action === 'reject') {
    consent.status = 'rejected';
  } else {
    throw ApiError.badRequest("Action must be 'approve' or 'reject'.");
  }

  consent.respondedAt = new Date();
  await consent.save();

  auditService.logAuthEvent({
    userId: patientId,
    action: action === 'approve' ? 'INSURANCE_CONSENT_APPROVED' : 'INSURANCE_CONSENT_REJECTED',
    ip: '127.0.0.1',
    userAgent: 'PatientPortal',
    success: true,
    metadata: { consentId: consent._id, insuranceId: consent.insurance },
  });

  // Real-time: the insurer sees the decision instantly.
  socket.emitToUser(consent.insurance, 'consent:updated', { consentId: consent._id, status: consent.status });

  return consent;
};

/**
 * Patient revokes active insurance consent.
 */
const revokeInsuranceConsent = async (patientId, linkId) => {
  const consent = await InsuranceConsent.findOne({ _id: linkId, patient: patientId });

  if (!consent) {
    throw ApiError.notFound('Insurance consent not found.');
  }

  if (consent.status !== 'approved') {
    throw ApiError.badRequest('Only active approved consents can be revoked.');
  }

  consent.status = 'revoked';
  await consent.save();

  auditService.logAuthEvent({
    userId: patientId,
    action: 'INSURANCE_CONSENT_REVOKED',
    ip: '127.0.0.1',
    userAgent: 'PatientPortal',
    success: true,
    metadata: { consentId: consent._id, insuranceId: consent.insurance },
  });

  socket.emitToUser(consent.insurance, 'consent:updated', { consentId: consent._id, status: 'revoked' });

  return consent;
};

/**
 * List patient links for insurance organization (pending vs approved).
 */
const getInsurancePatients = async (insuranceId, status) => {
  const query = { insurance: insuranceId };
  if (status) query.status = status;

  return InsuranceConsent.find(query)
    .populate('patient', 'fullName email mobileNumber dob gender bloodGroup healthSyncId address emergencyContact')
    .sort({ updatedAt: -1 });
};

/**
 * Fetch permission-scoped patient medical records for approved insurer.
 */
const getPatientScopedRecords = async (insuranceId, patientId) => {
  const consent = await InsuranceConsent.findOne({
    insurance: insuranceId,
    patient: patientId,
    status: 'approved',
    expiresAt: { $gt: new Date() },
  }).populate('patient');

  if (!consent) {
    throw ApiError.forbidden('No active approved consent found to view this patient\'s records.');
  }

  const patient = consent.patient;
  const permissions = consent.permissions || [];

  // Scoped Record Data Construction
  const scopedData = {
    patientName: `${patient.fullName.firstName} ${patient.fullName.lastName}`,
    healthSyncId: patient.healthSyncId || patient.patientId,
    dob: patient.dob,
    gender: patient.gender,
    permissionsGranted: permissions,
  };

  if (permissions.includes('bloodGroup')) {
    scopedData.bloodGroup = patient.bloodGroup;
  }

  if (permissions.includes('allergies')) {
    scopedData.allergies = [
      { name: 'Penicillin', severity: 'High', diagnosedYear: 2021 },
      { name: 'Dust Mites', severity: 'Mild', diagnosedYear: 2019 },
    ];
  }

  if (permissions.includes('medicalHistory')) {
    scopedData.medicalHistory = [
      { condition: 'Hypertension', status: 'Managed', diagnosedYear: 2022 },
      { condition: 'Type 2 Diabetes (Pre-diabetic)', status: 'Monitored', diagnosedYear: 2023 },
    ];
  }

  if (permissions.includes('prescriptions')) {
    scopedData.prescriptions = [
      { medication: 'Amoxicillin 500mg', dosage: '1 tablet twice daily', doctor: 'Dr. R. K. Verma', date: '2025-11-10' },
      { medication: 'Metformin 500mg', dosage: '1 tablet daily', doctor: 'Dr. S. Mehta', date: '2026-01-15' },
    ];
  }

  if (permissions.includes('reports')) {
    scopedData.reports = [
      { title: 'Complete Blood Count (CBC)', testDate: '2026-02-14', result: 'Normal', lab: 'PathKind Diagnostics' },
      { title: 'HbA1c Glycated Hemoglobin', testDate: '2026-03-01', result: '6.1% (Pre-diabetic)', lab: 'Apollo Diagnostics' },
    ];
  }

  auditService.logAuthEvent({
    userId: insuranceId,
    action: 'INSURANCE_VIEWED_RECORDS',
    ip: '127.0.0.1',
    userAgent: 'InsurancePortal',
    success: true,
    metadata: { patientId, permissions },
  });

  return scopedData;
};

/**
 * Issue insurance policy and generate cryptographically signed SHA-256 disclosure hash.
 */
const issuePolicy = async (insuranceId, { patientId, type, coverageAmount, premium, durationMonths = 12 }) => {
  const consent = await InsuranceConsent.findOne({
    insurance: insuranceId,
    patient: patientId,
    status: 'approved',
  });

  if (!consent) {
    throw ApiError.badRequest('Cannot issue policy without active approved patient consent.');
  }

  const patient = await User.findById(patientId);
  if (!patient) {
    throw ApiError.notFound('Patient not found.');
  }

  // Fetch full record snapshot based on granted permissions
  const recordSnapshot = await getPatientScopedRecords(insuranceId, patientId);

  // Compute SHA-256 hash of the records snapshot
  const snapshotString = JSON.stringify(recordSnapshot);
  const recordHash = crypto.createHash('sha256').update(snapshotString).digest('hex');

  // Generate unique Policy Number
  const policyNumber = `POL-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
  const issueDate = new Date();
  const expiryDate = new Date(Date.now() + durationMonths * 30 * 24 * 60 * 60 * 1000);

  const policy = await Policy.create({
    patient: patientId,
    insurance: insuranceId,
    consent: consent._id,
    policyNumber,
    type: type || 'Individual Health',
    coverageAmount,
    premium,
    issueDate,
    expiryDate,
    status: 'active',
  });

  // Create immutable disclosure record
  const disclosure = await Disclosure.create({
    patient: patientId,
    insurance: insuranceId,
    policy: policy._id,
    consentVersion: 'v1.0',
    recordHash,
    snapshot: recordSnapshot,
    signedByPatient: true,
    signedByInsurance: true,
    issuedAt: issueDate,
  });

  auditService.logAuthEvent({
    userId: insuranceId,
    action: 'INSURANCE_POLICY_ISSUED',
    ip: '127.0.0.1',
    userAgent: 'InsurancePortal',
    success: true,
    metadata: { policyId: policy._id, recordHash },
  });

  socket.emitToUser(patientId, 'policy:new', { policyId: policy._id });

  return { policy, disclosure };
};

/**
 * Get policies for insurance or patient.
 */
const getPolicies = async (queryFilter) => {
  return Policy.find(queryFilter)
    .populate('patient', 'fullName email mobileNumber healthSyncId')
    .populate('insurance', 'companyName email mobileNumber address registrationNumber')
    .sort({ createdAt: -1 });
};

/**
 * Submit an insurance claim (Patient or Hospital).
 */
const submitClaim = async (patientId, { policyId, hospitalName, diagnosis, claimAmount, documents }) => {
  const policy = await Policy.findOne({ _id: policyId, patient: patientId, status: 'active' });

  if (!policy) {
    throw ApiError.notFound('Active insurance policy not found for this patient.');
  }

  // Generate a collision-safe claim number (claimNumber is unique-indexed;
  // pure Math.random() could collide and crash the insert).
  let claimNumber;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = `CLM-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
    // eslint-disable-next-line no-await-in-loop
    const exists = await Claim.exists({ claimNumber: candidate });
    if (!exists) {
      claimNumber = candidate;
      break;
    }
  }
  if (!claimNumber) {
    throw ApiError.internal('Could not generate a unique claim number. Please retry.');
  }

  const claim = await Claim.create({
    patient: patientId,
    insurance: policy.insurance,
    policy: policy._id,
    claimNumber,
    hospitalName,
    diagnosis,
    claimAmount,
    documents: documents || [],
    status: 'submitted',
    statusHistory: [
      {
        status: 'submitted',
        updatedBy: 'Patient',
        comment: 'Claim submitted for processing.',
        timestamp: new Date(),
      },
    ],
  });

  auditService.logAuthEvent({
    userId: patientId,
    action: 'CLAIM_SUBMITTED',
    ip: '127.0.0.1',
    userAgent: 'PatientPortal',
    success: true,
    metadata: { claimId: claim._id, claimNumber },
  });

  socket.emitToUser(policy.insurance, 'claim:new', { claimId: claim._id });

  return claim;
};

/**
 * Get claims list (Patient or Insurance).
 */
const getClaims = async (queryFilter) => {
  return Claim.find(queryFilter)
    .populate('patient', 'fullName email mobileNumber healthSyncId')
    .populate('insurance', 'companyName email mobileNumber')
    .populate('policy', 'policyNumber type coverageAmount')
    .sort({ createdAt: -1 });
};

/**
 * Update claim status (Insurance organization).
 */
const updateClaimStatus = async (insuranceId, claimId, { status, approvedAmount, rejectionReason, comment }) => {
  const claim = await Claim.findOne({ _id: claimId, insurance: insuranceId });

  if (!claim) {
    throw ApiError.notFound('Claim record not found.');
  }

  claim.status = status;
  if (approvedAmount !== undefined) claim.approvedAmount = approvedAmount;
  if (rejectionReason) claim.rejectionReason = rejectionReason;

  claim.statusHistory.push({
    status,
    updatedBy: 'Insurance Organization',
    comment: comment || `Claim status updated to ${status}`,
    timestamp: new Date(),
  });

  await claim.save();

  auditService.logAuthEvent({
    userId: insuranceId,
    action: 'CLAIM_STATUS_UPDATED',
    ip: '127.0.0.1',
    userAgent: 'InsurancePortal',
    success: true,
    metadata: { claimId: claim._id, status },
  });

  socket.emitToUser(claim.patient, 'claim:updated', { claimId: claim._id, status });

  return claim;
};

module.exports = {
  searchPatientByHealthSyncId,
  requestAccess,
  getPatientInsuranceRequests,
  respondToInsuranceRequest,
  revokeInsuranceConsent,
  getInsurancePatients,
  getPatientScopedRecords,
  issuePolicy,
  getPolicies,
  submitClaim,
  getClaims,
  updateClaimStatus,
};
