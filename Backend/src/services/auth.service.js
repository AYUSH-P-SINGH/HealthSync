/**
 * Auth service — core business logic for authentication.
 * Controllers delegate all logic here.
 */
const crypto = require('crypto');
const UAParser = require('ua-parser-js');
const User = require('../models/User');
const Hospital = require('../models/Hospital');
const Insurance = require('../models/Insurance');
const Admin = require('../models/Admin');
const tokenService = require('./token.service');
const auditService = require('./audit.service');
const emailService = require('./email.service');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const MESSAGES = require('../constants/messages');
const ROLES = require('../constants/roles');

// Helper to hash tokens with SHA-256
const hashToken = (token) => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

// Email verification is enforced when SMTP is configured, and always under
// NODE_ENV=test (the test suite exercises the full verification flow).
// Otherwise (dev without SMTP) accounts are auto-verified, since no
// verification email can actually be delivered.
const isVerificationEnforced = () =>
  emailService.isEmailConfigured() || process.env.NODE_ENV === 'test';

// Helper to parse device from user agent
const parseDevice = (userAgent) => {
  if (!userAgent) return 'Unknown';
  const parser = new UAParser(userAgent);
  const result = parser.getResult();
  return result.device.type ? result.device.type : 'Desktop';
};

/**
 * Register a new user.
 */
const register = async (userData, ip, userAgent) => {
  const { firstName, lastName, email, mobileNumber, password } = userData;

  // Check if email already exists
  const existingEmail = await User.findOne({ email });
  if (existingEmail) {
    throw ApiError.conflict(MESSAGES.USER_ALREADY_EXISTS);
  }

  // Check if mobile number already exists
  const existingMobile = await User.findOne({ mobileNumber });
  if (existingMobile) {
    throw ApiError.conflict(MESSAGES.MOBILE_ALREADY_EXISTS);
  }

  const emailEnabled = isVerificationEnforced();

  // Generate Email Verification Token
  const rawVerificationToken = crypto.randomBytes(32).toString('hex');
  const hashedVerificationToken = hashToken(rawVerificationToken);
  const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  // Create user (unverified initially when email is enabled)
  const user = await User.create({
    fullName: { firstName, lastName },
    email,
    mobileNumber,
    password,
    isVerified: !emailEnabled,
    verificationToken: emailEnabled ? hashedVerificationToken : null,
    verificationExpiry: emailEnabled ? verificationExpiry : null,
  });

  if (emailEnabled) {
    // Send email (non-blocking)
    emailService.sendVerificationEmail(email, rawVerificationToken);
  } else {
    logger.warn('SMTP not configured — account auto-verified (dev mode)', { email });
  }

  // Audit log
  auditService.logAuthEvent({
    userId: user._id,
    action: 'REGISTER',
    ip,
    userAgent,
    success: true,
  });

  logger.info('User registered', { userId: user._id, email });

  return {
    user: user.toJSON(),
    message: MESSAGES.REGISTER_SUCCESS,
  };
};

/**
 * Register a new hospital account.
 */
const registerHospital = async (hospitalData, ip, userAgent) => {
  const {
    name,
    email,
    mobileNumber,
    password,
    registrationNumber,
    hospitalType,
    street,
    city,
    state,
    pincode,
    country,
  } = hospitalData;

  const existingEmail = await Hospital.findOne({ email });
  if (existingEmail) {
    throw ApiError.conflict(MESSAGES.HOSPITAL_ALREADY_EXISTS);
  }

  const existingMobile = await Hospital.findOne({ mobileNumber });
  if (existingMobile) {
    throw ApiError.conflict(MESSAGES.HOSPITAL_MOBILE_ALREADY_EXISTS);
  }

  const existingRegistrationNumber = await Hospital.findOne({ registrationNumber });
  if (existingRegistrationNumber) {
    throw ApiError.conflict(MESSAGES.REGISTRATION_NUMBER_ALREADY_EXISTS);
  }

  const emailEnabled = isVerificationEnforced();

  // Generate Email Verification Token
  const rawVerificationToken = crypto.randomBytes(32).toString('hex');
  const hashedVerificationToken = hashToken(rawVerificationToken);
  const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  const hospital = await Hospital.create({
    name,
    email,
    mobileNumber,
    password,
    registrationNumber,
    hospitalType,
    address: { street, city, state, pincode, country },
    isVerified: !emailEnabled,
    verificationToken: emailEnabled ? hashedVerificationToken : null,
    verificationExpiry: emailEnabled ? verificationExpiry : null,
  });

  if (emailEnabled) {
    // Send email (non-blocking)
    emailService.sendVerificationEmail(email, rawVerificationToken);
  } else {
    logger.warn('SMTP not configured — hospital auto-verified (dev mode)', { email });
  }

  auditService.logAuthEvent({
    userId: hospital._id,
    action: 'REGISTER',
    ip,
    userAgent,
    success: true,
    metadata: { role: ROLES.HOSPITAL },
  });

  logger.info('Hospital registered', { hospitalId: hospital._id, email });

  return {
    user: hospital.toJSON(),
    message: MESSAGES.HOSPITAL_REGISTER_SUCCESS,
  };
};

