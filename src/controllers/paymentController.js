const crypto = require('crypto');
const mongoose = require('mongoose');
const geoip = require('geoip-lite');

const Student = require('../models/Student');
const ActiveSubscription = require('../models/ActiveSubscription');
const AvailableService = require('../models/AvailableService');
const PaymentRecord = require('../models/PaymentRecord');
const {
  getRazorpayInstance,
  getRazorpayCredentials,
  RAZORPAY_CONFIG_ERROR_CODES
} = require('../services/razorpayService');
const { createOrUpgradeSubscriptionForStudent } = require('./subscriptionController');

const SUPPORTED_CHECKOUT_CURRENCIES = new Set(['INR', 'USD']);
const COUNTRY_HEADER_KEYS = ['cf-ipcountry', 'x-vercel-ip-country', 'x-country-code'];
const RAZORPAY_CONFIGURATION_ERRORS = new Set(Object.values(RAZORPAY_CONFIG_ERROR_CODES));

const isValidAmount = (value) => Number.isInteger(value) && value > 0;

const normalizeCurrency = (value, fallback = 'INR') => {
  const normalized = String(value || fallback).trim().toUpperCase();
  return SUPPORTED_CHECKOUT_CURRENCIES.has(normalized) ? normalized : null;
};

const buildReceipt = (serviceId) => `svc_${String(serviceId).slice(-8)}_${Date.now().toString(36)}`;

const getUsdFallbackPrice = (service) => {
  const fallbackValues = [
    service.priceUSD,
    service.usdPrice,
    service.nonIndianPrice,
    service.internationalPrice,
    service.non_indian_price,
    service.international_price,
    service.price
  ];

  return fallbackValues.find((value) => typeof value === 'number' && value >= 0) ?? null;
};

const getServicePrice = (service, currency) => {
  if (currency === 'INR') {
    return typeof service.priceINR === 'number' ? service.priceINR : service.price;
  }

  return getUsdFallbackPrice(service);
};

const toSmallestUnit = (amount) => Math.round(Number(amount) * 100);

const timingSafeCompare = (left, right) => {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const mergeGatewayResponse = (currentValue, patch) => {
  const base = currentValue && typeof currentValue === 'object' && !Array.isArray(currentValue)
    ? currentValue
    : {};

  return {
    ...base,
    ...patch
  };
};

const getClientIp = (req) => {
  const forwardedFor = req.headers['x-forwarded-for'];

  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim();
  }

  const realIp = req.headers['x-real-ip'];

  if (typeof realIp === 'string' && realIp.trim()) {
    return realIp.trim();
  }

  return req.socket?.remoteAddress || null;
};

