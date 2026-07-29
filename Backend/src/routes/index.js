/**
 * Central route index.
 * Mounts all route modules under their API prefixes.
 */
const { Router } = require('express');
const authRoutes = require('./auth.routes');
const patientRoutes = require('./patient.routes');
const hospitalRoutes = require('./hospital.routes');

const router = Router();

// Mount auth routes
router.use('/auth', authRoutes);

// Mount patient (user) routes
router.use('/patients', patientRoutes);

// Mount hospital routes
router.use('/hospitals', hospitalRoutes);

// Future route modules:
// router.use('/records', recordRoutes);

module.exports = router;

