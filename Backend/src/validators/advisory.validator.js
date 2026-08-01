/**
 * Health advisory validators (admin publishing).
 */
const { body, param } = require('express-validator');

const SEVERITIES = ['info', 'advisory', 'warning', 'critical'];

const createAdvisoryValidator = [
  body('title')
    .trim()
    .isLength({ min: 5, max: 200 })
    .withMessage('Title must be between 5 and 200 characters.'),
  body('summary')
    .optional()
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Summary cannot exceed 2000 characters.'),
  body('severity')
    .optional()
    .isIn(SEVERITIES)
    .withMessage(`Severity must be one of: ${SEVERITIES.join(', ')}.`),
  body('region')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 200 })
    .withMessage('Region cannot exceed 200 characters.'),
  body('precautions')
    .optional()
    .isArray({ max: 15 })
    .withMessage('Precautions must be an array (max 15).'),
  body('precautions.*')
    .optional()
    .trim()
    .isLength({ max: 300 })
    .withMessage('Each precaution cannot exceed 300 characters.'),
  body('expiresAt')
    .optional({ values: 'falsy' })
    .isISO8601()
    .withMessage('Expiry must be a valid date.'),
];

const advisoryIdValidator = [param('advisoryId').isMongoId().withMessage('Invalid advisory id.')];

const updateAdvisoryValidator = [
  ...advisoryIdValidator,
  body('title').optional().trim().isLength({ min: 5, max: 200 }),
  body('summary').optional().trim().isLength({ max: 2000 }),
  body('severity').optional().isIn(SEVERITIES),
  body('region').optional({ values: 'falsy' }).trim().isLength({ max: 200 }),
  body('precautions').optional().isArray({ max: 15 }),
  body('isActive').optional().isBoolean().withMessage('isActive must be a boolean.'),
  body('expiresAt').optional({ values: 'falsy' }).isISO8601(),
];

module.exports = { createAdvisoryValidator, advisoryIdValidator, updateAdvisoryValidator };