/**
 * Login a patient (User collection).
 */
const loginPatient = async (email, password, ip, userAgent) => {
  const user = await User.findOne({ email }).select('+password +loginAttempts +lockUntil');

  if (!user) {
    throw ApiError.unauthorized(MESSAGES.INVALID_CREDENTIALS);
  }

  // Check if account is locked
  if (user.isLocked()) {
    auditService.logAuthEvent({
      userId: user._id,
      action: 'LOGIN_FAILED',
      ip,
      userAgent,
      success: false,
      metadata: { reason: 'account_locked' },
    });
    throw ApiError.forbidden(MESSAGES.ACCOUNT_LOCKED);
  }

  // Check password
  const isMatch = await user.comparePassword(password);

  if (!isMatch) {
    await user.incrementLoginAttempts();

    const updatedUser = await User.findById(user._id).select('+loginAttempts +lockUntil');
    if (updatedUser.isLocked()) {
      auditService.logAuthEvent({
        userId: user._id,
        action: 'ACCOUNT_LOCKED',
        ip,
        userAgent,
        success: false,
        metadata: { loginAttempts: updatedUser.loginAttempts },
      });
      logger.warn('Account locked due to failed attempts', { userId: user._id, ip });
    }

    auditService.logAuthEvent({
      userId: user._id,
      action: 'LOGIN_FAILED',
      ip,
      userAgent,
      success: false,
      metadata: { reason: 'invalid_password' },
    });

    throw ApiError.unauthorized(MESSAGES.INVALID_CREDENTIALS);
  }

  // Enforce email verification check (skipped in dev mode when SMTP is not
  // configured, since verification emails can't be delivered).
  if (!user.isVerified && isVerificationEnforced()) {
    auditService.logAuthEvent({
      userId: user._id,
      action: 'LOGIN_FAILED',
      ip,
      userAgent,
      success: false,
      metadata: { reason: 'email_not_verified' },
    });
    throw ApiError.forbidden(MESSAGES.EMAIL_NOT_VERIFIED);
  }

  // Reset attempts and update login details
  user.loginAttempts = 0;
  user.lockUntil = null;
  user.lastLogin = new Date();
  user.lastLoginIP = ip || null;
  user.lastLoginDevice = parseDevice(userAgent);
  await user.save();

  // Generate tokens
  const accessToken = tokenService.generateAccessToken(user._id, user.role);
  const refreshTokenRaw = tokenService.generateRefreshToken();

  await tokenService.saveRefreshToken(user._id, refreshTokenRaw, ip, userAgent);

  auditService.logAuthEvent({
    userId: user._id,
    action: 'LOGIN',
    ip,
    userAgent,
    success: true,
  });

  logger.info('User logged in', { userId: user._id, ip });

  return {
    user: user.toJSON(),
    accessToken,
    refreshToken: refreshTokenRaw,
  };
};

/**
 * Login a hospital (Hospital collection).
 */
