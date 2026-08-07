/**
 * Centralized JWT and auth configuration.
 * Single source of truth — no magic values in services.
 */

module.exports = {
  // ─── JWT ───────────────────────────────────────────
  accessTokenExpiry: '15m',       // Access token expires in 15 minutes
  refreshTokenExpiry: '7d',       // Refresh token expires in 7 days
  refreshTokenExpiryMs: 7 * 24 * 60 * 60 * 1000, // 7 days in ms

  // ─── bcrypt ────────────────────────────────────────
  bcryptSaltRounds: 12,

  // ─── Account Lockout ──────────────────────────────
  maxLoginAttempts: 5,            // Lock after 5 failed attempts
  lockDurationMs: 15 * 60 * 1000, // Lock for 15 minutes

  // ─── Rate Limiting ────────────────────────────────
  rateLimits: {
    general: {
      windowMs: 15 * 60 * 1000,   // 15 minutes
      max: 100,
    },
    auth: {
      windowMs: 15 * 60 * 1000,   // 15 minutes (login)
      max: 5,
    },
    register: {
      windowMs: 60 * 60 * 1000,   // 1 hour
      max: 3,
    },
    forgotPassword: {
      windowMs: 60 * 60 * 1000,   // 1 hour
      max: 3,
    },
    emailVerification: {
      windowMs: 60 * 60 * 1000,   // 1 hour
      max: 5,
    },
    // Report scanning parses uploaded PDFs and runs the extractor, so it is
    // both CPU-bound and the only endpoint that accepts large binaries.
    // Tighter than `general` to keep it from becoming a cheap DoS lever.
    reportScan: {
      windowMs: 15 * 60 * 1000,   // 15 minutes
      max: 20,
    },
  },
};
