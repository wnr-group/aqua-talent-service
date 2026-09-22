import { Router } from 'express';

const router = Router();

const subscriptionController = require('../controllers/subscriptionController');

router.get('/', subscriptionController.getAvailableServices);

export = router;
