/**
 * Health advisory routes.
 * /active is readable by any authenticated account (patients, hospitals,
 * admins); management endpoints are admin-only.
 */
const { Router } = require('express');
const advisoryController = require('../controllers/advisory.controller');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const {
  createAdvisoryValidator,
  advisoryIdValidator,
  updateAdvisoryValidator,
} = require('../validators/advisory.validator');

const router = Router();

router.use(authenticate);

// Active advisories + WHO outbreak alerts + daily health tips
router.get(
  '/active',
  authorize('user', 'hospital', 'admin', 'superadmin'),
  advisoryController.getActive
);

// ─── Admin management ──────────────────────────────────
router.use(authorize('admin', 'superadmin'));

// Publish a new advisory
router.post('/', createAdvisoryValidator, validate, advisoryController.createAdvisory);

// List all advisories (including inactive)
router.get('/', advisoryController.listAll);

// Edit / activate / deactivate an advisory
router.patch('/:advisoryId', updateAdvisoryValidator, validate, advisoryController.updateAdvisory);

// Delete an advisory
router.delete('/:advisoryId', advisoryIdValidator, validate, advisoryController.deleteAdvisory);

module.exports = router;
