const Claim = require('../models/Claim');
const ClaimMessage = require('../models/ClaimMessage');
const ApiError = require('../utils/ApiError');
const auditService = require('./audit.service');
const emailService = require('./email.service');
const logger = require('../utils/logger');
const socket = require('../socket');

/**
 * Claim Interaction Service
 * ─────────────────────────
 * Two-way patient ↔ insurance communication, scoped to a single claim:
 *  - Secure messaging thread (with read receipts + unread counts)
 *  - Structured document requests & fulfilment
 *  - Formal appeals against claim decisions
 * Every action is audit-logged and triggers an email notification
 * to the counterparty.
 */

// ─── Internal helpers ────────────────────────────────────────────────

/**
 * Load a claim and verify the requester owns their side of it.
 * role: 'patient' | 'insurance'
 */
const getAuthorizedClaim = async (role, userId, claimId) => {
  const filter = role === 'patient'
    ? { _id: claimId, patient: userId }
    : { _id: claimId, insurance: userId };

  const claim = await Claim.findOne(filter)
    .populate('patient', 'fullName email healthSyncId')
    .populate('insurance', 'companyName email');

  if (!claim) {
    throw ApiError.notFound('Claim not found or you are not authorized to access it.');
  }
  return claim;
};

/**
 * Fire-and-forget counterparty notification: email + real-time socket
 * event (`claim:message` or `claim:updated`) to the other side's room.
 */
const notifyCounterparty = (claim, actorRole, title, detail, event = 'claim:updated') => {
  const counterparty = actorRole === 'patient' ? claim.insurance : claim.patient;
  if (!counterparty) return;

  socket.emitToUser(counterparty._id, event, { claimId: claim._id });

  if (!counterparty.email) return;
  emailService
    .sendClaimNotificationEmail({ to: counterparty.email, claimNumber: claim.claimNumber, title, detail })
    .catch((err) => logger.error(`Claim notification email failed: ${err.message}`));
};

const audit = (userId, action, role, metadata) => {
  auditService.logAuthEvent({
    userId,
    action,
    ip: '127.0.0.1',
    userAgent: role === 'patient' ? 'PatientPortal' : 'InsurancePortal',
    success: true,
    metadata,
  });
};

/**
 * Fetch a single claim, scoped to the requester's own side.
 * Used by the frontend to re-pull a claim after a real-time
 * `claim:updated` event, without a full list refetch.
 */
const getClaimById = async (role, userId, claimId) => getAuthorizedClaim(role, userId, claimId);

// ─── Messaging thread ────────────────────────────────────────────────

/**
 * Get the full message thread for a claim, and mark all counterparty
 * messages as read for the viewer's side.
 */
const getMessages = async (role, userId, claimId) => {
  const claim = await getAuthorizedClaim(role, userId, claimId);

  const readField = role === 'patient' ? 'readByPatient' : 'readByInsurance';
  await ClaimMessage.updateMany(
    { claim: claim._id, [readField]: false },
    { $set: { [readField]: true } }
  );

  const messages = await ClaimMessage.find({ claim: claim._id }).sort({ createdAt: 1 });
  return { claim, messages };
};

/**
 * Send a message on the claim thread (patient or insurance).
 */
const sendMessage = async (role, userId, claimId, { body, attachments }) => {
  const claim = await getAuthorizedClaim(role, userId, claimId);

  const senderName =
    role === 'patient'
      ? claim.patient?.fullName || 'Patient'
      : claim.insurance?.companyName || 'Insurance Organization';

  const message = await ClaimMessage.create({
    claim: claim._id,
    sender: userId,
    senderRole: role,
    senderName,
    body,
    attachments: attachments || [],
    readByPatient: role === 'patient',
    readByInsurance: role === 'insurance',
  });

  audit(userId, 'CLAIM_MESSAGE_SENT', role, { claimId: claim._id, messageId: message._id });
  notifyCounterparty(
    claim,
    role,
    `New message from ${senderName}`,
    `"${body.length > 140 ? `${body.slice(0, 140)}…` : body}"`,
    'claim:message'
  );

  return message;
};

/**
 * Per-claim unread message counts for the requesting side.
 * Returns { [claimId]: count } for badge rendering.
 */
const getUnreadCounts = async (role, userId) => {
  const claimFilter = role === 'patient' ? { patient: userId } : { insurance: userId };
  const claimIds = await Claim.find(claimFilter).distinct('_id');

  const readField = role === 'patient' ? 'readByPatient' : 'readByInsurance';
  const rows = await ClaimMessage.aggregate([
    { $match: { claim: { $in: claimIds }, [readField]: false } },
    { $group: { _id: '$claim', count: { $sum: 1 } } },
  ]);

  return rows.reduce((acc, r) => {
    acc[r._id.toString()] = r.count;
    return acc;
  }, {});
};

// ─── Document requests ───────────────────────────────────────────────

/**
 * Insurer raises structured document requests on a claim.
 * items: [{ itemName, note }]
 */
const requestDocuments = async (insuranceId, claimId, items) => {
  const claim = await getAuthorizedClaim('insurance', insuranceId, claimId);

  if (['approved', 'rejected'].includes(claim.status)) {
    throw ApiError.badRequest('Cannot request documents on a finalized claim.');
  }

  items.forEach(({ itemName, note }) => {
    claim.documentRequests.push({ itemName, note: note || '' });
  });

  claim.status = 'more_documents_required';
  claim.statusHistory.push({
    status: 'more_documents_required',
    updatedBy: 'Insurance Organization',
    comment: `Requested ${items.length} document(s): ${items.map((i) => i.itemName).join(', ')}`,
    timestamp: new Date(),
  });

  await claim.save();

  audit(insuranceId, 'CLAIM_DOCUMENTS_REQUESTED', 'insurance', {
    claimId: claim._id,
    items: items.map((i) => i.itemName),
  });
  notifyCounterparty(
    claim,
    'insurance',
    'Documents requested for your claim',
    `Your insurer requires: ${items.map((i) => i.itemName).join(', ')}. Please upload them from your dashboard.`
  );

  return claim;
};