const loginHospital = async (email, password, ip, userAgent) => {
  const hospital = await Hospital.findOne({ email }).select('+password +loginAttempts +lockUntil');

  if (!hospital) {
    throw ApiError.unauthorized(MESSAGES.INVALID_CREDENTIALS);
  }

  // Check if account is locked
  if (hospital.isLocked()) {
    auditService.logAuthEvent({
      userId: hospital._id,
      action: 'LOGIN_FAILED',
      ip,
      userAgent,
      success: false,
      metadata: { reason: 'account_locked', role: ROLES.HOSPITAL },
    });
    throw ApiError.forbidden(MESSAGES.ACCOUNT_LOCKED);
  }

  const isMatch = await hospital.comparePassword(password);

  if (!isMatch) {
    await hospital.incrementLoginAttempts();

    const updatedHospital = await Hospital.findById(hospital._id).select('+loginAttempts +lockUntil');
    if (updatedHospital.isLocked()) {
      auditService.logAuthEvent({
        userId: hospital._id,
        action: 'ACCOUNT_LOCKED',
        ip,
        userAgent,
        success: false,
        metadata: { loginAttempts: updatedHospital.loginAttempts, role: ROLES.HOSPITAL },
      });
      logger.warn('Hospital account locked due to failed attempts', { hospitalId: hospital._id, ip });
    }

    auditService.logAuthEvent({
      userId: hospital._id,
      action: 'LOGIN_FAILED',
      ip,
      userAgent,
      success: false,
      metadata: { reason: 'invalid_password', role: ROLES.HOSPITAL },
    });
    throw ApiError.unauthorized(MESSAGES.INVALID_CREDENTIALS);
  }

  if (hospital.isActive === false) {
    throw ApiError.forbidden('This hospital account has been deactivated.');
  }

  // Enforce email verification check (skipped in dev mode when SMTP is not
  // configured, since verification emails can't be delivered).
  if (!hospital.isVerified && isVerificationEnforced()) {
    auditService.logAuthEvent({
      userId: hospital._id,
      action: 'LOGIN_FAILED',
      ip,
      userAgent,
      success: false,
      metadata: { reason: 'email_not_verified', role: ROLES.HOSPITAL },
    });
    throw ApiError.forbidden(MESSAGES.EMAIL_NOT_VERIFIED);
  }

  // Reset attempts and update login details
  hospital.loginAttempts = 0;
  hospital.lockUntil = null;
  hospital.lastLogin = new Date();
  hospital.lastLoginIP = ip || null;
  hospital.lastLoginDevice = parseDevice(userAgent);
  await hospital.save();

  const accessToken = tokenService.generateAccessToken(hospital._id, ROLES.HOSPITAL);
  const refreshTokenRaw = tokenService.generateRefreshToken();

  await tokenService.saveRefreshToken(hospital._id, refreshTokenRaw, ip, userAgent);

  auditService.logAuthEvent({
    userId: hospital._id,
    action: 'LOGIN',
    ip,
    userAgent,
    success: true,
    metadata: { role: ROLES.HOSPITAL },
  });

  logger.info('Hospital logged in', { hospitalId: hospital._id, ip });

  return {
    user: hospital.toJSON(),
    accessToken,
    refreshToken: refreshTokenRaw,
  };
};

/**
 * Login an admin (Admin collection).
 *
 * Admin accounts are provisioned out-of-band (scripts/seedAdmin.js) — there's
 * no self-registration endpoint, so this only ever authenticates against
 * pre-existing accounts. Deliberately reuses the same lockout/audit pattern
 * as patient/hospital login so admin access isn't held to a lower bar.
 */
