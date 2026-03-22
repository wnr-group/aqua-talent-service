const express = require('express');

const paymentController = require('../controllers/paymentController');
const { requireAuth, requireUserType } = require('../middleware/auth');

const router = express.Router();

router.post(
  '/create-order',
  requireAuth,
  requireUserType('student'),
  paymentController.createOrder
);

router.post(
  '/verify',
  requireAuth,
  requireUserType('student'),
  paymentController.verifyPayment
);

router.post(
  '/verify-payment',
  requireAuth,
  requireUserType('student'),
  paymentController.verifyPayment
);

router.post('/webhooks/razorpay', paymentController.handleWebhook);
router.get('/geo-location', paymentController.getGeoLocation);

router.post(
  '/zone-addon/create-order',
  requireAuth,
  requireUserType('student'),
  paymentController.purchaseZoneAddon
);

router.post(
  '/zone-addon/purchase',
  requireAuth,
  requireUserType('student'),
  paymentController.purchaseZoneAddon
);

router.post(
  '/zone-addon/verify',
  requireAuth,
  requireUserType('student'),
  paymentController.verifyZoneAddonPayment
);

// Job credits addon routes (Extra Job Credits)
router.post(
  '/jobs-addon/create-order',
  requireAuth,
  requireUserType('student'),
  paymentController.purchaseJobsAddon
);

router.post(
  '/jobs-addon/purchase',
  requireAuth,
  requireUserType('student'),
  paymentController.purchaseJobsAddon
);

router.post(
  '/jobs-addon/verify',
  requireAuth,
  requireUserType('student'),
  paymentController.verifyJobsAddonPayment
);

// Pay-per-job routes - create-order must come before :jobId to avoid matching "create-order" as jobId
router.post(
  '/pay-per-job/create-order',
  requireAuth,
  requireUserType('student'),
  paymentController.initiatePayPerJob
);

router.post(
  '/pay-per-job/verify',
  requireAuth,
  requireUserType('student'),
  paymentController.verifyPayPerJob
);

// Legacy routes with jobId in path (still supported)
router.post(
  '/pay-per-job/:jobId',
  requireAuth,
  requireUserType('student'),
  paymentController.initiatePayPerJob
);

router.post(
  '/pay-per-job/:jobId/verify',
  requireAuth,
  requireUserType('student'),
  paymentController.verifyPayPerJob
);

module.exports = router;