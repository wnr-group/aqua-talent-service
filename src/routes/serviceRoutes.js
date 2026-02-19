const express = require('express');
const router = express.Router();

const subscriptionController = require('../controllers/subscriptionController');

router.get('/', subscriptionController.getAvailableServices);

module.exports = router;
