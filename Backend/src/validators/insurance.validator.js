const { body, param, query } = require('express-validator');

const searchPatientValidator = [
  param('healthSyncId')
    .trim()
    .notEmpty()
    .withMessage('HealthSync ID is required.')
    .isLength({ min: 6, max: 20 })
    .withMessage('Invalid HealthSync ID format.'),
];

const requestAccessValidator = [
  body('healthSyncId')
    .trim()
    .notEmpty()
    .withMessage('HealthSync ID is required.'),
  body('purpose')
    .trim()
    .notEmpty()
    .withMessage('Purpose for requesting access is required.'),
  body('permissions')
    .optional()
    .isArray()
    .withMessage('Permissions must be an array of string permissions.'),
];

const respondConsentValidator = [
  param('linkId').isMongoId().withMessage('Invalid consent request ID.'),
  body('action')
    .trim()
    .notEmpty()
    .isIn(['approve', 'reject'])
    .withMessage("Action must be either 'approve' or 'reject'."),
];

const issuePolicyValidator = [
  body('patientId').isMongoId().withMessage('Valid patient ID is required.'),
  body('coverageAmount')
    .isNumeric()
    .withMessage('Coverage amount must be a number.')
    .custom((val) => val >= 10000)
    .withMessage('Minimum coverage amount is ₹10,000.'),
  body('premium')
    .isNumeric()
    .withMessage('Premium amount must be a number.')
    .custom((val) => val >= 0)
    .withMessage('Premium cannot be negative.'),
];

const submitClaimValidator = [
  body('policyId').isMongoId().withMessage('Valid policy ID is required.'),
  body('hospitalName').trim().notEmpty().withMessage('Hospital name is required.'),
  body('diagnosis').trim().notEmpty().withMessage('Diagnosis/Reason for claim is required.'),
  body('claimAmount')
    .isNumeric()
    .withMessage('Claim amount must be a number.')
    .custom((val) => val >= 100)
    .withMessage('Minimum claim amount is ₹100.'),
];

const updateClaimValidator = [
  param('claimId').isMongoId().withMessage('Valid claim ID is required.'),
  body('status')
    .trim()
    .notEmpty()
    .isIn(['submitted', 'in_review', 'approved', 'rejected', 'more_documents_required'])
    .withMessage('Invalid claim status.'),
];

module.exports = {
  searchPatientValidator,
  requestAccessValidator,
  respondConsentValidator,
  issuePolicyValidator,
  submitClaimValidator,
  updateClaimValidator,
};
