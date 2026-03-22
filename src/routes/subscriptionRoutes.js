const express = require('express');

const subscriptionController = require('../controllers/subscriptionController');
const { requireAuth, requireUserType } = require('../middleware/auth');

const router = express.Router();

router.get('/current', requireAuth, requireUserType('student'), subscriptionController.getCurrentSubscription);

module.exports = router;