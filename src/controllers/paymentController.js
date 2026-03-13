const crypto = require('crypto');
const mongoose = require('mongoose');
const geoip = require('geoip-lite');

const Student = require('../models/Student');
const Company = require('../models/Company');
const AvailableService = require('../models/AvailableService');
const PaymentRecord = require('../models/PaymentRecord');
const {
  getRazorpayInstance,
  getRazorpayCredentialDiagnostics,
  getRazorpayCredentials,
  getRazorpayKeyMode,
  logRazorpayDebug,
  RAZORPAY_CONFIG_ERROR_CODES,
  validateRazorpayEnvironment
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

  if (paymentRecord.subscriptionId) {
    paymentRecord.razorpayPaymentId = razorpayPaymentId || paymentRecord.razorpayPaymentId;
    paymentRecord.status = 'completed';
    paymentRecord.gatewayResponse = mergeGatewayResponse(paymentRecord.gatewayResponse, {
      activationSource: source,
      activationEvent: eventName,
      subscriptionActivatedAt: new Date().toISOString()
    });

    await paymentRecord.save();

    console.log('Subscription already exists:', String(paymentRecord.subscriptionId));

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

  if (paymentRecord.companyId) {
    const companyExists = await Company.exists({ _id: paymentRecord.companyId });

    if (!companyExists) {
      throw new Error('Company not found for payment record');
    }
  }

  const result = await createOrUpgradeSubscriptionForStudent({
    student,
    service,
    autoRenew: false,
    paymentMethod: 'razorpay',
    currency: paymentRecord.currency,
    gatewayResponse: {
      source,
      event: eventName,
      razorpayOrderId: paymentRecord.razorpayOrderId,
      razorpayPaymentId
    },
    companyId: paymentRecord.companyId,
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
    subscriptionId: String(result.subscription._id)
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
    const diagnostics = getRazorpayCredentialDiagnostics();

    logRazorpayDebug('Create order credential diagnostics', {
      keyIdPresent: diagnostics.keyIdPresent,
      keySecretPresent: diagnostics.keySecretPresent,
      keySecretLength: diagnostics.keySecretLength,
      keyMode: diagnostics.keyMode
    });

    const { keyId, keySecret } = validateRazorpayEnvironment();

    if (!req.body?.serviceId && isValidAmount(amount)) {
      const razorpay = getRazorpayInstance();
      const orderPayload = {
        amount,
        currency: 'INR'
      };

      logRazorpayDebug('Creating direct order', {
        keyIdPresent: Boolean(keyId),
        keySecretPresent: Boolean(keySecret),
        keySecretLength: keySecret.length,
        keyMode: getRazorpayKeyMode(keyId),
        payload: orderPayload
      });

      const order = await razorpay.orders.create(orderPayload);

      logRazorpayDebug('Direct order created', {
        orderId: order.id,
        status: order.status,
        amount: order.amount,
        currency: order.currency
      });

      return res.status(201).json({
        success: true,
        order,
        keyId
      });
    }

    const { serviceId, companyId = null } = req.body || {};
    const currency = normalizeCurrency(req.body?.currency, 'INR');

    if (!serviceId || !mongoose.Types.ObjectId.isValid(serviceId)) {
      return res.status(400).json({ error: 'Valid serviceId is required' });
    }

    if (!currency) {
      return res.status(400).json({ error: 'currency must be INR or USD' });
    }

    if (companyId && !mongoose.Types.ObjectId.isValid(companyId)) {
      return res.status(400).json({ error: 'Invalid company ID format' });
    }

    const student = await Student.findOne({ userId: req.user.userId });

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const service = await AvailableService.findOne({ _id: serviceId, isActive: true });

    if (!service) {
      return res.status(404).json({ error: 'Subscription service not found' });
    }

    if (service.isCompanySpotlight && !companyId) {
      return res.status(400).json({ error: 'companyId is required for spotlight subscriptions' });
    }

    if (companyId) {
      const companyExists = await Company.exists({ _id: companyId });

      if (!companyExists) {
        return res.status(404).json({ error: 'Company not found' });
      }
    }

    const selectedPrice = getServicePrice(service, currency);

    if (typeof selectedPrice !== 'number' || selectedPrice < 0) {
      return res.status(400).json({ error: 'Service price is not configured for the selected currency' });
    }

    const payableAmount = toSmallestUnit(selectedPrice);

    if (!isValidAmount(payableAmount)) {
      return res.status(400).json({ error: 'Service price must be greater than zero' });
    }

    const razorpay = getRazorpayInstance();
    const orderPayload = {
      amount: payableAmount,
      currency,
      receipt: buildReceipt(service._id),
      notes: {
        serviceId: String(service._id),
        studentId: String(student._id),
        companyId: companyId ? String(companyId) : ''
      }
    };

    logRazorpayDebug('Creating service order', {
      keyIdPresent: Boolean(keyId),
      keySecretPresent: Boolean(keySecret),
      keySecretLength: keySecret.length,
      keyMode: getRazorpayKeyMode(keyId),
      payload: orderPayload
    });

    const order = await razorpay.orders.create(orderPayload);

    logRazorpayDebug('Service order created', {
      orderId: order.id,
      status: order.status,
      amount: order.amount,
      currency: order.currency
    });

    await PaymentRecord.create({
      studentId: student._id,
      serviceId: service._id,
      subscriptionId: null,
      companyId,
      amount: selectedPrice,
      currency,
      paymentDate: new Date(),
      status: 'pending',
      razorpayOrderId: order.id,
      transactionId: order.id,
      paymentMethod: 'razorpay',
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
    const diagnostics = getRazorpayCredentialDiagnostics();

    console.error('Razorpay create order error:', {
      message: error.message,
      code: error.code,
      statusCode: error.statusCode,
      error: error.error,
      description: error.description,
      ...diagnostics
    });

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
    const {
      razorpay_order_id: razorpayOrderId,
      razorpay_payment_id: razorpayPaymentId,
      razorpay_signature: razorpaySignature
    } = req.body || {};

    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return res.status(400).json({
        error: 'razorpay_order_id, razorpay_payment_id, and razorpay_signature are required'
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
        paymentRecord.gatewayResponse = mergeGatewayResponse(paymentRecord.gatewayResponse, {
          signatureVerifiedAt: new Date().toISOString(),
          verificationSource: 'checkout'
        });

        await activateSubscriptionForPaymentRecord({
          paymentRecord,
          razorpayPaymentId,
          source: 'checkout',
          eventName: 'payment.verified'
        });
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

    if (!razorpayOrderId) {
      console.error('Webhook payload is missing order_id');
      return res.status(200).json({ received: true });
    }

    const paymentRecord = await PaymentRecord.findOne({ razorpayOrderId });

    if (!paymentRecord) {
      console.log('No PaymentRecord found for order:', razorpayOrderId);
      return res.status(200).json({ received: true });
    }

    await activateSubscriptionForPaymentRecord({
      paymentRecord,
      razorpayPaymentId,
      source: 'razorpay_webhook',
      eventName: event.event
    });

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('Razorpay webhook error:', error);
    return res.status(200).json({ received: true });
  }
};
