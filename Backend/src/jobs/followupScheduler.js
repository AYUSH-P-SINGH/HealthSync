/**
 * Follow-up scheduler — the clock that makes an obligation real.
 *
 * Without this, a FollowUpObligation is just a row nobody reads. This worker
 * is what converts "someone should repeat this scan in six months" into an
 * escalating sequence that ends up in front of a clinician.
 *
 * Runs in-process on an interval rather than as an external cron. For a
 * single-instance deployment that is the right amount of machinery: no extra
 * service to operate, no separate deploy, and it starts and stops with the
 * API. See MULTI-INSTANCE below before scaling out.
 *
 * ─── OPERATIONAL SAFETY ────────────────────────────────
 *  • Overlap guard — a sweep that runs long can never start a second copy.
 *  • Idempotent notifications — every send is recorded on the obligation, and
 *    checked before sending, so a restart mid-sweep cannot re-notify.
 *  • Batched with a cursor — memory stays flat regardless of table size.
 *  • Errors are per-obligation — one malformed document cannot abort the
 *    sweep and silently starve every obligation behind it.
 *
 * ─── MULTI-INSTANCE ────────────────────────────────────
 * Two API instances would both sweep. Notifications stay safe (the ledger
 * dedupes), but the work is wasted. Before running more than one instance,
 * gate `runSweep` behind a lock — a TTL document in Mongo or a Redis SETNX is
 * enough. Left out here deliberately rather than half-implemented, because a
 * lock that looks correct but isn't is worse than an honest comment.
 */
const FollowUpObligation = require('../models/FollowUpObligation');
const followupService = require('../services/followup.service');
const auditService = require('../services/audit.service');
const logger = require('../utils/logger');
const {
  ESCALATION_TIERS,
  SEVERITY_ESCALATION_OVERRIDE,
  ACTIVE_STATUSES,
} = require('../constants/followUp');

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // hourly
const BATCH_SIZE = 200;

let timer = null;
let running = false; // overlap guard

/**
 * Which escalation tier, if any, is due for this obligation right now?
 * Returns the LATEST tier whose trigger time has passed and which has not
 * already fired — so an obligation created after its own T-30 point does not
 * fire a burst of stale reminders, it just picks up where the clock is.
 */
const dueTierFor = (followUp, now = Date.now()) => {
  const applicable = SEVERITY_ESCALATION_OVERRIDE[followUp.severity] || [];
  const dueMs = followUp.dueAt.getTime();

  let candidate = null;
  for (const tier of ESCALATION_TIERS) {
    if (!applicable.includes(tier.key)) continue;
    const triggerAt = dueMs + tier.offsetDays * 86_400_000;
    if (triggerAt <= now && !followUp.hasNotified(tier.key)) {
      candidate = tier; // keep going — we want the most advanced one
    }
  }
  return candidate;
};

/**
 * Process one obligation: escalate status if past due, fire any owed tier.
 * Returns a small result object for sweep-level accounting.
 */
const processOne = async (followUp, now) => {
  const result = { notified: false, markedOverdue: false };

  // 1. Past due and still in a pre-overdue state → escalate.
  //    This is the moment the obligation stops being a private reminder and
  //    becomes visible to any treating provider.
  if (followUp.isPastDue() && followUp.status !== 'overdue') {
    if (followUp.canTransitionTo('overdue')) {
      followUp.status = 'overdue';
      followUp.providerVisible = true;
      followUp.lastActorRole = 'system';
      result.markedOverdue = true;

      auditService.logAuthEvent({
        userId: followUp.patient,
        action: 'FOLLOWUP_OVERDUE',
        success: true,
        metadata: {
          followUpId: String(followUp._id),
          action: followUp.action,
          dueAt: followUp.dueAt,
          daysOverdue: Math.abs(followUp.daysUntilDue()),
        },
      });
    }
  }

  // 2. Fire the owed escalation tier, if any.
  const tier = dueTierFor(followUp, now);
  if (tier) {
    // notifyTier pushes onto notifications[] but does not save — we persist
    // once, below, so a status change and its notification record commit
    // together rather than as two independently-failable writes.
    result.notified = await followupService.notifyTier(followUp, tier);
    if (tier.providerVisible) followUp.providerVisible = true;
  }

  if (result.markedOverdue || result.notified) {
    await followUp.save();
  }

  return result;
};

/**
 * One full pass over every obligation that could need attention.
 * Safe to call manually (used by the dev clock-advance endpoint and tests).
 */
const runSweep = async ({ trigger = 'interval' } = {}) => {
  if (running) {
    logger.warn('Follow-up sweep skipped — previous sweep still running');
    return { skipped: true };
  }
  running = true;

  const startedAt = Date.now();
  const stats = { scanned: 0, notified: 0, markedOverdue: 0, errors: 0 };

  try {
    const now = Date.now();

    // Only obligations that are active AND have reached their earliest
    // possible trigger point. The 30-day lookahead matches the widest tier,
    // so nothing is scanned before it could possibly be due.
    const horizon = new Date(now + 30 * 86_400_000);

    const cursor = FollowUpObligation.find({
      status: { $in: ACTIVE_STATUSES },
      dueAt: { $lte: horizon },
    })
      .batchSize(BATCH_SIZE)
      .cursor();

    for (let doc = await cursor.next(); doc != null; doc = await cursor.next()) {
      stats.scanned += 1;
      try {
        const res = await processOne(doc, now);
        if (res.notified) stats.notified += 1;
        if (res.markedOverdue) stats.markedOverdue += 1;
      } catch (err) {
        // One bad document must not starve everything behind it.
        stats.errors += 1;
        logger.error('Follow-up sweep failed for one obligation', {
          followUpId: String(doc?._id),
          error: err.message,
        });
      }
    }

    logger.info('Follow-up sweep complete', {
      trigger,
      ...stats,
      ms: Date.now() - startedAt,
    });

    return stats;
  } catch (err) {
    logger.error('Follow-up sweep aborted', { error: err.message });
    return { ...stats, aborted: true };
  } finally {
    running = false;
  }
};

/** Start the recurring sweep. Idempotent. */
const start = ({ intervalMs } = {}) => {
  if (timer) return timer;

  const interval = Number(process.env.FOLLOWUP_SWEEP_INTERVAL_MS || intervalMs || DEFAULT_INTERVAL_MS);

  // First sweep shortly after boot so a restart does not delay overdue
  // escalations by a full interval — but not instantly, so it does not
  // compete with startup work.
  setTimeout(() => {
    runSweep({ trigger: 'startup' }).catch(() => {});
  }, 15_000).unref();

  timer = setInterval(() => {
    runSweep({ trigger: 'interval' }).catch(() => {});
  }, interval);

  // Do not hold the event loop open on shutdown.
  timer.unref();

  logger.info('Follow-up scheduler started', { intervalMs: interval });
  return timer;
};

const stop = () => {
  if (timer) {
    clearInterval(timer);
    timer = null;
    logger.info('Follow-up scheduler stopped');
  }
};

module.exports = { start, stop, runSweep, dueTierFor, _state: () => ({ running, active: Boolean(timer) }) };
