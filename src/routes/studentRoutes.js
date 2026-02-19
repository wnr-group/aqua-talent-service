const express = require('express');
const router = express.Router();

const studentController = require('../controllers/studentController');
const subscriptionController = require('../controllers/subscriptionController');
const { requireAuth, requireUserType, optionalAuth } = require('../middleware/auth');

// Dashboard requires student authentication
router.get('/dashboard', requireAuth, requireUserType('student'), studentController.getDashboard);

// Job search and detail work with optional authentication
router.get('/jobs', optionalAuth, studentController.getJobs);
router.get('/jobs/:jobId', optionalAuth, studentController.getJob);

// Application endpoints (require student auth)
router.post('/jobs/:jobId/apply', requireAuth, requireUserType('student'), studentController.applyToJob);
router.get('/applications', requireAuth, requireUserType('student'), studentController.getApplications);
router.patch('/applications/:appId/withdraw', requireAuth, requireUserType('student'), studentController.withdrawApplication);

// Profile endpoints (require student auth)
router.get('/profile', requireAuth, requireUserType('student'), studentController.getProfile);
router.patch('/profile', requireAuth, requireUserType('student'), studentController.updateProfile);

// Subscription endpoints (require student auth)
router.get('/subscription', requireAuth, requireUserType('student'), subscriptionController.getCurrentSubscription);
router.post('/subscription', requireAuth, requireUserType('student'), subscriptionController.createOrUpgradeSubscription);
router.patch('/subscription', requireAuth, requireUserType('student'), subscriptionController.updateSubscription);
router.delete('/subscription', requireAuth, requireUserType('student'), subscriptionController.cancelSubscription);
router.get('/payments', requireAuth, requireUserType('student'), subscriptionController.getPaymentHistory);

module.exports = router;
