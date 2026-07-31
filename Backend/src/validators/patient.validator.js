/**
 * Patient profile validators.
 * Validation chains for patient profile update endpoint.
 */
const { body, param, query } = require('express-validator');

/**
 * PATCH /api/patients/profile
 * All fields are optional — only provided fields are validated and updated.
 */
const updateProfileValidator = [
  body('firstName')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('First name must be between 2 and 100 characters.'),

  body('lastName')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Last name must be between 2 and 100 characters.'),

  body('mobileNumber')
    .optional()
    .trim()
    .matches(/^[6-9]\d{9}$/)
    .withMessage('Please provide a valid 10-digit Indian mobile number.'),

  body('dob')
    .optional()
    .isISO8601()
    .withMessage('Date of birth must be a valid ISO 8601 date.')
    .custom((value) => {
      if (new Date(value) >= new Date()) {
        throw new Error('Date of birth must be in the past.');
      }
      return true;
    }),

  body('gender')
    .optional()
    .trim()
    .isIn(['male', 'female', 'other'])
    .withMessage("Gender must be 'male', 'female', or 'other'."),

  body('bloodGroup')
    .optional()
    .trim()
    .isIn(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'])
    .withMessage('Blood group must be one of: A+, A-, B+, B-, AB+, AB-, O+, O-.'),

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

  // ─── Emergency Contact Fields ────────────────────────
  body('emergencyContact.name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Emergency contact name must be between 2 and 100 characters.'),

  body('emergencyContact.relation')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Emergency contact relation must be between 2 and 50 characters.'),

  body('emergencyContact.phone')
    .optional()
    .trim()
    .matches(/^[6-9]\d{9}$/)
    .withMessage('Emergency contact phone must be a valid 10-digit Indian mobile number.'),

  // ─── Clinical Safety Profile ─────────────────────────
  body('allergies')
    .optional()
    .isArray({ max: 30 })
    .withMessage('Allergies must be an array (max 30 entries).'),
  body('allergies.*')
    .optional()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Each allergy must be between 1 and 100 characters.'),

  body('chronicConditions')
    .optional()
    .isArray({ max: 30 })
    .withMessage('Chronic conditions must be an array (max 30 entries).'),
  body('chronicConditions.*')
    .optional()
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Each condition must be between 1 and 200 characters.'),
];

// ─── Hospital linking (consent) ──────────────────────────

/** GET /hospitals?status= */
const listHospitalLinksValidator = [
  query('status')
    .optional()
    .isIn(['pending', 'active', 'rejected', 'discharged'])
    .withMessage('Invalid status filter.'),
];

/** PATCH /hospitals/:linkId/respond */
const respondValidator = [
  param('linkId').isMongoId().withMessage('Invalid link id.'),
  body('action')
    .isIn(['approve', 'reject'])
    .withMessage("Action must be 'approve' or 'reject'."),
];

/** PATCH /hospitals/:linkId/revoke */
const revokeValidator = [
  param('linkId').isMongoId().withMessage('Invalid link id.'),
];

module.exports = {
  updateProfileValidator,
  listHospitalLinksValidator,
  respondValidator,
  revokeValidator,
};