const loginAdmin = async (email, password, ip, userAgent) => {
  const admin = await Admin.findOne({ email }).select('+password +loginAttempts +lockUntil');

  // Same INVALID_CREDENTIALS message whether the account doesn't exist or the
  // password is wrong — avoids leaking which admin emails are valid.
  if (!admin) {
    throw ApiError.unauthorized(MESSAGES.INVALID_CREDENTIALS);
  }

  if (admin.isLocked()) {
    auditService.logAuthEvent({
      userId: admin._id,
      action: 'LOGIN_FAILED',
      ip,
      userAgent,
      success: false,
      metadata: { reason: 'account_locked', role: ROLES.ADMIN },
    });
    throw ApiError.forbidden(MESSAGES.ACCOUNT_LOCKED);
  }

  const isMatch = await admin.comparePassword(password);

  if (!isMatch) {
    await admin.incrementLoginAttempts();

    const updatedAdmin = await Admin.findById(admin._id).select('+loginAttempts +lockUntil');
    if (updatedAdmin.isLocked()) {
      auditService.logAuthEvent({
        userId: admin._id,
        action: 'ACCOUNT_LOCKED',
        ip,
        userAgent,
        success: false,
        metadata: { loginAttempts: updatedAdmin.loginAttempts, role: ROLES.ADMIN },
      });
      logger.warn('Admin account locked due to failed attempts', { adminId: admin._id, ip });
    }

    auditService.logAuthEvent({
      userId: admin._id,
      action: 'LOGIN_FAILED',
      ip,
      userAgent,
      success: false,
      metadata: { reason: 'invalid_password', role: ROLES.ADMIN },
    });

    throw ApiError.unauthorized(MESSAGES.INVALID_CREDENTIALS);
  }

  if (admin.isActive === false) {
    throw ApiError.forbidden('This admin account has been deactivated.');
  }

  admin.loginAttempts = 0;
  admin.lockUntil = null;
  admin.lastLogin = new Date();
  admin.lastLoginIP = ip || null;
  admin.lastLoginDevice = parseDevice(userAgent);
  await admin.save();

  // Preserve 'admin' vs 'superadmin' in the token so future authorization
  // middleware can distinguish them; both satisfy role === ROLES.ADMIN checks
  // that only look for "is this an admin session".
  const accessToken = tokenService.generateAccessToken(admin._id, admin.role);
  const refreshTokenRaw = tokenService.generateRefreshToken();

  await tokenService.saveRefreshToken(admin._id, refreshTokenRaw, ip, userAgent);

  auditService.logAuthEvent({
    userId: admin._id,
    action: 'LOGIN',
    ip,
    userAgent,
    success: true,
    metadata: { role: admin.role },
  });

  logger.info('Admin logged in', { adminId: admin._id, ip });

  return {
    user: admin.toJSON(),
    accessToken,
    refreshToken: refreshTokenRaw,
  };
};

/**
 * Login an insurance organization (Insurance collection).
 */
const loginInsurance = async (email, password, ip, userAgent) => {
  const insurance = await Insurance.findOne({ email }).select('+password +loginAttempts +lockUntil');

  if (!insurance) {
    throw ApiError.unauthorized(MESSAGES.INVALID_CREDENTIALS);
  }

  if (insurance.isLocked()) {
    auditService.logAuthEvent({
      userId: insurance._id,
      action: 'LOGIN_FAILED',
      ip,
      userAgent,
      success: false,
      metadata: { reason: 'account_locked', role: ROLES.INSURANCE },
    });
    throw ApiError.forbidden(MESSAGES.ACCOUNT_LOCKED);
  }

  const isMatch = await insurance.comparePassword(password);

  if (!isMatch) {
    await insurance.incrementLoginAttempts();

    const updatedInsurance = await Insurance.findById(insurance._id).select('+loginAttempts +lockUntil');
    if (updatedInsurance.isLocked()) {
      auditService.logAuthEvent({
        userId: insurance._id,
        action: 'ACCOUNT_LOCKED',
        ip,
        userAgent,
        success: false,
        metadata: { loginAttempts: updatedInsurance.loginAttempts, role: ROLES.INSURANCE },
      });
      logger.warn('Insurance account locked due to failed attempts', { insuranceId: insurance._id, ip });
    }

    auditService.logAuthEvent({
      userId: insurance._id,
      action: 'LOGIN_FAILED',
      ip,
      userAgent,
      success: false,
      metadata: { reason: 'invalid_password', role: ROLES.INSURANCE },
    });
    throw ApiError.unauthorized(MESSAGES.INVALID_CREDENTIALS);
  }

  if (insurance.isActive === false) {
    throw ApiError.forbidden('This insurance account has been deactivated.');
  }

  insurance.loginAttempts = 0;
  insurance.lockUntil = null;
  insurance.lastLogin = new Date();
  insurance.lastLoginIP = ip || null;
  insurance.lastLoginDevice = parseDevice(userAgent);
  await insurance.save();

  const accessToken = tokenService.generateAccessToken(insurance._id, ROLES.INSURANCE);
  const refreshTokenRaw = tokenService.generateRefreshToken();

  await tokenService.saveRefreshToken(insurance._id, refreshTokenRaw, ip, userAgent);

  auditService.logAuthEvent({
    userId: insurance._id,
    action: 'LOGIN',
    ip,
    userAgent,
    success: true,
    metadata: { role: ROLES.INSURANCE },
  });

  logger.info('Insurance organization logged in', { insuranceId: insurance._id, ip });

  return {
    user: insurance.toJSON(),
    accessToken,
    refreshToken: refreshTokenRaw,
  };
};

