/**
 * Hospital profile validators.
 * Validation chains for the hospital profile update endpoint.
 * All fields are optional — only provided fields are validated and updated.
 */
const { body, param, query } = require('express-validator');

const updateHospitalProfileValidator = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 3, max: 200 })
    .withMessage('Hospital name must be between 3 and 200 characters.'),

  body('mobileNumber')
    .optional()
    .trim()
    .matches(/^[6-9]\d{9}$/)
    .withMessage('Please provide a valid 10-digit Indian mobile number.'),

  body('website')
    .optional({ values: 'falsy' })
    .trim()
    .isURL({ require_protocol: false })
    .withMessage('Please provide a valid website URL.'),

  body('totalBeds')
    .optional()
    .isInt({ min: 0, max: 100000 })
    .withMessage('Total beds must be a non-negative number.')
    .toInt(),

  body('emergencyAvailable')
    .optional()
    .isBoolean()
    .withMessage('Emergency availability must be true or false.')
    .toBoolean(),

  body('specialities')
    .optional()
    .isArray({ max: 50 })
    .withMessage('Specialities must be a list of up to 50 items.'),

  body('specialities.*')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Each speciality must be between 2 and 100 characters.'),

  // ─── Address Fields ──────────────────────────────────
  body('address.street')
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage('Street address cannot exceed 200 characters.'),

  body('address.city')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('City cannot exceed 100 characters.'),

  body('address.state')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('State cannot exceed 100 characters.'),

  body('address.pincode')
    .optional()
    .trim()
    .matches(/^\d{6}$/)
    .withMessage('Please provide a valid 6-digit pincode.'),

  body('address.country')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Country cannot exceed 100 characters.'),
];

// ─── Patient linking ─────────────────────────────────────

/** POST /patients/lookup and POST /patients — { query: PatientID | email } */
const patientQueryValidator = [
  body('query')
    .trim()
    .notEmpty()
    .withMessage('Provide a Patient ID (HS-XXXXXXXX) or email address.')
    .isLength({ max: 254 })
    .withMessage('Query is too long.'),
];

/** GET /patients?status= */
const listPatientsValidator = [
  query('status')
    .optional()
    .isIn(['pending', 'active', 'rejected', 'discharged'])
    .withMessage('Invalid status filter.'),
];

/** PATCH /patients/:linkId/discharge */
const linkIdValidator = [
  param('linkId').isMongoId().withMessage('Invalid link id.'),
];

module.exports = {
  updateHospitalProfileValidator,
  patientQueryValidator,
  listPatientsValidator,
  linkIdValidator,
};
