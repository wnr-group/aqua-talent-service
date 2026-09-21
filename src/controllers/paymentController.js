"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = __importDefault(require("crypto"));
const geoip_lite_1 = __importDefault(require("geoip-lite"));
const client_1 = require("../lib/supabase/client");
const subscriptionController_1 = require("./subscriptionController");
const zonePricingService_1 = require("../services/zonePricingService");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getRazorpayInstance, getRazorpayCredentials, RAZORPAY_CONFIG_ERROR_CODES } = require('../services/razorpayService');
const supabase = (0, client_1.getSupabaseClient)();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isValidUuid = (value) => typeof value === 'string' && UUID_RE.test(value);
const SUPPORTED_CHECKOUT_CURRENCIES = new Set(['INR', 'USD']);
const COUNTRY_HEADER_KEYS = ['cf-ipcountry', 'x-vercel-ip-country', 'x-country-code'];
const RAZORPAY_CONFIGURATION_ERRORS = new Set(Object.values(RAZORPAY_CONFIG_ERROR_CODES));
const isValidAmount = (value) => Number.isInteger(value) && value > 0;
const normalizeCurrency = (value, fallback = 'INR') => {
    const normalized = String(value || fallback).trim().toUpperCase();
    return SUPPORTED_CHECKOUT_CURRENCIES.has(normalized) ? normalized : null;
};
const buildReceipt = (serviceId) => `svc_${String(serviceId).slice(-8)}_${Date.now().toString(36)}`;
const getServicePrice = (service, currency) => {
    if (currency === 'INR') {
        return typeof service.price_inr === 'number' ? service.price_inr : service.price;
    }
    return typeof service.price_usd === 'number' ? service.price_usd : null;
};
const toSmallestUnit = (amount) => Math.round(Number(amount) * 100);
const timingSafeCompare = (left, right) => {
    const leftBuffer = Buffer.from(String(left || ''));
    const rightBuffer = Buffer.from(String(right || ''));
    if (leftBuffer.length !== rightBuffer.length)
        return false;
    return crypto_1.default.timingSafeEqual(leftBuffer, rightBuffer);
};
const mergeGatewayResponse = (currentValue, patch) => {
    const base = currentValue && typeof currentValue === 'object' && !Array.isArray(currentValue) ? currentValue : {};
    return { ...base, ...patch };
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
    if (!value || typeof value !== 'string')
        return null;
    const normalized = value.trim().toUpperCase();
    return normalized.length === 2 ? normalized : null;
};
const getCountryCode = (req) => {
    for (const headerKey of COUNTRY_HEADER_KEYS) {
        const headerValue = normalizeCountryCode(req.headers[headerKey]);
        if (headerValue)
            return headerValue;
    }
    const clientIp = getClientIp(req);
    const geo = clientIp ? geoip_lite_1.default.lookup(clientIp) : null;
    return normalizeCountryCode(geo?.country);
};
const buildWebhookSignature = (rawBody, secret) => crypto_1.default.createHmac('sha256', secret).update(rawBody).digest('hex');
const isRazorpayConfigurationError = (error) => typeof error?.code === 'string' && RAZORPAY_CONFIGURATION_ERRORS.has(error.code);
const activateSubscriptionForPaymentRecord = async ({ paymentRecord, razorpayPaymentId = null, paymentMethod = null, paymentDetails = {}, source, eventName }) => {
    if (!paymentRecord) {
        return { alreadyProcessed: false, subscriptionId: null };
    }
    console.log('Payment captured for order:', paymentRecord.razorpay_order_id);
    const updates = {};
    if (paymentMethod && !paymentRecord.payment_method) {
        updates.payment_method = paymentMethod;
    }
    if (paymentRecord.subscription_id) {
        updates.razorpay_payment_id = razorpayPaymentId || paymentRecord.razorpay_payment_id;
        updates.status = 'completed';
        updates.gateway_response = mergeGatewayResponse(paymentRecord.gateway_response, {
            activationSource: source,
            activationEvent: eventName,
            subscriptionActivatedAt: new Date().toISOString(),
            ...paymentDetails
        });
        await supabase.from('payment_records').update(updates).eq('id', paymentRecord.id);
        console.log('Subscription already activated (idempotent skip):', String(paymentRecord.subscription_id));
        return { alreadyProcessed: true, subscriptionId: paymentRecord.subscription_id };
    }
    const { data: student } = await supabase.from('students').select('*').eq('id', paymentRecord.student_id).maybeSingle();
    if (!student) {
        throw new Error('Student not found for payment record');
    }
    if (!paymentRecord.service_id) {
        throw new Error('Service not linked to payment record');
    }
    const { data: service } = await supabase
        .from('available_services')
        .select('*')
        .eq('id', paymentRecord.service_id)
        .eq('is_active', true)
        .maybeSingle();
    if (!service) {
        throw new Error('Subscription service not found for payment record');
    }
    const result = await (0, subscriptionController_1.createOrUpgradeSubscriptionForStudent)({
        student,
        service,
        paymentMethod: paymentRecord.payment_gateway || 'razorpay',
        currency: paymentRecord.currency,
        gatewayResponse: {
            source,
            event: eventName,
            razorpayOrderId: paymentRecord.razorpay_order_id,
            razorpayPaymentId,
            method: paymentMethod,
            ...paymentDetails
        },
        createPaymentRecord: false,
        paymentAmount: paymentRecord.amount
    });
    await supabase
        .from('payment_records')
        .update({
        subscription_id: result.subscription.id,
        razorpay_payment_id: razorpayPaymentId || paymentRecord.razorpay_payment_id,
        status: 'completed',
        gateway_response: mergeGatewayResponse(paymentRecord.gateway_response, {
            paymentCaptured: true,
            activationSource: source,
            activationEvent: eventName,
            subscriptionActivatedAt: new Date().toISOString(),
            subscriptionId: String(result.subscription.id),
            ...paymentDetails
        })
    })
        .eq('id', paymentRecord.id);
    console.log('Subscription created:', String(result.subscription.id));
    return { alreadyProcessed: false, subscriptionId: result.subscription.id };
};
exports.getGeoLocation = async (req, res) => {
    try {
        const country = getCountryCode(req);
        const isIndian = country ? country === 'IN' : true;
        const currency = isIndian ? 'INR' : 'USD';
        return res.json({ country, currency, isIndian });
    }
    catch (error) {
        console.error('Geo location lookup error:', error);
        return res.json({ country: null, currency: 'INR', isIndian: true });
    }
};
exports.createOrder = async (req, res) => {
    try {
        const amount = Number(req.body?.amount);
        const { keyId } = getRazorpayCredentials();
        if (!req.body?.serviceId && isValidAmount(amount)) {
            const razorpay = getRazorpayInstance();
            const order = await razorpay.orders.create({ amount, currency: 'INR' });
            return res.status(201).json({ success: true, order, keyId });
        }
        const { serviceId } = req.body || {};
        const currency = normalizeCurrency(req.body?.currency, 'INR');
        if (!serviceId || !isValidUuid(serviceId)) {
            return res.status(400).json({ error: 'Valid serviceId is required' });
        }
        if (!currency) {
            return res.status(400).json({ error: 'currency must be INR or USD' });
        }
        const { data: student } = await supabase.from('students').select('*').eq('user_id', req.user.userId).maybeSingle();
        if (!student)
            return res.status(404).json({ error: 'Student not found' });
        const { data: service } = await supabase.from('available_services').select('*').eq('id', serviceId).eq('is_active', true).maybeSingle();
        if (!service)
            return res.status(404).json({ error: 'Subscription service not found' });
        const selectedPrice = getServicePrice(service, currency);
        if (typeof selectedPrice !== 'number' || selectedPrice < 0) {
            return res.status(400).json({ error: 'Service price is not configured for the selected currency' });
        }
        const payableAmount = toSmallestUnit(selectedPrice);
        if (!isValidAmount(payableAmount)) {
            return res.status(400).json({ error: 'Service price must be greater than zero' });
        }
        const { data: existingPendingOrder } = await supabase
            .from('payment_records')
            .select('*')
            .eq('student_id', student.id)
            .eq('service_id', service.id)
            .eq('currency', currency)
            .eq('status', 'pending')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (existingPendingOrder) {
            try {
                const razorpay = getRazorpayInstance();
                const existingOrder = await razorpay.orders.fetch(existingPendingOrder.razorpay_order_id);
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
                await supabase
                    .from('payment_records')
                    .update({
                    status: 'failed',
                    gateway_response: mergeGatewayResponse(existingPendingOrder.gateway_response, {
                        invalidatedAt: new Date().toISOString(),
                        razorpayStatus: existingOrder.status
                    })
                })
                    .eq('id', existingPendingOrder.id);
            }
            catch (fetchError) {
                await supabase
                    .from('payment_records')
                    .update({
                    status: 'failed',
                    gateway_response: mergeGatewayResponse(existingPendingOrder.gateway_response, {
                        invalidatedAt: new Date().toISOString(),
                        fetchError: fetchError.message
                    })
                })
                    .eq('id', existingPendingOrder.id);
            }
        }
        const razorpay = getRazorpayInstance();
        const order = await razorpay.orders.create({
            amount: payableAmount,
            currency,
            receipt: buildReceipt(service.id),
            notes: { serviceId: String(service.id), studentId: String(student.id) }
        });
        await supabase.from('payment_records').insert({
            student_id: student.id,
            service_id: service.id,
            subscription_id: null,
            amount: selectedPrice,
            currency,
            payment_date: new Date().toISOString(),
            status: 'pending',
            razorpay_order_id: order.id,
            transaction_id: order.id,
            payment_gateway: 'razorpay',
            payment_method: null,
            gateway_response: {
                orderCreatedAt: new Date().toISOString(),
                razorpayOrderStatus: order.status,
                amount: order.amount,
                currency: order.currency
            }
        });
        return res.status(201).json({ orderId: order.id, amount: order.amount, currency: order.currency, key: keyId, serviceName: service.name });
    }
    catch (error) {
        console.error('Razorpay create order error:', error.message);
        if (isRazorpayConfigurationError(error)) {
            return res.status(500).json({ error: error.message });
        }
        if (error.statusCode === 401 || error.description === 'Authentication failed') {
            return res.status(500).json({ error: 'Razorpay authentication failed. Check RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.' });
        }
        return res.status(500).json({ error: 'Failed to create payment order' });
    }
};
exports.verifyPayment = async (req, res) => {
    try {
        const body = req.body || {};
        const razorpayOrderId = body.razorpay_order_id || body.orderId;
        const razorpayPaymentId = body.razorpay_payment_id || body.paymentId;
        const razorpaySignature = body.razorpay_signature || body.signature;
        if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
            return res.status(400).json({ error: 'orderId, paymentId, and signature are required' });
        }
        const { keySecret } = getRazorpayCredentials();
        const generatedSignature = crypto_1.default.createHmac('sha256', keySecret).update(`${razorpayOrderId}|${razorpayPaymentId}`).digest('hex');
        if (!timingSafeCompare(generatedSignature, razorpaySignature)) {
            return res.status(400).json({ error: 'Invalid payment signature' });
        }
        const { data: student } = await supabase.from('students').select('*').eq('user_id', req.user.userId).maybeSingle();
        if (student) {
            const { data: paymentRecord } = await supabase
                .from('payment_records')
                .select('*')
                .eq('student_id', student.id)
                .eq('razorpay_order_id', razorpayOrderId)
                .maybeSingle();
            if (paymentRecord) {
                let paymentMethod = null;
                let paymentDetails = {
                    signatureVerifiedAt: new Date().toISOString(),
                    verificationSource: 'checkout'
                };
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
                        card: razorpayPayment.card
                            ? {
                                last4: razorpayPayment.card.last4,
                                network: razorpayPayment.card.network,
                                type: razorpayPayment.card.type,
                                issuer: razorpayPayment.card.issuer
                            }
                            : null,
                        email: razorpayPayment.email || null,
                        contact: razorpayPayment.contact || null,
                        fee: razorpayPayment.fee || null,
                        tax: razorpayPayment.tax || null,
                        international: razorpayPayment.international || false
                    };
                }
                catch (fetchError) {
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
                    const { data: activatedSubscription } = await supabase
                        .from('active_subscriptions')
                        .select('*')
                        .eq('id', activationResult.subscriptionId)
                        .maybeSingle();
                    if (activatedSubscription) {
                        const { data: service } = await supabase
                            .from('available_services')
                            .select('name, tier, max_applications')
                            .eq('id', activatedSubscription.service_id)
                            .maybeSingle();
                        return res.json({
                            success: true,
                            message: 'Payment verified and subscription activated',
                            payment: { razorpay_order_id: razorpayOrderId, razorpay_payment_id: razorpayPaymentId },
                            subscription: {
                                id: activatedSubscription.id,
                                plan: service?.name || null,
                                tier: service?.tier || null,
                                maxApplications: service?.max_applications || null,
                                status: activatedSubscription.status,
                                startDate: activatedSubscription.start_date
                            }
                        });
                    }
                }
            }
        }
        return res.json({
            success: true,
            message: 'Payment verified successfully',
            payment: { razorpay_order_id: razorpayOrderId, razorpay_payment_id: razorpayPaymentId }
        });
    }
    catch (error) {
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
        const paymentMethod = paymentEntity.method;
        if (!razorpayOrderId) {
            console.error('Webhook payload is missing order_id');
            return res.status(200).json({ received: true });
        }
        const { data: paymentRecord } = await supabase
            .from('payment_records')
            .select('*')
            .eq('razorpay_order_id', razorpayOrderId)
            .maybeSingle();
        if (!paymentRecord) {
            console.log('No PaymentRecord found for order:', razorpayOrderId);
            return res.status(200).json({ received: true });
        }
        const paymentDetails = {
            method: paymentMethod,
            bank: paymentEntity.bank || null,
            wallet: paymentEntity.wallet || null,
            vpa: paymentEntity.vpa || null,
            card: paymentEntity.card
                ? {
                    last4: paymentEntity.card.last4,
                    network: paymentEntity.card.network,
                    type: paymentEntity.card.type,
                    issuer: paymentEntity.card.issuer
                }
                : null,
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
    }
    catch (error) {
        console.error('Razorpay webhook error:', error);
        return res.status(200).json({ received: true });
    }
};
exports.purchaseZoneAddon = async (req, res) => {
    try {
        const { addonId, zoneIds, currency = 'INR' } = req.body;
        const { data: student } = await supabase.from('students').select('*').eq('user_id', req.user.userId).maybeSingle();
        if (!student)
            return res.status(404).json({ error: 'Student not found' });
        if (!student.current_subscription_id)
            return res.status(400).json({ error: 'No active subscription' });
        const { data: addon } = await supabase.from('addons').select('*').eq('id', addonId).maybeSingle();
        if (!addon || addon.type !== 'zone') {
            return res.status(400).json({ error: 'Invalid zone addon' });
        }
        if (!addon.unlock_all_zones) {
            if (!Array.isArray(zoneIds) || zoneIds.length !== addon.zone_count) {
                return res.status(400).json({ error: `Must select exactly ${addon.zone_count} zone(s)` });
            }
            const { getAccessibleZones } = require('../services/zoneAccessService');
            const access = await getAccessibleZones(student.id);
            if (access.allZones) {
                return res.status(400).json({ error: 'You already have access to all zones' });
            }
            const { data: zones } = await supabase.from('zones').select('id').in('id', zoneIds);
            if (!zones || zones.length !== zoneIds.length) {
                return res.status(400).json({ error: 'Invalid zone ID(s)' });
            }
            const alreadyAccessible = zoneIds.filter((zId) => access.zoneIds.includes(zId));
            if (alreadyAccessible.length > 0) {
                return res.status(400).json({ error: 'Some zones are already accessible' });
            }
        }
        const amount = currency === 'INR' ? addon.price_inr : addon.price_usd;
        if (!amount) {
            return res.status(400).json({ error: 'Addon price not configured for this currency' });
        }
        const razorpay = getRazorpayInstance();
        const order = await razorpay.orders.create({
            amount: Math.round(amount * 100),
            currency,
            notes: {
                type: 'zone_addon',
                studentId: student.id,
                addonId: addon.id,
                zoneIds: addon.unlock_all_zones ? 'all' : JSON.stringify(zoneIds)
            }
        });
        res.json({ orderId: order.id, amount: order.amount, currency: order.currency, key: process.env.RAZORPAY_KEY_ID, addon: { id: addon.id, name: addon.name } });
    }
    catch (error) {
        console.error('Purchase zone addon error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};
exports.verifyZoneAddonPayment = async (req, res) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
        const generated_signature = crypto_1.default
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
        const { data: student } = await supabase.from('students').select('*').eq('id', studentId).maybeSingle();
        const { data: addon } = await supabase.from('addons').select('*').eq('id', addonId).maybeSingle();
        if (!student || !addon) {
            return res.status(404).json({ error: 'Student or addon not found' });
        }
        if (!student.current_subscription_id) {
            return res.status(400).json({ error: 'No active subscription found. Cannot apply zone addon.' });
        }
        const subscriptionId = student.current_subscription_id;
        const { data: paymentRecord, error: payError } = await supabase
            .from('payment_records')
            .insert({
            student_id: studentId,
            service_id: null,
            subscription_id: subscriptionId,
            amount: order.amount / 100,
            currency: order.currency,
            payment_date: new Date().toISOString(),
            status: 'completed',
            razorpay_order_id,
            razorpay_payment_id,
            transaction_id: razorpay_payment_id,
            payment_method: 'razorpay',
            gateway_response: { orderId: razorpay_order_id, type: 'zone_addon' }
        })
            .select()
            .single();
        if (payError)
            throw payError;
        const { data: existingAddon } = await supabase
            .from('subscription_addons')
            .select('*')
            .eq('subscription_id', subscriptionId)
            .eq('addon_id', addonId)
            .maybeSingle();
        if (existingAddon) {
            await supabase
                .from('subscription_addons')
                .update({ quantity: existingAddon.quantity + 1, payment_record_id: paymentRecord.id })
                .eq('id', existingAddon.id);
        }
        else {
            await supabase.from('subscription_addons').insert({
                subscription_id: subscriptionId,
                addon_id: addonId,
                quantity: 1,
                payment_record_id: paymentRecord.id
            });
        }
        if (!addon.unlock_all_zones && zoneIdsStr !== 'all') {
            const zoneIds = JSON.parse(zoneIdsStr);
            for (const zoneId of zoneIds) {
                const { data: existingZone } = await supabase
                    .from('subscription_zones')
                    .select('id')
                    .eq('subscription_id', subscriptionId)
                    .eq('zone_id', zoneId)
                    .maybeSingle();
                if (!existingZone) {
                    await supabase.from('subscription_zones').insert({
                        subscription_id: subscriptionId,
                        zone_id: zoneId,
                        source: 'addon'
                    });
                }
            }
        }
        res.json({ success: true, paymentId: razorpay_payment_id });
    }
    catch (error) {
        console.error('Verify zone addon payment error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};
exports.initiatePayPerJob = async (req, res) => {
    try {
        const jobId = req.params.jobId || req.body.jobId;
        const { currency = 'INR' } = req.body;
        if (!jobId) {
            return res.status(400).json({ error: 'jobId is required' });
        }
        const { data: student } = await supabase.from('students').select('*').eq('user_id', req.user.userId).maybeSingle();
        if (!student)
            return res.status(404).json({ error: 'Student not found' });
        const { data: job } = await supabase.from('job_postings').select('*').eq('id', jobId).maybeSingle();
        if (!job || job.status !== 'approved') {
            return res.status(404).json({ error: 'Job not found' });
        }
        const { data: existingPurchase } = await supabase
            .from('pay_per_job_purchases')
            .select('id')
            .eq('student_id', student.id)
            .eq('job_posting_id', jobId)
            .eq('status', 'completed')
            .maybeSingle();
        if (existingPurchase) {
            return res.status(400).json({ error: 'You have already purchased access to this job' });
        }
        const payPerJobPricing = await (0, zonePricingService_1.getPayPerJobPricing)();
        const amount = currency === 'INR' ? payPerJobPricing.priceINR : payPerJobPricing.priceUSD;
        const { data: pendingPurchase } = await supabase
            .from('pay_per_job_purchases')
            .select('*')
            .eq('student_id', student.id)
            .eq('job_posting_id', jobId)
            .in('status', ['pending', 'failed'])
            .maybeSingle();
        const razorpay = getRazorpayInstance();
        const order = await razorpay.orders.create({
            amount: Math.round(amount * 100),
            currency,
            notes: { type: 'pay_per_job', studentId: student.id, jobPostingId: jobId }
        });
        let purchase;
        if (pendingPurchase) {
            const { data: updated, error } = await supabase
                .from('pay_per_job_purchases')
                .update({ amount, currency, razorpay_order_id: order.id, status: 'pending' })
                .eq('id', pendingPurchase.id)
                .select()
                .single();
            if (error)
                throw error;
            purchase = updated;
        }
        else {
            const { data: created, error } = await supabase
                .from('pay_per_job_purchases')
                .insert({ student_id: student.id, job_posting_id: jobId, amount, currency, razorpay_order_id: order.id, status: 'pending' })
                .select()
                .single();
            if (error)
                throw error;
            purchase = created;
        }
        res.json({
            orderId: order.id,
            amount: order.amount,
            currency: order.currency,
            key: process.env.RAZORPAY_KEY_ID,
            purchaseId: purchase.id,
            job: { id: job.id, title: job.title }
        });
    }
    catch (error) {
        console.error('Initiate pay per job error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};
exports.verifyPayPerJob = async (req, res) => {
    try {
        const razorpay_order_id = req.body.razorpay_order_id || req.body.orderId;
        const razorpay_payment_id = req.body.razorpay_payment_id || req.body.paymentId;
        const razorpay_signature = req.body.razorpay_signature || req.body.signature;
        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return res.status(400).json({ error: 'Missing payment verification fields' });
        }
        const generated_signature = crypto_1.default
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(razorpay_order_id + '|' + razorpay_payment_id)
            .digest('hex');
        if (generated_signature !== razorpay_signature) {
            return res.status(400).json({ error: 'Invalid payment signature' });
        }
        const { data: student } = await supabase.from('students').select('*').eq('user_id', req.user.userId).maybeSingle();
        if (!student)
            return res.status(404).json({ error: 'Student not found' });
        const { data: purchase } = await supabase
            .from('pay_per_job_purchases')
            .select('*')
            .eq('student_id', student.id)
            .eq('razorpay_order_id', razorpay_order_id)
            .maybeSingle();
        if (!purchase)
            return res.status(404).json({ error: 'Purchase not found' });
        const { data: paymentRecord, error: payError } = await supabase
            .from('payment_records')
            .insert({
            student_id: student.id,
            service_id: null,
            subscription_id: null,
            amount: purchase.amount,
            currency: purchase.currency,
            payment_date: new Date().toISOString(),
            status: 'completed',
            razorpay_order_id,
            razorpay_payment_id,
            transaction_id: razorpay_payment_id,
            payment_gateway: 'razorpay',
            payment_method: 'razorpay',
            gateway_response: { orderId: razorpay_order_id, type: 'pay_per_job' }
        })
            .select()
            .single();
        if (payError)
            throw payError;
        await supabase
            .from('pay_per_job_purchases')
            .update({ status: 'completed', completed_at: new Date().toISOString(), payment_record_id: paymentRecord.id })
            .eq('id', purchase.id);
        res.json({ success: true, paymentId: razorpay_payment_id });
    }
    catch (error) {
        console.error('Verify pay per job error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};
exports.purchaseJobsAddon = async (req, res) => {
    try {
        const { addonId, currency = 'INR' } = req.body;
        const { data: student } = await supabase.from('students').select('*').eq('user_id', req.user.userId).maybeSingle();
        if (!student)
            return res.status(404).json({ error: 'Student not found' });
        if (!student.current_subscription_id)
            return res.status(400).json({ error: 'No active subscription' });
        const { data: addon } = await supabase.from('addons').select('*').eq('id', addonId).maybeSingle();
        if (!addon || addon.type !== 'jobs') {
            return res.status(400).json({ error: 'Invalid job credits addon' });
        }
        const amount = currency === 'INR' ? addon.price_inr : addon.price_usd;
        if (!amount) {
            return res.status(400).json({ error: 'Addon price not configured for this currency' });
        }
        const razorpay = getRazorpayInstance();
        const order = await razorpay.orders.create({
            amount: Math.round(amount * 100),
            currency,
            notes: { type: 'jobs_addon', studentId: student.id, addonId: addon.id }
        });
        res.json({
            orderId: order.id,
            amount: order.amount,
            currency: order.currency,
            key: process.env.RAZORPAY_KEY_ID,
            addon: { id: addon.id, name: addon.name, jobCredits: addon.job_credit_count }
        });
    }
    catch (error) {
        console.error('Purchase jobs addon error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};
exports.verifyJobsAddonPayment = async (req, res) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
        const generated_signature = crypto_1.default
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(razorpay_order_id + '|' + razorpay_payment_id)
            .digest('hex');
        if (generated_signature !== razorpay_signature) {
            return res.status(400).json({ error: 'Invalid payment signature' });
        }
        const razorpay = getRazorpayInstance();
        const order = await razorpay.orders.fetch(razorpay_order_id);
        if (order.notes.type !== 'jobs_addon') {
            return res.status(400).json({ error: 'Invalid order type' });
        }
        const studentId = order.notes.studentId;
        const addonId = order.notes.addonId;
        // Re-fetch the student to get the CURRENT subscriptionId at the time of
        // verification - the order was created earlier and the student may have
        // upgraded their plan in between (stale subscriptionId mismatch).
        const { data: student } = await supabase.from('students').select('*').eq('id', studentId).maybeSingle();
        if (!student)
            return res.status(404).json({ error: 'Student not found' });
        if (!student.current_subscription_id) {
            console.error('[verifyJobsAddonPayment] No active subscription — cannot attach addon', { studentId, razorpay_order_id });
            return res.status(400).json({ error: 'No active subscription found. Cannot apply extra credits.' });
        }
        const { data: addon } = await supabase.from('addons').select('*').eq('id', addonId).maybeSingle();
        if (!addon || addon.type !== 'jobs') {
            return res.status(400).json({ error: 'Invalid addon' });
        }
        const { data: paymentRecord, error: payError } = await supabase
            .from('payment_records')
            .insert({
            student_id: studentId,
            service_id: null,
            subscription_id: student.current_subscription_id,
            amount: order.amount / 100,
            currency: order.currency,
            payment_date: new Date().toISOString(),
            status: 'completed',
            razorpay_order_id,
            razorpay_payment_id,
            transaction_id: razorpay_payment_id,
            payment_method: 'razorpay',
            gateway_response: { orderId: razorpay_order_id, type: 'jobs_addon' }
        })
            .select()
            .single();
        if (payError)
            throw payError;
        const { data: existingAddon } = await supabase
            .from('subscription_addons')
            .select('*')
            .eq('subscription_id', student.current_subscription_id)
            .eq('addon_id', addonId)
            .maybeSingle();
        let updatedAddon;
        if (existingAddon) {
            const { data, error } = await supabase
                .from('subscription_addons')
                .update({ quantity: existingAddon.quantity + 1, payment_record_id: paymentRecord.id })
                .eq('id', existingAddon.id)
                .select()
                .single();
            if (error)
                throw error;
            updatedAddon = data;
        }
        else {
            const { data, error } = await supabase
                .from('subscription_addons')
                .insert({ subscription_id: student.current_subscription_id, addon_id: addonId, quantity: 1, payment_record_id: paymentRecord.id })
                .select()
                .single();
            if (error)
                throw error;
            updatedAddon = data;
        }
        if (!updatedAddon) {
            console.error('[verifyJobsAddonPayment] CRITICAL — SubscriptionAddon upsert returned null', {
                studentId,
                subscriptionId: student.current_subscription_id,
                addonId,
                razorpay_payment_id
            });
            return res.status(500).json({ error: 'Failed to update job credits in database. Please contact support.' });
        }
        console.log('[verifyJobsAddonPayment]', {
            studentId,
            subscriptionId: student.current_subscription_id,
            addonCredits: addon.job_credit_count,
            newQuantity: updatedAddon.quantity
        });
        res.json({ success: true, paymentId: razorpay_payment_id, jobCreditsAdded: addon.job_credit_count });
    }
    catch (error) {
        console.error('Verify jobs addon payment error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};
//# sourceMappingURL=paymentController.js.map