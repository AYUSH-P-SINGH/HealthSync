/**
 * Auth routes.
 * All routes prefixed with /api/auth (mounted in routes/index.js).
 */
const { Router } = require('express');
const authController = require('../controllers/auth.controller');
const authenticate = require('../middleware/authenticate');
const validate = require('../middleware/validate');
const {
  authLimiter,
  registerLimiter,
  forgotPasswordLimiter,
  emailVerificationLimiter,
} = require('../middleware/rateLimiter');
const {
  registerValidator,
  registerHospitalValidator,
  registerInsuranceValidator,
  loginValidator,
  verifyEmailValidator,
  resendVerificationValidator,
  forgotPasswordValidator,
  resetPasswordValidator,
  changePasswordValidator,
} = require('../validators/auth.validator');

const router = Router();

// ─── Public Routes ─────────────────────────────────────

// Register a new user
router.post(
  '/register',
  registerLimiter,
  registerValidator,
  validate,
  authController.register
);

// Register a new hospital
router.post(
  '/register/hospital',
  registerLimiter,
  registerHospitalValidator,
  validate,
  authController.registerHospital
);

// Register a new insurance company
router.post(
  '/register/insurance',
  registerLimiter,
  registerInsuranceValidator,
  validate,
  authController.registerInsurance
);

// Login
router.post(
  '/login',
  authLimiter,
  loginValidator,
  validate,
  authController.login
);

// Refresh access token
router.post(
  '/refresh',
  authController.refresh
);

// Verify Email
router.post(
  '/verify-email',
  emailVerificationLimiter,
  verifyEmailValidator,
  validate,
  authController.verifyEmail
);

// Resend Email Verification Token
router.post(
  '/resend-verification',
  emailVerificationLimiter,
  resendVerificationValidator,
  validate,
  authController.resendVerification
);

// Request Password Reset Link
router.post(
  '/forgot-password',
  forgotPasswordLimiter,
  forgotPasswordValidator,
  validate,
  authController.forgotPassword
);

// Reset Password using Token
router.post(
  '/reset-password',
  forgotPasswordLimiter,
  resetPasswordValidator,
  validate,
  authController.resetPassword
);

// ─── Protected Routes ──────────────────────────────────

// Logout current session
router.post(
  '/logout',
  authenticate,
  authController.logout
);

// Logout all sessions/devices
router.post(
  '/logout/all',
  authenticate,
  authController.logoutAll
);

// Change Password (authenticated)
router.post(
  '/change-password',
  authenticate,
  authLimiter,
  changePasswordValidator,
  validate,
  authController.changePassword
);

// Get current user profile
router.get(
  '/me',
  authenticate,
  authController.getMe
);

module.exports = router;
