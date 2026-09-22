import { Router } from 'express';

const router = Router();

const companyController = require('../controllers/companyController');
const { optionalAuth } = require('../middleware/auth');

router.get('/:companyId/public', optionalAuth, companyController.getPublicProfile);

export = router;
