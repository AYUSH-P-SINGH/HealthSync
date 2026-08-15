const { Router } = require('express');
const { body } = require('express-validator');
const aiController = require('../controllers/ai.controller');
const authenticate = require('../middleware/authenticate');
const validate = require('../middleware/validate');

const router = Router();

// POST /api/ai/ask — Authenticated RAG query endpoint
router.post(
  '/ask',
  authenticate,
  [
    body('query')
      .trim()
      .notEmpty()
      .withMessage('Query question is required.')
      .isLength({ max: 500 })
      .withMessage('Query cannot exceed 500 characters.'),
  ],
  validate,
  aiController.askAI
);

module.exports = router;
