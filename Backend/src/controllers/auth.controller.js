/**
 * Auth controller.
 * Handles HTTP concerns: request parsing, cookies, response status codes.
*/

const authService = require('../services/auth.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const MESSAGES = require('../constants/messages');
const { REFRESH_TOKEN_COOKIE_NAME, getCookieOptions, getClearCookieOptions } = require('../config/cookie.config');

/**
 * POST /api/auth/register
 */
const register = asyncHandler(async (req, res) => {
  const { firstName, lastName, email, mobileNumber, password } = req.body;
  const ip = req.ip;
  const userAgent = req.headers['user-agent'];

  const result = await authService.register(
    { firstName, lastName, email, mobileNumber, password },
    ip,
    userAgent
  );

  const response = ApiResponse.created(result.user, result.message);
  res.status(response.statusCode).json(response);
});

/**
 * POST /api/auth/register/hospital
 */
const registerHospital = asyncHandler(async (req, res) => {
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
  } = req.body;
  const ip = req.ip;
  const userAgent = req.headers['user-agent'];

  const result = await authService.registerHospital(
    { name, email, mobileNumber, password, registrationNumber, hospitalType, street, city, state, pincode, country },
    ip,
    userAgent
  );

  const response = ApiResponse.created(result.user, result.message);
  res.status(response.statusCode).json(response);
});

/**
 * POST /api/auth/register/insurance
 */
const registerInsurance = asyncHandler(async (req, res) => {
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
  } = req.body;
  const ip = req.ip;
  const userAgent = req.headers['user-agent'];

  const result = await authService.registerInsurance(
    {
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
    },
    ip,
    userAgent
  );

  const response = ApiResponse.created(result.user, result.message);
  res.status(response.statusCode).json(response);
});

/**
 * POST /api/auth/login
 */
const login = asyncHandler(async (req, res) => {
  const { email, password, role } = req.body;
  const ip = req.ip;
  const userAgent = req.headers['user-agent'];

  const result = await authService.login(email, password, role, ip, userAgent);

  // Set refresh token in HttpOnly cookie => res.cookie(name, value, options);
  res.cookie(REFRESH_TOKEN_COOKIE_NAME, result.refreshToken, getCookieOptions());

  const response = ApiResponse.ok(
    {
      user: result.user,
      accessToken: result.accessToken,
    },
    MESSAGES.LOGIN_SUCCESS
  );
  res.status(response.statusCode).json(response);
});

/**
 * POST /api/auth/logout
 */
const logout = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies[REFRESH_TOKEN_COOKIE_NAME];
  const ip = req.ip;
  const userAgent = req.headers['user-agent'];

  await authService.logout(req.user.id, refreshToken, ip, userAgent);

  // Clear the refresh token cookie
  res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, getClearCookieOptions());

  const response = ApiResponse.ok(null, MESSAGES.LOGOUT_SUCCESS);
  res.status(response.statusCode).json(response);
});

/**
 * POST /api/auth/logout/all
 */
const logoutAll = asyncHandler(async (req, res) => {
  const ip = req.ip;
  const userAgent = req.headers['user-agent'];

  // Delete all refresh tokens for the user (null token param deletes all sessions)
  await authService.logout(req.user.id, null, ip, userAgent);

  res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, getClearCookieOptions());

  const response = ApiResponse.ok(null, 'Logged out from all devices successfully.');
  res.status(response.statusCode).json(response);
});

/**
 * POST /api/auth/refresh
 */
const refresh = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies[REFRESH_TOKEN_COOKIE_NAME];
  const ip = req.ip;
  const userAgent = req.headers['user-agent'];

  const result = await authService.refresh(refreshToken, ip, userAgent);

  // Set new refresh token cookie (rotation)
  res.cookie(REFRESH_TOKEN_COOKIE_NAME, result.refreshToken, getCookieOptions());

  const response = ApiResponse.ok(
    { accessToken: result.accessToken },
    MESSAGES.REFRESH_SUCCESS
  );
  res.status(response.statusCode).json(response);
});

/**
 * GET /api/auth/me
 */
const getMe = asyncHandler(async (req, res) => {
  const result = await authService.getCurrentUser(req.user.id, req.user.role);

  const response = ApiResponse.ok(result.user);
  res.status(response.statusCode).json(response);
});

/**
 * POST /api/auth/verify-email
 */
const verifyEmail = asyncHandler(async (req, res) => {
  const { token } = req.body;
  const ip = req.ip;
  const userAgent = req.headers['user-agent'];

  const result = await authService.verifyEmail(token, ip, userAgent);

  const response = ApiResponse.ok(null, result.message);
  res.status(response.statusCode).json(response);
});

/**
 * POST /api/auth/resend-verification
 */
const resendVerification = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const ip = req.ip;
  const userAgent = req.headers['user-agent'];

  const result = await authService.resendVerification(email, ip, userAgent);

  const response = ApiResponse.ok(null, result.message);
  res.status(response.statusCode).json(response);
});

/**
 * POST /api/auth/forgot-password
 */
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const ip = req.ip;
  const userAgent = req.headers['user-agent'];

  const result = await authService.forgotPassword(email, ip, userAgent);

  const response = ApiResponse.ok(null, result.message);
  res.status(response.statusCode).json(response);
});

/**
 * POST /api/auth/reset-password
 */
const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body;
  const ip = req.ip;
  const userAgent = req.headers['user-agent'];

  const result = await authService.resetPassword(token, password, ip, userAgent);

  const response = ApiResponse.ok(null, result.message);
  res.status(response.statusCode).json(response);
});

/**
 * POST /api/auth/change-password
 */
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const ip = req.ip;
  const userAgent = req.headers['user-agent'];

  const result = await authService.changePassword(
    req.user.id,
    req.user.role,
    currentPassword,
    newPassword,
    ip,
    userAgent
  );

  // Clear cookie because password change revokes all sessions
  res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, getClearCookieOptions());

  const response = ApiResponse.ok(null, result.message);
  res.status(response.statusCode).json(response);
});

module.exports = {
  register,
  registerHospital,
  registerInsurance,
  login,
  logout,
  logoutAll,
  refresh,
  getMe,
  verifyEmail,
  resendVerification,
  forgotPassword,
  resetPassword,
  changePassword,
};