/**
 * Admin onboard new insurance organization.
 */
const registerInsurance = async (insuranceData, ip, userAgent) => {
  const {
    companyName,
    email,
    mobileNumber,
    password,
    registrationNumber,
    street,
    city,
    state,
    pincode,
    country,
    policyTypes,
    operatingStates,
    website,
  } = insuranceData;

  const existingEmail = await Insurance.findOne({ email });
  if (existingEmail) {
    throw ApiError.conflict('An insurance company with this email address already exists.');
  }

  const existingMobile = await Insurance.findOne({ mobileNumber });
  if (existingMobile) {
    throw ApiError.conflict('An insurance company with this contact mobile number already exists.');
  }

  const existingReg = await Insurance.findOne({ registrationNumber });
  if (existingReg) {
    throw ApiError.conflict('An insurance company with this IRDAI registration number already exists.');
  }

  const insurance = await Insurance.create({
    companyName,
    email,
    mobileNumber,
    password,
    registrationNumber,
    address: { street, city, state, pincode, country },
    policyTypes: policyTypes || ['Individual Health', 'Family Floater', 'Critical Illness', 'Senior Citizen'],
    operatingStates: operatingStates || ['All India'],
    website,
    isVerified: true,
  });

  auditService.logAuthEvent({
    userId: insurance._id,
    action: 'REGISTER',
    ip,
    userAgent,
    success: true,
    metadata: { role: ROLES.INSURANCE },
  });

  logger.info('Insurance organization registered', { insuranceId: insurance._id, email });

  return {
    user: insurance.toJSON(),
    message: 'Insurance organization onboarded successfully.',
  };
};

/**
 * Login dispatcher.
 */
const login = async (email, password, role, ip, userAgent) => {
  if (role === ROLES.HOSPITAL) {
    return loginHospital(email, password, ip, userAgent);
  }
  if (role === ROLES.INSURANCE) {
    return loginInsurance(email, password, ip, userAgent);
  }
  if (role === ROLES.ADMIN) {
    return loginAdmin(email, password, ip, userAgent);
  }
  return loginPatient(email, password, ip, userAgent);
};

/**
 * Refresh access token.
 */
