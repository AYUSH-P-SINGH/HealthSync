const { body, param } = require('express-validator');

const claimIdParam = param('claimId').isMongoId().withMessage('Valid claim ID is required.');

const sendMessageValidator = [
  claimIdParam,
  body('body')
    .trim()
    .notEmpty()
    .withMessage('Message body is required.')
    .isLength({ max: 2000 })
    .withMessage('Message cannot exceed 2000 characters.'),
  body('attachments').optional().isArray().withMessage('Attachments must be an array.'),
  body('attachments.*.name').optional().trim().notEmpty(),
  body('attachments.*.fileUrl').optional().trim().notEmpty(),
];

const getMessagesValidator = [claimIdParam];

const requestDocumentsValidator = [
  claimIdParam,
  body('items')
    .isArray({ min: 1 })
    .withMessage('At least one document item is required.'),
  body('items.*.itemName')
    .trim()
    .notEmpty()
    .withMessage('Each document request needs an item name.'),
  body('items.*.note').optional().trim(),
];

const fulfillDocumentValidator = [
  claimIdParam,
  param('requestId').isMongoId().withMessage('Valid document request ID is required.'),
  body('name').trim().notEmpty().withMessage('Document name is required.'),
  body('fileUrl').trim().notEmpty().withMessage('Document file URL is required.'),
];

const fileAppealValidator = [
  claimIdParam,
  body('reason')
    .trim()
    .notEmpty()
    .withMessage('Appeal reason is required.')
    .isLength({ min: 20, max: 1000 })
    .withMessage('Appeal reason must be between 20 and 1000 characters.'),
];

const resolveAppealValidator = [
  claimIdParam,
  body('status')
    .trim()
    .isIn(['under_review', 'upheld', 'overturned'])
    .withMessage('Invalid appeal status.'),
  body('resolutionNote').optional().trim(),
  body('approvedAmount').optional().isFloat({ min: 0 }).withMessage('Approved amount must be a positive number.'),
];

module.exports = {
  sendMessageValidator,
  getMessagesValidator,
  requestDocumentsValidator,
  fulfillDocumentValidator,
  fileAppealValidator,
  resolveAppealValidator,
};
