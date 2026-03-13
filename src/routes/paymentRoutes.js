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

module.exports = router;