const normalizeCountryCode = (value) => {
  if (!value || typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toUpperCase();
  return normalized.length === 2 ? normalized : null;
};

const getCountryCode = (req) => {
  for (const headerKey of COUNTRY_HEADER_KEYS) {
    const headerValue = normalizeCountryCode(req.headers[headerKey]);

    if (headerValue) {
      return headerValue;
    }
  }

  const clientIp = getClientIp(req);
  const geo = clientIp ? geoip.lookup(clientIp) : null;
  return normalizeCountryCode(geo?.country);
};

const buildWebhookSignature = (rawBody, secret) => {
  return crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
};

const isRazorpayConfigurationError = (error) => (
  typeof error?.code === 'string' && RAZORPAY_CONFIGURATION_ERRORS.has(error.code)
);

const activateSubscriptionForPaymentRecord = async ({
  paymentRecord,
  razorpayPaymentId = null,
  paymentMethod = null,
  paymentDetails = {},
  source,
  eventName
}) => {
  if (!paymentRecord) {
    return {
      alreadyProcessed: false,
      subscriptionId: null
    };
  }

  console.log('Payment captured for order:', paymentRecord.razorpayOrderId);

  // Update payment method if provided
  if (paymentMethod && !paymentRecord.paymentMethod) {
    paymentRecord.paymentMethod = paymentMethod;
  }

  if (paymentRecord.subscriptionId) {
    paymentRecord.razorpayPaymentId = razorpayPaymentId || paymentRecord.razorpayPaymentId;
    paymentRecord.status = 'completed';
    paymentRecord.gatewayResponse = mergeGatewayResponse(paymentRecord.gatewayResponse, {
      activationSource: source,
      activationEvent: eventName,
      subscriptionActivatedAt: new Date().toISOString(),
      ...paymentDetails
    });

    await paymentRecord.save();

    console.log('Subscription already activated (idempotent skip):', String(paymentRecord.subscriptionId));

    return {
      alreadyProcessed: true,
      subscriptionId: paymentRecord.subscriptionId
    };
  }

  const student = await Student.findById(paymentRecord.studentId);

  if (!student) {
    throw new Error('Student not found for payment record');
  }

  if (!paymentRecord.serviceId) {
    throw new Error('Service not linked to payment record');
  }

  const service = await AvailableService.findOne({
    _id: paymentRecord.serviceId,
    isActive: true
  });

  if (!service) {
    throw new Error('Subscription service not found for payment record');
  }

  // Create quota-based subscription
  const result = await createOrUpgradeSubscriptionForStudent({
    student,
    service,
    paymentMethod: paymentRecord.paymentGateway || 'razorpay',
    currency: paymentRecord.currency,
    gatewayResponse: {
      source,
      event: eventName,
      razorpayOrderId: paymentRecord.razorpayOrderId,
      razorpayPaymentId,
      method: paymentMethod,
      ...paymentDetails
    },
    createPaymentRecord: false,
    paymentAmount: paymentRecord.amount
  });

  paymentRecord.subscriptionId = result.subscription._id;
  paymentRecord.razorpayPaymentId = razorpayPaymentId || paymentRecord.razorpayPaymentId;
  paymentRecord.status = 'completed';
  paymentRecord.gatewayResponse = mergeGatewayResponse(paymentRecord.gatewayResponse, {
    paymentCaptured: true,
    activationSource: source,
    activationEvent: eventName,
    subscriptionActivatedAt: new Date().toISOString(),
    subscriptionId: String(result.subscription._id),
    ...paymentDetails
  });

  await paymentRecord.save();

  console.log('Subscription created:', String(result.subscription._id));

  return {
    alreadyProcessed: false,
    subscriptionId: result.subscription._id
  };
};

exports.getGeoLocation = async (req, res) => {
  try {
    const country = getCountryCode(req);
    const isIndian = country ? country === 'IN' : true;
    const currency = isIndian ? 'INR' : 'USD';

    return res.json({
      country,
      currency,
      isIndian
    });
  } catch (error) {
    console.error('Geo location lookup error:', error);

    return res.json({
      country: null,
      currency: 'INR',
      isIndian: true
    });
  }
};

exports.createOrder = async (req, res) => {
  try {
    const amount = Number(req.body?.amount);
    const { keyId } = getRazorpayCredentials();

    if (!req.body?.serviceId && isValidAmount(amount)) {
      const razorpay = getRazorpayInstance();
      const order = await razorpay.orders.create({
        amount,
        currency: 'INR'
      });

      return res.status(201).json({
        success: true,
        order,
        keyId
      });
    }

    const { serviceId } = req.body || {};
    const currency = normalizeCurrency(req.body?.currency, 'INR');

    if (!serviceId || !mongoose.Types.ObjectId.isValid(serviceId)) {
      return res.status(400).json({ error: 'Valid serviceId is required' });
    }

    if (!currency) {
      return res.status(400).json({ error: 'currency must be INR or USD' });
    }

    const student = await Student.findOne({ userId: req.user.userId });

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const service = await AvailableService.findOne({ _id: serviceId, isActive: true });

    if (!service) {
      return res.status(404).json({ error: 'Subscription service not found' });
    }

    const selectedPrice = getServicePrice(service, currency);

    if (typeof selectedPrice !== 'number' || selectedPrice < 0) {
      return res.status(400).json({ error: 'Service price is not configured for the selected currency' });
    }

    const payableAmount = toSmallestUnit(selectedPrice);

    if (!isValidAmount(payableAmount)) {
      return res.status(400).json({ error: 'Service price must be greater than zero' });
    }

    // Check for existing pending order for same student, service, and currency
    const existingPendingOrder = await PaymentRecord.findOne({
      studentId: student._id,
      serviceId: service._id,
      currency,
      status: 'pending'
    }).sort({ createdAt: -1 });

    if (existingPendingOrder) {
      // Verify the order still exists and is valid on Razorpay
      try {
        const razorpay = getRazorpayInstance();
        const existingOrder = await razorpay.orders.fetch(existingPendingOrder.razorpayOrderId);

        if (existingOrder.status === 'created') {
          return res.status(200).json({
            orderId: existingOrder.id,
            amount: existingOrder.amount,
            currency: existingOrder.currency,
            key: keyId,
            serviceName: service.name,
            reused: true
          });
        }

        // Order is no longer valid (paid/expired), mark as failed and create new one
        existingPendingOrder.status = 'failed';
        existingPendingOrder.gatewayResponse = {
          ...existingPendingOrder.gatewayResponse,
          invalidatedAt: new Date().toISOString(),
          razorpayStatus: existingOrder.status
        };
        await existingPendingOrder.save();
      } catch (fetchError) {
        // Order fetch failed, mark as failed and create new one
        existingPendingOrder.status = 'failed';
        existingPendingOrder.gatewayResponse = {
          ...existingPendingOrder.gatewayResponse,
          invalidatedAt: new Date().toISOString(),
          fetchError: fetchError.message
        };
        await existingPendingOrder.save();
      }
    }

    const razorpay = getRazorpayInstance();
    const order = await razorpay.orders.create({
      amount: payableAmount,
      currency,
      receipt: buildReceipt(service._id),
      notes: {
        serviceId: String(service._id),
        studentId: String(student._id)
      }
    });

    await PaymentRecord.create({
      studentId: student._id,
      serviceId: service._id,
      subscriptionId: null,
      amount: selectedPrice,
      currency,
      paymentDate: new Date(),
      status: 'pending',
      razorpayOrderId: order.id,
      transactionId: order.id,
      paymentGateway: 'razorpay',
      paymentMethod: null, // Will be set after payment (upi, card, netbanking, etc.)
      gatewayResponse: {
        orderCreatedAt: new Date().toISOString(),
        razorpayOrderStatus: order.status,
        amount: order.amount,
        currency: order.currency
      }
    });

    return res.status(201).json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      key: keyId,
      serviceName: service.name
    });
  } catch (error) {
    console.error('Razorpay create order error:', error.message);

    if (isRazorpayConfigurationError(error)) {
      return res.status(500).json({ error: error.message });
    }

    if (error.statusCode === 401 || error.description === 'Authentication failed') {
      return res.status(500).json({
        error: 'Razorpay authentication failed. Check RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.'
      });
    }

    return res.status(500).json({ error: 'Failed to create payment order' });
  }
};

