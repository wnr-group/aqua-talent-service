import { Router } from 'express';

const subscriptionController = require('../controllers/subscriptionController');
const { requireAuth, requireUserType } = require('../middleware/auth');

const router = Router();

router.get('/current', requireAuth, requireUserType('student'), subscriptionController.getCurrentSubscription);

export = router;
