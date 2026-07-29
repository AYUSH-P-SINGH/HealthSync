/**
 * Patient service — core business logic for patient profile management.
 * The User model IS the patient; no separate Patient collection exists.
 */
const fs = require('fs');
const path = require('path');
const User = require('../models/User');
const HospitalPatient = require('../models/HospitalPatient');
const auditService = require('./audit.service');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const MESSAGES = require('../constants/messages');

// Fields that patients are allowed to update via PATCH /profile
const ALLOWED_UPDATE_FIELDS = [
  'fullName.firstName',
  'fullName.lastName',
  'mobileNumber',
  'dob',
  'gender',
  'bloodGroup',
  'address.street',
  'address.city',
  'address.state',
  'address.pincode',
  'address.country',
  'emergencyContact.name',
  'emergencyContact.relation',
  'emergencyContact.phone',
];

/**
 * Build a flat update object from nested dot-notation keys.
 * e.g. { 'fullName.firstName': 'John' } stays as-is for $set.
 */
const buildUpdateObject = (body) => {
  const update = {};

  // Flat aliases: the public API (and patient.validator.js) accept
  // `firstName` / `lastName` at the top level; map them onto the nested
  // fullName paths so they aren't silently dropped.
  if (body.firstName !== undefined) update['fullName.firstName'] = body.firstName;
  if (body.lastName !== undefined) update['fullName.lastName'] = body.lastName;

  for (const field of ALLOWED_UPDATE_FIELDS) {
    // Support both dot-notation keys in body and nested object access
    const parts = field.split('.');
    let value;

    if (parts.length === 2) {
      // Nested field: check both body['address.street'] and body.address?.street
      value = body[field] ?? body[parts[0]]?.[parts[1]];
    } else {
      value = body[field];
    }

    if (value !== undefined) {
      update[field] = value;
    }
  }

  return update;
};

/**
 * Get full patient profile.
 */
const getProfile = async (userId) => {
  const user = await User.findById(userId);

  if (!user) {
    throw ApiError.notFound(MESSAGES.PROFILE_NOT_FOUND);
  }

  return { user: user.toJSON() };
};

/**
 * Update patient profile fields.
 */
const updateProfile = async (userId, body, ip, userAgent) => {
  const updateData = buildUpdateObject(body);

  if (Object.keys(updateData).length === 0) {
    throw ApiError.badRequest('No valid fields provided for update.');
  }

  const user = await User.findByIdAndUpdate(
    userId,
    { $set: updateData },
    { new: true, runValidators: true }
  );

  if (!user) {
    throw ApiError.notFound(MESSAGES.PROFILE_NOT_FOUND);
  }

  auditService.logAuthEvent({
    userId,
    action: 'PROFILE_UPDATED',
    ip,
    userAgent,
    success: true,
    metadata: { updatedFields: Object.keys(updateData) },
  });

  logger.info('Patient profile updated', { userId, fields: Object.keys(updateData) });

  return {
    user: user.toJSON(),
    message: MESSAGES.PROFILE_UPDATED,
  };
};

/**
 * Upload / replace profile picture.
 * Deletes the previous file from disk if one exists.
 */
const uploadProfilePicture = async (userId, file, ip, userAgent) => {
  if (!file) {
    throw ApiError.badRequest('No file uploaded. Please attach an image.');
  }

  const user = await User.findById(userId);

  if (!user) {
    // Clean up the uploaded file since the user doesn't exist
    fs.unlink(file.path, () => { });
    throw ApiError.notFound(MESSAGES.PROFILE_NOT_FOUND);
  }

  // Delete old profile picture from disk
  if (user.profilePicture) {
    const oldPath = path.resolve(user.profilePicture);
    fs.unlink(oldPath, (err) => {
      if (err && err.code !== 'ENOENT') {
        logger.warn('Failed to delete old profile picture', { oldPath, error: err.message });
      }
    });
  }

  // Store the relative path (e.g. uploads/profiles/userId-timestamp.jpg)
  user.profilePicture = file.path.replace(/\\/g, '/');
  await user.save();

  auditService.logAuthEvent({
    userId,
    action: 'PROFILE_PICTURE_UPLOADED',
    ip,
    userAgent,
    success: true,
  });

  logger.info('Profile picture uploaded', { userId });

  return {
    user: user.toJSON(),
    message: MESSAGES.PROFILE_PICTURE_UPLOADED,
  };
};

/**
 * Delete profile picture from disk and clear the field.
 */
const deleteProfilePicture = async (userId, ip, userAgent) => {
  const user = await User.findById(userId);

  if (!user) {
    throw ApiError.notFound(MESSAGES.PROFILE_NOT_FOUND);
  }

  if (!user.profilePicture) {
    throw ApiError.badRequest('No profile picture to delete.');
  }

  // Delete file from disk
  const filePath = path.resolve(user.profilePicture);
  fs.unlink(filePath, (err) => {
    if (err && err.code !== 'ENOENT') {
      logger.warn('Failed to delete profile picture file', { filePath, error: err.message });
    }
  });

  user.profilePicture = null;
  await user.save();

  auditService.logAuthEvent({
    userId,
    action: 'PROFILE_PICTURE_DELETED',
    ip,
    userAgent,
    success: true,
  });

  logger.info('Profile picture deleted', { userId });

  return {
    user: user.toJSON(),
    message: MESSAGES.PROFILE_PICTURE_DELETED,
  };
};

/**
 * Get dashboard summary — profile completeness + placeholder counts.
 * Appointment and MedicalRecord counts will be wired in once those models exist.
 */
const getDashboardSummary = async (userId) => {
  const user = await User.findById(userId);

  if (!user) {
    throw ApiError.notFound(MESSAGES.PROFILE_NOT_FOUND);
  }

  // ─── Profile Completeness ────────────────────────────
  const profileFields = [
    user.fullName?.firstName,
    user.fullName?.lastName,
    user.email,
    user.mobileNumber,
    user.dob,
    user.gender,
    user.bloodGroup,
    user.address?.street,
    user.address?.city,
    user.address?.state,
    user.address?.pincode,
    user.emergencyContact?.name,
    user.emergencyContact?.relation,
    user.emergencyContact?.phone,
    user.profilePicture,
  ];

  const filledCount = profileFields.filter(
    (val) => val !== null && val !== undefined && val !== ''
  ).length;
  const completenessPercent = Math.round((filledCount / profileFields.length) * 100);

  // ─── Counts ──────────────────────────────────────────
  // Appointment/record/prescription counts remain placeholders until those
  // models exist; hospital-link counts are real.
  const [linkedHospitals, pendingHospitalRequests] = await Promise.all([
    HospitalPatient.countDocuments({ patient: userId, status: 'active' }),
    HospitalPatient.countDocuments({ patient: userId, status: 'pending' }),
  ]);

  const upcomingAppointments = 0;
  const totalRecords = 0;
  const activePrescriptions = 0;

  return {
    user: user.toJSON(),
    dashboard: {
      profileCompleteness: completenessPercent,
      upcomingAppointments,
      totalRecords,
      activePrescriptions,
      linkedHospitals,
      pendingHospitalRequests,
    },
  };
};

module.exports = {
  getProfile,
  updateProfile,
  uploadProfilePicture,
  deleteProfilePicture,
  getDashboardSummary,
};
