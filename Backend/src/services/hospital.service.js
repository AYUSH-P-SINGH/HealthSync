/**
 * Hospital service — business logic for hospital profile management.
 * Mirrors patient.service.js. Identity fields (email, registrationNumber,
 * hospitalType) are NOT updatable through the profile endpoint.
 */
const Hospital = require('../models/Hospital');
const HospitalPatient = require('../models/HospitalPatient');
const auditService = require('./audit.service');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

// Fields hospitals may update via PATCH /profile (dot-notation for $set)
const ALLOWED_UPDATE_FIELDS = [
  'name',
  'mobileNumber',
  'website',
  'totalBeds',
  'emergencyAvailable',
  'specialities',
  'address.street',
  'address.city',
  'address.state',
  'address.pincode',
  'address.country',
];

/** Build a flat $set object from the request body. */
const buildUpdateObject = (body) => {
  const update = {};

  for (const field of ALLOWED_UPDATE_FIELDS) {
    const parts = field.split('.');
    const value =
      parts.length === 2 ? body[field] ?? body[parts[0]]?.[parts[1]] : body[field];

    if (value !== undefined) {
      update[field] = value;
    }
  }

  return update;
};

/**
 * Get the full hospital profile.
 */
const getProfile = async (hospitalId) => {
  const hospital = await Hospital.findById(hospitalId);

  if (!hospital) {
    throw ApiError.notFound('Hospital profile not found.');
  }

  return { hospital: hospital.toJSON() };
};

/**
 * Update hospital profile fields.
 */
const updateProfile = async (hospitalId, body, ip, userAgent) => {
  const updateData = buildUpdateObject(body);

  if (Object.keys(updateData).length === 0) {
    throw ApiError.badRequest('No valid fields provided for update.');
  }

  const hospital = await Hospital.findByIdAndUpdate(
    hospitalId,
    { $set: updateData },
    { new: true, runValidators: true }
  );

  if (!hospital) {
    throw ApiError.notFound('Hospital profile not found.');
  }

  auditService.logAuthEvent({
    userId: hospitalId,
    action: 'PROFILE_UPDATED',
    ip,
    userAgent,
    success: true,
    metadata: { updatedFields: Object.keys(updateData), accountType: 'hospital' },
  });

  logger.info('Hospital profile updated', { hospitalId, fields: Object.keys(updateData) });

  return {
    hospital: hospital.toJSON(),
    message: 'Hospital profile updated successfully.',
  };
};

/**
 * Get dashboard summary — profile completeness + counts.
 * Patient/appointment/record counts are placeholders until the
 * Hospital<->Patient relationship models exist.
 */
const getDashboardSummary = async (hospitalId) => {
  const hospital = await Hospital.findById(hospitalId);

  if (!hospital) {
    throw ApiError.notFound('Hospital profile not found.');
  }

  const profileFields = [
    hospital.name,
    hospital.email,
    hospital.mobileNumber,
    hospital.registrationNumber,
    hospital.hospitalType,
    hospital.address?.street,
    hospital.address?.city,
    hospital.address?.state,
    hospital.address?.pincode,
    hospital.address?.country,
    hospital.specialities?.length ? 'set' : '',
    hospital.totalBeds > 0 ? 'set' : '',
    hospital.website,
  ];

  const filledCount = profileFields.filter(
    (val) => val !== null && val !== undefined && val !== ''
  ).length;
  const completenessPercent = Math.round((filledCount / profileFields.length) * 100);

  const [totalPatients, pendingRequests] = await Promise.all([
    HospitalPatient.countDocuments({ hospital: hospitalId, status: 'active' }),
    HospitalPatient.countDocuments({ hospital: hospitalId, status: 'pending' }),
  ]);

  // Appointment/record counts remain placeholders until those models exist.
  return {
    hospital: hospital.toJSON(),
    dashboard: {
      profileCompleteness: completenessPercent,
      totalPatients,
      pendingRequests,
      upcomingAppointments: 0,
      totalRecords: 0,
    },
  };
};

module.exports = {
  getProfile,
  updateProfile,
  getDashboardSummary,
};