exports.verifyPayment = async (req, res) => {
  try {
    const body = req.body || {};

    // Accept both Razorpay's format (razorpay_order_id) and camelCase (orderId)
    const razorpayOrderId = body.razorpay_order_id || body.orderId;
    const razorpayPaymentId = body.razorpay_payment_id || body.paymentId;
    const razorpaySignature = body.razorpay_signature || body.signature;

    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return res.status(400).json({
        error: 'orderId, paymentId, and signature are required'
      });
    }

    const { keySecret } = getRazorpayCredentials();
    const generatedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest('hex');

    if (!timingSafeCompare(generatedSignature, razorpaySignature)) {
      return res.status(400).json({ error: 'Invalid payment signature' });
    }

    const student = await Student.findOne({ userId: req.user.userId });

    if (student) {
      const paymentRecord = await PaymentRecord.findOne({
        studentId: student._id,
        razorpayOrderId: razorpayOrderId
      });

      if (paymentRecord) {
        paymentRecord.razorpayPaymentId = razorpayPaymentId;

        let paymentMethod = null;
        let paymentDetails = {
          signatureVerifiedAt: new Date().toISOString(),
          verificationSource: 'checkout'
        };

        // Fetch payment details from Razorpay to get actual payment method
        try {
          const razorpay = getRazorpayInstance();
          const razorpayPayment = await razorpay.payments.fetch(razorpayPaymentId);
          paymentMethod = razorpayPayment.method || null;

          paymentDetails = {
            ...paymentDetails,
            method: razorpayPayment.method,
            bank: razorpayPayment.bank || null,
            wallet: razorpayPayment.wallet || null,
            vpa: razorpayPayment.vpa || null,
            card: razorpayPayment.card ? {
              last4: razorpayPayment.card.last4,
              network: razorpayPayment.card.network,
              type: razorpayPayment.card.type,
              issuer: razorpayPayment.card.issuer
            } : null,
            email: razorpayPayment.email || null,
            contact: razorpayPayment.contact || null,
            fee: razorpayPayment.fee || null,
            tax: razorpayPayment.tax || null,
            international: razorpayPayment.international || false
          };
        } catch (fetchError) {
          console.error('Failed to fetch payment details:', fetchError.message);
        }

        const activationResult = await activateSubscriptionForPaymentRecord({
          paymentRecord,
          razorpayPaymentId,
          paymentMethod,
          paymentDetails,
          source: 'checkout',
          eventName: 'payment.verified'
        });

        if (activationResult.subscriptionId) {
          const activatedSubscription = await ActiveSubscription.findById(activationResult.subscriptionId)
            .populate('serviceId', 'name tier maxApplications');

          if (activatedSubscription) {
            return res.json({
              success: true,
              message: 'Payment verified and subscription activated',
              payment: {
                razorpay_order_id: razorpayOrderId,
                razorpay_payment_id: razorpayPaymentId
              },
              subscription: {
                id: activatedSubscription._id,
                plan: activatedSubscription.serviceId?.name || null,
                tier: activatedSubscription.serviceId?.tier || null,
                maxApplications: activatedSubscription.serviceId?.maxApplications || null,
                status: activatedSubscription.status,
                startDate: activatedSubscription.startDate
              }
            });
          }
        }
      }
    }

    return res.json({
      success: true,
      message: 'Payment verified successfully',
      payment: {
        razorpay_order_id: razorpayOrderId,
        razorpay_payment_id: razorpayPaymentId
      }
    });
  } catch (error) {
    console.error('Razorpay verify payment error:', error);

    if (isRazorpayConfigurationError(error)) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(500).json({ error: 'Failed to verify payment' });
  }
};

