/**
 * Rate limiting middleware.
 * Different limits for different route groups.
 * Limiters are bypassed when NODE_ENV is 'test' or 'development' to prevent local development blocks.
 */
const rateLimit = require('express-rate-limit');
const { rateLimits } = require('../config/jwt.config');
const MESSAGES = require('../constants/messages');

// Helper to bypass rate limiting in development and test environments
const skipInDevAndTest = (limiter) => {
  return (req, res, next) => {
    if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') {
      return next();
    }
    return limiter(req, res, next);
  };
};

/**
 * General API rate limiter — 100 requests per 15 minutes.
 */
const generalLimiter = skipInDevAndTest(
  rateLimit({
    windowMs: rateLimits.general.windowMs,
    max: rateLimits.general.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      message: MESSAGES.TOO_MANY_REQUESTS,
    },
  })
);

/**
 * Auth route rate limiter — 5 requests per 15 minutes.
 * Applies to login and similar sensitive endpoints.
 */
const authLimiter = skipInDevAndTest(
  rateLimit({
    windowMs: rateLimits.auth.windowMs,
    max: rateLimits.auth.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      message: MESSAGES.TOO_MANY_REQUESTS,
    },
  })
);

/**
 * Registration rate limiter — 3 requests per hour.
 */
const registerLimiter = skipInDevAndTest(
  rateLimit({
    windowMs: rateLimits.register.windowMs,
    max: rateLimits.register.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      message: MESSAGES.TOO_MANY_REQUESTS,
    },
  })
);

/**
 * Forgot password rate limiter — 3 requests per hour.
 */
const forgotPasswordLimiter = skipInDevAndTest(
  rateLimit({
    windowMs: rateLimits.forgotPassword.windowMs,
    max: rateLimits.forgotPassword.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      message: MESSAGES.TOO_MANY_REQUESTS,
    },
  })
);

/**
 * Email verification rate limiter — 5 requests per hour.
 */
const emailVerificationLimiter = skipInDevAndTest(
  rateLimit({
    windowMs: rateLimits.emailVerification.windowMs,
    max: rateLimits.emailVerification.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      message: MESSAGES.TOO_MANY_REQUESTS,
    },
  })
);

/**
 * Report scan limiter — 20 requests per 15 minutes, keyed PER USER.
 *
 * The default IP key is wrong for this endpoint: hospital staff share an
 * outbound IP, so one busy clinic would rate-limit its own colleagues. Keying
 * on the authenticated principal also means the limit actually binds an
 * attacker, who can rotate IPs far more easily than accounts.
 *
 * Unlike the others this is NOT bypassed in development — the whole point is
 * to bound an expensive parse, and a local machine is exactly where an
 * accidental upload loop will be discovered.
 */
const reportScanLimiter = rateLimit({
  windowMs: rateLimits.reportScan.windowMs,
  max: rateLimits.reportScan.max,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: {
    success: false,
    message: 'Too many report scans. Please wait a few minutes and try again.',
  },
});

module.exports = {
  generalLimiter,
  authLimiter,
  registerLimiter,
  forgotPasswordLimiter,
  emailVerificationLimiter,
  reportScanLimiter,
};
