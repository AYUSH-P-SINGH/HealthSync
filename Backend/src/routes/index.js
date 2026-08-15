/**
 * Central route index.
 * Mounts all route modules under their API prefixes.
 */
const { Router } = require('express');
const authRoutes = require('./auth.routes');
const patientRoutes = require('./patient.routes');
const hospitalRoutes = require('./hospital.routes');
const insuranceRoutes = require('./insurance.routes');
const advisoryRoutes = require('./advisory.routes');
const aiRoutes = require('./ai.routes');

const router = Router();

// Mount auth routes
router.use('/auth', authRoutes);

// Mount patient (user) routes
router.use('/patients', patientRoutes);

// Mount hospital routes
router.use('/hospitals', hospitalRoutes);

// Mount insurance routes
router.use('/insurance', insuranceRoutes);
// Mount health advisory routes (patient-facing + admin management)
router.use('/advisories', advisoryRoutes);

// Mount AI RAG routes
router.use('/ai', aiRoutes);

// Development-only demo utilities (follow-up clock advance).
// Gate 1 of 3: in production this module is never even required, so the
// routes cannot exist regardless of what the rest of the app does.
if (process.env.NODE_ENV !== 'production') {
  // eslint-disable-next-line global-require
  router.use('/dev', require('./dev.routes'));
}

module.exports = router;

