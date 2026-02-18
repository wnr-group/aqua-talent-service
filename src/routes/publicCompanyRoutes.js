const express = require('express');
const router = express.Router();

const companyController = require('../controllers/companyController');
const { optionalAuth } = require('../middleware/auth');

router.get('/:companyId/public', optionalAuth, companyController.getPublicProfile);

module.exports = router;
