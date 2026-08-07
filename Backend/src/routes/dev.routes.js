/**
 * Development-only routes — demo and testing utilities.
 *
 * ⚠ NEVER MOUNTED IN PRODUCTION.
 *
 * These endpoints mutate clinical dates directly, which is exactly what you
 * want when demonstrating a six-month follow-up clock in a three-minute demo,
 * and exactly what you must never expose to real patient data.
 *
 * Defence in depth — three independent gates, because a single `if` around a
 * feature this dangerous is one refactor away from being removed by accident:
 *   1. routes/index.js only requires this file when NODE_ENV !== 'production'
 *   2. the router itself re-checks NODE_ENV on every request
 *   3. each route still requires a valid authenticated patient session,
 *      and only ever touches that caller's own obligations
 */
const { Router } = require('express');
const FollowUpObligation = require('../models/FollowUpObligation');
const followupScheduler = require('../jobs/followupScheduler');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const { ACTIVE_STATUSES } = require('../constants/followUp');

const router = Router();

// Gate 2 — refuse to serve even if somehow mounted in production.
router.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    return next(ApiError.notFound('Resource not found'));
  }
  return next();
});

// Gate 3 — a real, authenticated patient session, same as any other route.
router.use(authenticate, authorize('user'));

/**
 * POST /api/dev/followups/advance-clock   { days: 200 }
 *
 * Shifts the CALLER'S OWN active follow-ups backward in time, then runs a
 * sweep. Judges will not sit through six months, and faking the passage of
 * time is far more convincing than seeding a row that is already overdue —
 * the escalation, the emails and the provider banner all fire for real.
 */
router.post(
  '/followups/advance-clock',
  asyncHandler(async (req, res) => {
    const days = Number(req.body.days);
    if (!Number.isFinite(days) || days <= 0 || days > 3650) {
      throw ApiError.badRequest('days must be a number between 1 and 3650.');
    }

    const shiftMs = days * 86_400_000;

    const followUps = await FollowUpObligation.find({
      patient: req.user.id, // scoped to the caller — never a global time machine
      status: { $in: [...ACTIVE_STATUSES, 'pending_confirm'] },
    });

    for (const followUp of followUps) {
      followUp.dueAt = new Date(followUp.dueAt.getTime() - shiftMs);
      followUp.anchorDate = new Date(followUp.anchorDate.getTime() - shiftMs);
      await followUp.save();
    }

    logger.warn('DEV: follow-up clock advanced', {
      userId: req.user.id,
      days,
      affected: followUps.length,
    });

    const sweep = await followupScheduler.runSweep({ trigger: 'dev-advance' });

    const response = ApiResponse.ok(
      { advancedDays: days, affected: followUps.length, sweep },
      `Advanced ${followUps.length} follow-up${followUps.length === 1 ? '' : 's'} by ${days} days.`
    );
    res.status(response.statusCode).json(response);
  })
);

/**
 * POST /api/dev/followups/sweep
 * Run the escalation sweep immediately instead of waiting for the interval.
 */
router.post(
  '/followups/sweep',
  asyncHandler(async (req, res) => {
    const sweep = await followupScheduler.runSweep({ trigger: 'dev-manual' });
    const response = ApiResponse.ok(sweep, 'Sweep complete.');
    res.status(response.statusCode).json(response);
  })
);

module.exports = router;
