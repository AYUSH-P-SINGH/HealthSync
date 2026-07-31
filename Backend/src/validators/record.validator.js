/**
 * Medical record validators.
 */
const { body, param, query } = require('express-validator');
const { RECORD_TYPES } = require('../constants/recordTypes');

const recordBodyValidator = [
  body('type')
    .isIn(RECORD_TYPES)
    .withMessage(`Record type must be one of: ${RECORD_TYPES.join(', ')}.`),

  body('title')
    .trim()
    .isLength({ min: 2, max: 200 })
    .withMessage('Title must be between 2 and 200 characters.'),

  body('description')
    .optional()
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Description cannot exceed 2000 characters.'),

  body('condition')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 200 })
    .withMessage('Condition cannot exceed 200 characters.'),

  body('doctorName')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 200 })
    .withMessage('Doctor name cannot exceed 200 characters.'),

  body('recordDate')
    .optional({ values: 'falsy' })
    .isISO8601()
    .withMessage('Record date must be a valid date.')
    .custom((value) => {
      if (new Date(value) > new Date(Date.now() + 24 * 60 * 60 * 1000)) {
        throw new Error('Record date cannot be in the future.');
      }
      return true;
    }),

  // Prescription payload
  body('medicines')
    .optional()
    .isArray({ max: 20 })
    .withMessage('Medicines must be an array (max 20 entries).'),
  body('medicines.*.name')
    .if(body('medicines').exists())
    .trim()
    .isLength({ min: 2, max: 200 })
    .withMessage('Each medicine needs a name (2–200 characters).'),
  body('medicines.*.dosage').optional().trim().isLength({ max: 100 }),
  body('medicines.*.frequency').optional().trim().isLength({ max: 100 }),
  body('medicines.*.duration').optional().trim().isLength({ max: 100 }),
  body('medicines.*.notes').optional().trim().isLength({ max: 300 }),

  // Lab report payload
  body('labResults')
    .optional()
    .isArray({ max: 50 })
    .withMessage('Lab results must be an array (max 50 entries).'),
  body('labResults.*.name')
    .if(body('labResults').exists())
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Each lab result needs a test name.'),
  body('labResults.*.value').optional().trim().isLength({ max: 100 }),
  body('labResults.*.unit').optional().trim().isLength({ max: 50 }),
  body('labResults.*.referenceRange').optional().trim().isLength({ max: 100 }),
  body('labResults.*.flag')
    .optional({ values: 'falsy' })
    .isIn(['normal', 'low', 'high', 'critical'])
    .withMessage('Lab flag must be normal, low, high, or critical.'),

  // Prescription must actually carry medicines
  body().custom((value) => {
    if (value.type === 'prescription' && (!Array.isArray(value.medicines) || value.medicines.length === 0)) {
      throw new Error('A prescription needs at least one medicine.');
    }
    return true;
  }),
];

const listRecordsValidator = [
  query('type').optional({ values: 'falsy' }).isIn(RECORD_TYPES).withMessage('Invalid record type filter.'),
  query('hospitalId')
    .optional({ values: 'falsy' })
    .custom((v) => v === 'self' || /^[0-9a-fA-F]{24}$/.test(v))
    .withMessage("hospitalId must be a valid id or 'self'."),
  query('condition').optional({ values: 'falsy' }).trim().isLength({ max: 200 }),
  query('q').optional({ values: 'falsy' }).trim().isLength({ max: 200 }),
  query('from').optional({ values: 'falsy' }).isISO8601().withMessage('from must be a valid date.'),
  query('to').optional({ values: 'falsy' }).isISO8601().withMessage('to must be a valid date.'),
];

const recordIdValidator = [param('recordId').isMongoId().withMessage('Invalid record id.')];

const updateRecordValidator = [
  ...recordIdValidator,
  body('title').optional().trim().isLength({ min: 2, max: 200 }),
  body('description').optional().trim().isLength({ max: 2000 }),
  body('condition').optional({ values: 'falsy' }).trim().isLength({ max: 200 }),
  body('doctorName').optional({ values: 'falsy' }).trim().isLength({ max: 200 }),
  body('recordDate').optional({ values: 'falsy' }).isISO8601(),
  body('medicines').optional().isArray({ max: 20 }),
  body('labResults').optional().isArray({ max: 50 }),
];

const prescriptionStatusValidator = [
  ...recordIdValidator,
  body('active').isBoolean().withMessage("'active' must be true or false."),
];

const linkRecordValidator = [
  param('linkId').isMongoId().withMessage('Invalid link id.'),
  ...recordBodyValidator,
];

const linkRecordsListValidator = [
  param('linkId').isMongoId().withMessage('Invalid link id.'),
  ...listRecordsValidator,
];

module.exports = {
  recordBodyValidator,
  listRecordsValidator,
  recordIdValidator,
  updateRecordValidator,
  prescriptionStatusValidator,
  linkRecordValidator,
  linkRecordsListValidator,
};
