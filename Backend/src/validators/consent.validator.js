/**
 * Consent grant validators.
 */
const { body, param, query } = require('express-validator');
const { RECORD_TYPES, CONSENT_SCOPES } = require('../constants/recordTypes');

const issueConsentValidator = [
  body('scopes')
    .isArray({ min: 1, max: CONSENT_SCOPES.length })
    .withMessage('Select at least one access scope.'),
  body('scopes.*')
    .isIn(CONSENT_SCOPES)
    .withMessage(`Scopes must be one of: ${CONSENT_SCOPES.join(', ')}.`),
  body('durationHours')
    .isInt({ min: 1, max: 168 })
    .withMessage('Duration must be between 1 and 168 hours (7 days).'),
  body('purpose')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 300 })
    .withMessage('Purpose cannot exceed 300 characters.'),
];

const consentIdValidator = [param('consentId').isMongoId().withMessage('Invalid consent id.')];

const claimConsentValidator = [
  body('code')
    .trim()
    .isLength({ min: 6, max: 300 })
    .withMessage('Enter the access code shared by the patient.'),
];

const consentRecordsValidator = [
  ...consentIdValidator,
  query('type')
    .optional({ values: 'falsy' })
    .isIn(RECORD_TYPES)
    .withMessage('Invalid record type filter.'),
];

module.exports = {
  issueConsentValidator,
  consentIdValidator,
  claimConsentValidator,
  consentRecordsValidator,
};
