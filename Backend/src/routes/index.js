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


module.exports = router;