/**
 * Patient fulfils one outstanding document request.
 * When no pending requests remain, the claim automatically
 * returns to 'in_review'.
 */
const fulfillDocumentRequest = async (patientId, claimId, requestId, { name, fileUrl }) => {
  const claim = await getAuthorizedClaim('patient', patientId, claimId);

  const docRequest = claim.documentRequests.id(requestId);
  if (!docRequest) {
    throw ApiError.notFound('Document request not found on this claim.');
  }
  if (docRequest.status === 'fulfilled') {
    throw ApiError.badRequest('This document request has already been fulfilled.');
  }

  docRequest.status = 'fulfilled';
  docRequest.fulfilledAt = new Date();
  docRequest.document = { name, fileUrl };

  // Also attach to the claim's master document list.
  claim.documents.push({ name, fileUrl, uploadedAt: new Date() });

  const stillPending = claim.documentRequests.some((r) => r.status === 'pending');
  if (!stillPending && claim.status === 'more_documents_required') {
    claim.status = 'in_review';
    claim.statusHistory.push({
      status: 'in_review',
      updatedBy: 'Patient',
      comment: 'All requested documents provided. Claim returned to review.',
      timestamp: new Date(),
    });
  }

  await claim.save();

  audit(patientId, 'CLAIM_DOCUMENT_FULFILLED', 'patient', {
    claimId: claim._id,
    requestId,
    itemName: docRequest.itemName,
  });
  notifyCounterparty(
    claim,
    'patient',
    'Requested document uploaded',
    `The patient uploaded "${name}" for the requested item "${docRequest.itemName}".${stillPending ? '' : ' All requested documents are now provided; the claim is back in review.'}`
  );

  return claim;
};

// ─── Appeals ─────────────────────────────────────────────────────────

/**
 * Patient files a formal appeal against a rejected or
 * partially-approved claim.
 */
const fileAppeal = async (patientId, claimId, reason) => {
  const claim = await getAuthorizedClaim('patient', patientId, claimId);

  const partiallyApproved =
    claim.status === 'approved' && claim.approvedAmount < claim.claimAmount;
  if (claim.status !== 'rejected' && !partiallyApproved) {
    throw ApiError.badRequest('Appeals can only be filed against rejected or partially approved claims.');
  }
  if (claim.appeal?.filed) {
    throw ApiError.badRequest('An appeal has already been filed for this claim.');
  }

  claim.appeal = {
    filed: true,
    reason,
    status: 'filed',
    filedAt: new Date(),
    resolvedAt: null,
    resolutionNote: null,
  };
  claim.status = 'appealed';
  claim.statusHistory.push({
    status: 'appealed',
    updatedBy: 'Patient',
    comment: `Appeal filed: ${reason}`,
    timestamp: new Date(),
  });

  await claim.save();

  audit(patientId, 'CLAIM_APPEAL_FILED', 'patient', { claimId: claim._id });
  notifyCounterparty(
    claim,
    'patient',
    'Appeal filed on claim decision',
    `The patient has formally appealed the decision. Reason: ${reason}`
  );

  return claim;
};

/**
 * Insurer progresses / resolves an appeal.
 * status: 'under_review' | 'upheld' (original decision stands)
 *         | 'overturned' (claim approved, approvedAmount required)
 */
const resolveAppeal = async (insuranceId, claimId, { status, resolutionNote, approvedAmount }) => {
  const claim = await getAuthorizedClaim('insurance', insuranceId, claimId);

  if (!claim.appeal?.filed || ['upheld', 'overturned'].includes(claim.appeal.status)) {
    throw ApiError.badRequest('No open appeal exists on this claim.');
  }

  claim.appeal.status = status;

  if (status === 'under_review') {
    claim.statusHistory.push({
      status: 'appealed',
      updatedBy: 'Insurance Organization',
      comment: 'Appeal is under review.',
      timestamp: new Date(),
    });
  } else {
    claim.appeal.resolvedAt = new Date();
    claim.appeal.resolutionNote = resolutionNote || null;

    if (status === 'overturned') {
      if (approvedAmount === undefined || approvedAmount === null) {
        throw ApiError.badRequest('Approved amount is required when overturning a decision.');
      }
      claim.status = 'approved';
      claim.approvedAmount = approvedAmount;
      claim.rejectionReason = null;
    } else {
      // upheld — restore the original final state
      claim.status = 'rejected';
    }

    claim.statusHistory.push({
      status: claim.status,
      updatedBy: 'Insurance Organization',
      comment: `Appeal ${status}. ${resolutionNote || ''}`.trim(),
      timestamp: new Date(),
    });
  }

  await claim.save();

  audit(insuranceId, 'CLAIM_APPEAL_UPDATED', 'insurance', { claimId: claim._id, appealStatus: status });
  notifyCounterparty(
    claim,
    'insurance',
    `Appeal ${status.replace('_', ' ')}`,
    status === 'under_review'
      ? 'Your appeal is now under review by the insurer.'
      : `Your appeal was ${status}. ${resolutionNote || ''}`.trim()
  );

  return claim;
};

module.exports = {
  getClaimById,
  getMessages,
  sendMessage,
  getUnreadCounts,
  requestDocuments,
  fulfillDocumentRequest,
  fileAppeal,
  resolveAppeal,
};