exports.handleWebhook = async (req, res) => {
  try {
    const webhookSignature = req.headers['x-razorpay-signature'];
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    console.log('Webhook event received:', req.body?.event);

    if (!webhookSignature) {
      console.error('Razorpay webhook missing X-Razorpay-Signature header');
      return res.status(200).json({ received: true });
    }

    if (!webhookSecret) {
      console.error('Razorpay webhook secret is not configured');
      return res.status(200).json({ received: true });
    }

    const rawBody = req.rawBody || JSON.stringify(req.body || {});
    const generatedSignature = buildWebhookSignature(rawBody, webhookSecret);

    if (!timingSafeCompare(generatedSignature, webhookSignature)) {
      console.error('Invalid Razorpay webhook signature');
      return res.status(200).json({ received: true });
    }

    const event = req.body || {};

    if (event.event !== 'payment.captured') {
      return res.status(200).json({ received: true });
    }

    const paymentEntity = event.payload?.payment?.entity || {};
    const razorpayOrderId = paymentEntity.order_id;
    const razorpayPaymentId = paymentEntity.id;
    const paymentMethod = paymentEntity.method; // upi, card, netbanking, wallet, etc.

    if (!razorpayOrderId) {
      console.error('Webhook payload is missing order_id');
      return res.status(200).json({ received: true });
    }

    const paymentRecord = await PaymentRecord.findOne({ razorpayOrderId });

    if (!paymentRecord) {
      console.log('No PaymentRecord found for order:', razorpayOrderId);
      return res.status(200).json({ received: true });
    }

    // Extract payment details from webhook payload
    const paymentDetails = {
      method: paymentMethod,
      bank: paymentEntity.bank || null,
      wallet: paymentEntity.wallet || null,
      vpa: paymentEntity.vpa || null,
      card: paymentEntity.card ? {
        last4: paymentEntity.card.last4,
        network: paymentEntity.card.network,
        type: paymentEntity.card.type,
        issuer: paymentEntity.card.issuer
      } : null,
      email: paymentEntity.email || null,
      contact: paymentEntity.contact || null,
      fee: paymentEntity.fee || null,
      tax: paymentEntity.tax || null,
      captured: paymentEntity.captured || false,
      international: paymentEntity.international || false
    };

    await activateSubscriptionForPaymentRecord({
      paymentRecord,
      razorpayPaymentId,
      paymentMethod,
      paymentDetails,
      source: 'razorpay_webhook',
      eventName: event.event
    });

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('Razorpay webhook error:', error);
    return res.status(200).json({ received: true });
  }
};

