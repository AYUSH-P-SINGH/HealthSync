/**
 * Follow-up obligation validators.
 *
 * These run before any controller logic, so every id is confirmed to be a
 * real ObjectId and every free-text field is bounded before it reaches the
 * service layer or the database.
 */
const { body, param, query } = require('express-validator');
const { FOLLOWUP_STATUSES, LIMITS } = require('../constants/followUp');

const followUpIdValidator = [
  param('followUpId').isMongoId().withMessage('Invalid follow-up id.'),
];

/**
 * Scan payload. `text` and an uploaded file are alternatives, so neither is
 * unconditionally required — the controller enforces that exactly one is
 * present, since express-validator cannot see multer's file.
 */
const scanValidator = [
  body('text')
    .optional({ values: 'falsy' })
    .isString()
    .withMessage('Report text must be a string.')
    .isLength({ max: LIMITS.MAX_TEXT_CHARS })
    .withMessage(`Report text cannot exceed ${LIMITS.MAX_TEXT_CHARS} characters.`),

  body('recordDate')
    .optional({ values: 'falsy' })
    .isISO8601()
    .withMessage('Report date must be a valid date.')
    .custom((value) => {
      // Intervals are measured FROM this date, so a future anchor would push
      // every derived due date into fiction.
      if (new Date(value) > new Date(Date.now() + 86_400_000)) {
        throw new Error('Report date cannot be in the future.');
      }
      return true;
    }),

  body('sourceRecordId')
    .optional({ values: 'falsy' })
    .isMongoId()
    .withMessage('Invalid source record id.'),

  // Preview-only: extract and show, store nothing.
  body('dryRun').optional().isBoolean().withMessage('dryRun must be true or false.'),
];

const listFollowUpsValidator = [
  query('status')
    .optional({ values: 'falsy' })
    .custom((v) => v === 'active' || FOLLOWUP_STATUSES.includes(v))
    .withMessage(`status must be 'active' or one of: ${FOLLOWUP_STATUSES.join(', ')}.`),
  query('includeResolved')
    .optional({ values: 'falsy' })
    .isBoolean()
    .withMessage('includeResolved must be true or false.'),
];

const confirmValidator = [
  ...followUpIdValidator,
  body('dueAt')
    .optional({ values: 'falsy' })
    .isISO8601()
    .withMessage('Due date must be a valid date.'),
];

const scheduleValidator = [
  ...followUpIdValidator,
  body('scheduledFor')
    .optional({ values: 'falsy' })
    .isISO8601()
    .withMessage('Appointment date must be a valid date.'),
];

/**
 * A dismissal reason is mandatory and meaningfully long. This is the only
 * action that makes a safety alert vanish, so the friction is intentional.
 */
const dismissValidator = [
  ...followUpIdValidator,
  body('reason')
    .trim()
    .isLength({ min: 5, max: 500 })
    .withMessage('Please give a reason for dismissing this follow-up (5–500 characters).'),
];

// ─── Hospital side ───────────────────────────────────────

/**
 * A provider must present exactly one access basis — an active patient link
 * or a claimed consent grant. Accepting neither would let a hospital query
 * by patient id alone; accepting both invites ambiguity about which one was
 * actually relied on, which matters when the audit log is read back later.
 */
const providerScopeValidator = [
  query('linkId').optional({ values: 'falsy' }).isMongoId().withMessage('Invalid link id.'),
  query('consentId').optional({ values: 'falsy' }).isMongoId().withMessage('Invalid consent id.'),
  query().custom((_, { req }) => {
    const hasLink = Boolean(req.query.linkId);
    const hasConsent = Boolean(req.query.consentId);
    if (hasLink === hasConsent) {
      throw new Error('Provide exactly one of linkId or consentId.');
    }
    return true;
  }),
];

const providerActionValidator = [
  ...followUpIdValidator,
  body('linkId').optional({ values: 'falsy' }).isMongoId().withMessage('Invalid link id.'),
  body('consentId').optional({ values: 'falsy' }).isMongoId().withMessage('Invalid consent id.'),
  body('action')
    .isIn(['schedule', 'complete', 'dismiss'])
    .withMessage('Action must be schedule, complete or dismiss.'),
  body('reason')
    .if(body('action').equals('dismiss'))
    .trim()
    .isLength({ min: 5, max: 500 })
    .withMessage('Dismissing a follow-up requires a reason (5–500 characters).'),
  body('scheduledFor').optional({ values: 'falsy' }).isISO8601(),
  body().custom((value) => {
    if (Boolean(value.linkId) === Boolean(value.consentId)) {
      throw new Error('Provide exactly one of linkId or consentId.');
    }
    return true;
  }),
];

module.exports = {
  followUpIdValidator,
  scanValidator,
  listFollowUpsValidator,
  confirmValidator,
  scheduleValidator,
  dismissValidator,
  providerScopeValidator,
  providerActionValidator,
};
