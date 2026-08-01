/**
 * Auth route validators.
 * Validation chains for each auth endpoint using express-validator.
 */
const { body } = require('express-validator');
const { passwordValidation, getPasswordSchema } = require('./password.validator');

/**
 * POST /api/auth/register
 */
const registerValidator = [
  body('firstName')
    .trim()
    .notEmpty()
    .withMessage('First name is required.')
    .isLength({ min: 2, max: 100 })
    .withMessage('First name must be between 2 and 100 characters.'),

  body('lastName')
    .trim()
    .notEmpty()
    .withMessage('Last name is required.')
    .isLength({ min: 2, max: 100 })
    .withMessage('Last name must be between 2 and 100 characters.'),

  body('email')
    .trim()
    .notEmpty()
    .withMessage('Email is required.')
    .isEmail()
    .withMessage('Please provide a valid email address.')
    .normalizeEmail(),

  body('mobileNumber')
    .trim()
    .notEmpty()
    .withMessage('Mobile number is required.')
    .matches(/^[6-9]\d{9}$/)
    .withMessage('Please provide a valid 10-digit Indian mobile number.'),

  passwordValidation,
];

/**
 * POST /api/auth/register/hospital
 */
const registerHospitalValidator = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Hospital name is required.')
    .isLength({ min: 3, max: 200 })
    .withMessage('Hospital name must be between 3 and 200 characters.'),

  body('email')
    .trim()
    .notEmpty()
    .withMessage('Email is required.')
    .isEmail()
    .withMessage('Please provide a valid email address.')
    .normalizeEmail(),

  body('mobileNumber')
    .trim()
    .notEmpty()
    .withMessage('Mobile number is required.')
    .matches(/^[6-9]\d{9}$/)
    .withMessage('Please provide a valid 10-digit Indian mobile number.'),

  body('registrationNumber')
    .trim()
    .notEmpty()
    .withMessage('Hospital registration number is required.'),

  body('hospitalType')
    .trim()
    .notEmpty()
    .withMessage('Hospital type is required.')
    .isIn(['government', 'private', 'trust', 'clinic', 'multi-speciality'])
    .withMessage('Hospital type must be one of: government, private, trust, clinic, multi-speciality.'),

  body('street').trim().notEmpty().withMessage('Street address is required.'),
  body('city').trim().notEmpty().withMessage('City is required.'),
  body('state').trim().notEmpty().withMessage('State is required.'),

  body('pincode')
    .trim()
    .notEmpty()
    .withMessage('Pincode is required.')
    .matches(/^\d{6}$/)
    .withMessage('Please provide a valid 6-digit pincode.'),

  passwordValidation,
];

/**
 * POST /api/auth/login
 */
const loginValidator = [
  body('email')
    .trim()
    .notEmpty()
    .withMessage('Email is required.')
    .isEmail()
    .withMessage('Please provide a valid email address.')
    .normalizeEmail(),

  body('password')
    .trim()
    .notEmpty()
    .withMessage('Password is required.'),

  body('role')
    .optional()
    .trim()
    .isIn(['user', 'hospital', 'insurance', 'admin'])
    .withMessage("Role must be 'user', 'hospital', 'insurance', or 'admin'."),
];

/**
 * POST /api/auth/verify-email
 */
const verifyEmailValidator = [
  body('token')
    .trim()
    .notEmpty()
    .withMessage('Verification token is required.'),
];

/**
 * POST /api/auth/resend-verification
 */
const resendVerificationValidator = [
  body('email')
    .trim()
    .notEmpty()
    .withMessage('Email address is required.')
    .isEmail()
    .withMessage('Please provide a valid email address.')
    .normalizeEmail(),
];

/**
 * POST /api/auth/forgot-password
 */
const forgotPasswordValidator = [
  body('email')
    .trim()
    .notEmpty()
    .withMessage('Email address is required.')
    .isEmail()
    .withMessage('Please provide a valid email address.')
    .normalizeEmail(),
];

/**
 * POST /api/auth/reset-password
 */
const resetPasswordValidator = [
  body('token')
    .trim()
    .notEmpty()
    .withMessage('Password reset token is required.'),
  passwordValidation,
];

/**
 * POST /api/auth/change-password
 */
const changePasswordValidator = [
  body('currentPassword')
    .trim()
    .notEmpty()
    .withMessage('Current password is required.'),
  getPasswordSchema('newPassword'),
];

/**
 * POST /api/auth/register/insurance
 */
const registerInsuranceValidator = [
  body('companyName')
    .trim()
    .notEmpty()
    .withMessage('Insurance company name is required.')
    .isLength({ min: 3, max: 200 })
    .withMessage('Company name must be between 3 and 200 characters.'),

  body('email')
    .trim()
    .notEmpty()
    .withMessage('Email is required.')
    .isEmail()
    .withMessage('Please provide a valid email address.')
    .normalizeEmail(),

  body('mobileNumber')
    .trim()
    .notEmpty()
    .withMessage('Contact mobile number is required.')
    .matches(/^[6-9]\d{9}$/)
    .withMessage('Please provide a valid 10-digit Indian mobile number.'),

  body('registrationNumber')
    .trim()
    .notEmpty()
    .withMessage('IRDAI registration number is required.'),

  body('street').trim().notEmpty().withMessage('Street address is required.'),
  body('city').trim().notEmpty().withMessage('City is required.'),
  body('state').trim().notEmpty().withMessage('State is required.'),

  body('pincode')
    .trim()
    .notEmpty()
    .withMessage('Pincode is required.')
    .matches(/^\d{6}$/)
    .withMessage('Please provide a valid 6-digit pincode.'),

  passwordValidation,
];

module.exports = {
  registerValidator,
  registerHospitalValidator,
  registerInsuranceValidator,
  loginValidator,
  verifyEmailValidator,
  resendVerificationValidator,
  forgotPasswordValidator,
  resetPasswordValidator,
  changePasswordValidator,
};