exports.purchaseZoneAddon = async (req, res) => {
  try {
    const { addonId, zoneIds, currency = 'INR' } = req.body;

    const student = await Student.findOne({ userId: req.user.userId });
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    if (!student.currentSubscriptionId) {
      return res.status(400).json({ error: 'No active subscription' });
    }

    const Addon = require('../models/Addon');
    const addon = await Addon.findById(addonId);
    if (!addon || addon.type !== 'zone') {
      return res.status(400).json({ error: 'Invalid zone addon' });
    }

    // Validate zone selection for non-unlockAllZones addons
    if (!addon.unlockAllZones) {
      if (!Array.isArray(zoneIds) || zoneIds.length !== addon.zoneCount) {
        return res.status(400).json({
          error: `Must select exactly ${addon.zoneCount} zone(s)`
        });
      }

      const { getAccessibleZones } = require('../services/zoneAccessService');
      const access = await getAccessibleZones(student._id);

      if (access.allZones) {
        return res.status(400).json({ error: 'You already have access to all zones' });
      }

      const Zone = require('../models/Zone');
      const zones = await Zone.find({ _id: { $in: zoneIds } });
      if (zones.length !== zoneIds.length) {
        return res.status(400).json({ error: 'Invalid zone ID(s)' });
      }

      const alreadyAccessible = zoneIds.filter(zId =>
        access.zoneIds.some(aId => aId.toString() === zId.toString())
      );
      if (alreadyAccessible.length > 0) {
        return res.status(400).json({ error: 'Some zones are already accessible' });
      }
    }

    const amount = currency === 'INR' ? addon.priceINR : addon.priceUSD;
    if (!amount) {
      return res.status(400).json({ error: 'Addon price not configured for this currency' });
    }

    const razorpay = getRazorpayInstance();
    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100),
      currency,
      notes: {
        type: 'zone_addon',
        studentId: student._id.toString(),
        addonId: addon._id.toString(),
        zoneIds: addon.unlockAllZones ? 'all' : JSON.stringify(zoneIds)
      }
    });

    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      addon: { id: addon._id, name: addon.name }
    });
  } catch (error) {
    console.error('Purchase zone addon error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.verifyZoneAddonPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    const generated_signature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(razorpay_order_id + '|' + razorpay_payment_id)
      .digest('hex');

    if (generated_signature !== razorpay_signature) {
      return res.status(400).json({ error: 'Invalid payment signature' });
    }

    const razorpay = getRazorpayInstance();
    const order = await razorpay.orders.fetch(razorpay_order_id);

    if (order.notes.type !== 'zone_addon') {
      return res.status(400).json({ error: 'Invalid order type' });
    }

    const studentId = order.notes.studentId;
    const addonId = order.notes.addonId;
    const zoneIdsStr = order.notes.zoneIds;

    const student = await Student.findById(studentId);
    const Addon = require('../models/Addon');
    const addon = await Addon.findById(addonId);

    const paymentRecord = await PaymentRecord.create({
      studentId,
      serviceId: null,
      subscriptionId: student.currentSubscriptionId,
      amount: order.amount / 100,
      currency: order.currency,
      paymentDate: new Date(),
      status: 'completed',
      transactionId: razorpay_payment_id,
      paymentMethod: 'razorpay',
      gatewayResponse: { orderId: razorpay_order_id }
    });

    const SubscriptionAddon = require('../models/SubscriptionAddon');
    await SubscriptionAddon.create({
      subscriptionId: student.currentSubscriptionId,
      addonId,
      paymentRecordId: paymentRecord._id,
      quantity: 1
    });

    if (!addon.unlockAllZones && zoneIdsStr !== 'all') {
      const zoneIds = JSON.parse(zoneIdsStr);
      const SubscriptionZone = require('../models/SubscriptionZone');

      for (const zoneId of zoneIds) {
        await SubscriptionZone.findOneAndUpdate(
          { subscriptionId: student.currentSubscriptionId, zoneId },
          {
            $setOnInsert: {
              subscriptionId: student.currentSubscriptionId,
              zoneId,
              source: 'addon',
              createdAt: new Date()
            }
          },
          { upsert: true }
        );
      }
    }

    res.json({ success: true, paymentId: razorpay_payment_id });
  } catch (error) {
    console.error('Verify zone addon payment error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.initiatePayPerJob = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { currency = 'INR' } = req.body;

    const student = await Student.findOne({ userId: req.user.userId });
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const JobPosting = require('../models/JobPosting');
    const job = await JobPosting.findById(jobId);
    if (!job || job.status !== 'approved') {
      return res.status(404).json({ error: 'Job not found' });
    }

    const PayPerJobPurchase = require('../models/PayPerJobPurchase');
    const existingPurchase = await PayPerJobPurchase.findOne({
      studentId: student._id,
      jobPostingId: jobId,
      status: 'completed'
    });
    if (existingPurchase) {
      return res.status(400).json({ error: 'You have already purchased access to this job' });
    }

    const amount = currency === 'INR' ? 2500 : 35;

    let purchase = await PayPerJobPurchase.findOne({
      studentId: student._id,
      jobPostingId: jobId,
      status: { $in: ['pending', 'failed'] }
    });

    const razorpay = getRazorpayInstance();
    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100),
      currency,
      notes: {
        type: 'pay_per_job',
        studentId: student._id.toString(),
        jobPostingId: jobId
      }
    });

    if (purchase) {
      purchase.amount = amount;
      purchase.currency = currency;
      purchase.razorpayOrderId = order.id;
      purchase.status = 'pending';
      await purchase.save();
    } else {
      purchase = await PayPerJobPurchase.create({
        studentId: student._id,
        jobPostingId: jobId,
        amount,
        currency,
        razorpayOrderId: order.id,
        status: 'pending'
      });
    }

    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      purchaseId: purchase._id,
      job: { id: job._id, title: job.title }
    });
  } catch (error) {
    console.error('Initiate pay per job error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.verifyPayPerJob = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    const generated_signature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(razorpay_order_id + '|' + razorpay_payment_id)
      .digest('hex');

    if (generated_signature !== razorpay_signature) {
      return res.status(400).json({ error: 'Invalid payment signature' });
    }

    const student = await Student.findOne({ userId: req.user.userId });
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const PayPerJobPurchase = require('../models/PayPerJobPurchase');
    const purchase = await PayPerJobPurchase.findOne({
      studentId: student._id,
      jobPostingId: jobId,
      razorpayOrderId: razorpay_order_id
    });

    if (!purchase) {
      return res.status(404).json({ error: 'Purchase not found' });
    }

    const paymentRecord = await PaymentRecord.create({
      studentId: student._id,
      serviceId: null,
      subscriptionId: null,
      amount: purchase.amount,
      currency: purchase.currency,
      paymentDate: new Date(),
      status: 'completed',
      transactionId: razorpay_payment_id,
      paymentMethod: 'razorpay',
      gatewayResponse: { orderId: razorpay_order_id, type: 'pay_per_job' }
    });

    purchase.status = 'completed';
    purchase.completedAt = new Date();
    purchase.paymentRecordId = paymentRecord._id;
    await purchase.save();

    res.json({ success: true, paymentId: razorpay_payment_id });
  } catch (error) {
    console.error('Verify pay per job error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};