const refresh = async (refreshTokenRaw, ip, userAgent) => {
  if (!refreshTokenRaw) {
    throw ApiError.unauthorized(MESSAGES.NO_REFRESH_TOKEN);
  }

  const tokenDoc = await tokenService.findRefreshToken(refreshTokenRaw);

  if (!tokenDoc) {
    logger.warn('Refresh attempted with unknown token', { ip });
    throw ApiError.unauthorized(MESSAGES.INVALID_TOKEN);
  }

  // REUSE & COMPROMISE DETECTION
  if (tokenDoc.isUsed || tokenDoc.isRevoked) {
    logger.warn('SECURITY: Suspicious refresh token presented! Revoking token family.', {
      userId: tokenDoc.userId,
      family: tokenDoc.family,
      isUsed: tokenDoc.isUsed,
      isRevoked: tokenDoc.isRevoked,
      ip,
      userAgent,
    });

    await tokenService.revokeFamilyTokens(tokenDoc.family);

    auditService.logAuthEvent({
      userId: tokenDoc.userId,
      action: 'TOKEN_REFRESH',
      ip,
      userAgent,
      success: false,
      metadata: { reason: 'token_reuse_detected', family: tokenDoc.family },
    });

    throw ApiError.unauthorized('Suspicious activity detected. Please log in again.');
  }

  // Check expiry
  if (tokenDoc.expiresAt < new Date()) {
    const RefreshToken = require('../models/RefreshToken');
    await RefreshToken.deleteToken(tokenDoc._id);
    throw ApiError.unauthorized(MESSAGES.REFRESH_TOKEN_EXPIRED);
  }

  const userId = tokenDoc.userId;

  let account = await User.findById(userId);
  let role = account ? ROLES.USER : null;

  if (!account) {
    account = await Hospital.findById(userId);
    role = account ? ROLES.HOSPITAL : null;
  }

  if (!account) {
    account = await Insurance.findById(userId);
    role = account ? ROLES.INSURANCE : null;
  }

  if (!account) {
    account = await Admin.findById(userId);
    role = account ? account.role : null; // preserves 'admin' vs 'superadmin'
  }

  if (!account) {
    const RefreshToken = require('../models/RefreshToken');
    await RefreshToken.deleteToken(tokenDoc._id);
    throw ApiError.unauthorized(MESSAGES.USER_NOT_FOUND);
  }

  const { rawToken: newRefreshToken } = await tokenService.rotateRefreshToken(
    tokenDoc,
    ip,
    userAgent
  );

  const accessToken = tokenService.generateAccessToken(userId, role);

  auditService.logAuthEvent({
    userId,
    action: 'TOKEN_REFRESH',
    ip,
    userAgent,
    success: true,
  });

  return {
    accessToken,
    refreshToken: newRefreshToken,
  };
};

/**
 * Logout.
 */
const logout = async (userId, refreshTokenRaw, ip, userAgent) => {
  const action = refreshTokenRaw ? 'LOGOUT' : 'LOGOUT_ALL';

  if (refreshTokenRaw) {
    await tokenService.deleteRefreshToken(refreshTokenRaw);
  } else {
    await tokenService.deleteAllRefreshTokens(userId);
  }

  auditService.logAuthEvent({
    userId,
    action,
    ip,
    userAgent,
    success: true,
  });

  logger.info(action === 'LOGOUT' ? 'User logged out' : 'User logged out of all devices', { userId, ip });

  return { message: MESSAGES.LOGOUT_SUCCESS };
};

/**
 * Get current user profile.
 */
const getCurrentUser = async (userId, role) => {
  let Model = User;
  if (role === ROLES.HOSPITAL) Model = Hospital;
  else if (role === ROLES.INSURANCE) Model = Insurance;
  else if (role === ROLES.ADMIN || role === 'superadmin') Model = Admin;

  const account = await Model.findById(userId);

  if (!account) {
    throw ApiError.notFound('Account not found.');
  }

  return { user: account.toJSON() };
};

/**
 * Verify Email using token.
 */
const verifyEmail = async (token, ip, userAgent) => {
  const hashed = hashToken(token);

  // Search User first
  let account = await User.findOne({
    verificationToken: hashed,
    verificationExpiry: { $gt: new Date() },
  });
  let role = ROLES.USER;

  if (!account) {
    account = await Hospital.findOne({
      verificationToken: hashed,
      verificationExpiry: { $gt: new Date() },
    });
    role = ROLES.HOSPITAL;
  }

  if (!account) {
    throw ApiError.badRequest('Invalid or expired email verification token.');
  }

  account.isVerified = true;
  account.verificationToken = null;
  account.verificationExpiry = null;
  await account.save();

  auditService.logAuthEvent({
    userId: account._id,
    action: 'EMAIL_VERIFIED',
    ip,
    userAgent,
    success: true,
    metadata: { role },
  });

  return { message: 'Email verified successfully. You can now log in.' };
};

/**
 * Resend Verification Email.
 */
const resendVerification = async (email, ip, userAgent) => {
  let account = await User.findOne({ email });
  let role = ROLES.USER;

  if (!account) {
    account = await Hospital.findOne({ email });
    role = ROLES.HOSPITAL;
  }

  if (!account) {
    throw ApiError.notFound('Account with this email does not exist.');
  }

  if (account.isVerified) {
    throw ApiError.badRequest('This email address is already verified.');
  }

  const rawVerificationToken = crypto.randomBytes(32).toString('hex');
  const hashedVerificationToken = hashToken(rawVerificationToken);

  account.verificationToken = hashedVerificationToken;
  account.verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await account.save();

  emailService.sendVerificationEmail(email, rawVerificationToken);

  return { message: 'Verification link resent successfully.' };
};

/**
 * Forgot Password (Request Password Reset).
 */
const forgotPassword = async (email, ip, userAgent) => {
  let account = await User.findOne({ email });
  let role = ROLES.USER;

  if (!account) {
    account = await Hospital.findOne({ email });
    role = ROLES.HOSPITAL;
  }

  // To prevent user enumeration, return success even if account is not found.
  if (!account) {
    logger.info(`Forgot password request for non-existent email: ${email}`);
    return { message: 'If that email address exists in our system, we have sent a reset link.' };
  }

  const rawResetToken = crypto.randomBytes(32).toString('hex');
  const hashedResetToken = hashToken(rawResetToken);
  const resetExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  account.resetPasswordToken = hashedResetToken;
  account.resetPasswordExpiry = resetExpiry;
  await account.save();

  emailService.sendPasswordResetEmail(email, rawResetToken);

  auditService.logAuthEvent({
    userId: account._id,
    action: 'PASSWORD_RESET_REQUESTED',
    ip,
    userAgent,
    success: true,
    metadata: { role },
  });

  return { message: 'If that email address exists in our system, we have sent a reset link.' };
};

/**
 * Reset Password using token.
 */
const resetPassword = async (token, newPassword, ip, userAgent) => {
  const hashed = hashToken(token);

  let account = await User.findOne({
    resetPasswordToken: hashed,
    resetPasswordExpiry: { $gt: new Date() },
  });
  let role = ROLES.USER;

  if (!account) {
    account = await Hospital.findOne({
      resetPasswordToken: hashed,
      resetPasswordExpiry: { $gt: new Date() },
    });
    role = ROLES.HOSPITAL;
  }

  if (!account) {
    throw ApiError.badRequest('Invalid or expired password reset token.');
  }

  // Update password & security metadata
  account.password = newPassword;
  account.passwordChangedAt = new Date();
  account.resetPasswordToken = null;
  account.resetPasswordExpiry = null;
  
  // Unlock account in case it was locked
  account.loginAttempts = 0;
  account.lockUntil = null;
  
  await account.save();

  // Revoke all existing sessions (forces re-login everywhere)
  await tokenService.deleteAllRefreshTokens(account._id);

  auditService.logAuthEvent({
    userId: account._id,
    action: 'PASSWORD_RESET_COMPLETED',
    ip,
    userAgent,
    success: true,
    metadata: { role },
  });

  return { message: 'Password reset successful. Please log in with your new password.' };
};

/**
 * Change Password (Authenticated).
 */
const changePassword = async (userId, role, currentPassword, newPassword, ip, userAgent) => {
  let Model = User;
  if (role === ROLES.HOSPITAL) Model = Hospital;
  else if (role === ROLES.ADMIN || role === 'superadmin') Model = Admin;

  const account = await Model.findById(userId).select('+password');

  if (!account) {
    throw ApiError.notFound('Account not found.');
  }

  // Verify current password
  const isMatch = await account.comparePassword(currentPassword);
  if (!isMatch) {
    auditService.logAuthEvent({
      userId,
      action: 'PASSWORD_CHANGED',
      ip,
      userAgent,
      success: false,
      metadata: { reason: 'incorrect_current_password', role },
    });
    throw ApiError.unauthorized('Incorrect current password.');
  }

  // Update password
  account.password = newPassword;
  account.passwordChangedAt = new Date();
  await account.save();

  // Revoke all existing sessions
  await tokenService.deleteAllRefreshTokens(userId);

  auditService.logAuthEvent({
    userId,
    action: 'PASSWORD_CHANGED',
    ip,
    userAgent,
    success: true,
    metadata: { role },
  });

  return { message: 'Password changed successfully. Please log in again.' };
};

module.exports = {
  register,
  registerHospital,
  registerInsurance,
  login,
  refresh,
  logout,
  getCurrentUser,
  verifyEmail,
  resendVerification,
  forgotPassword,
  resetPassword,
  changePassword,
};
