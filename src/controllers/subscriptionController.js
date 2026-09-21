"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOrUpgradeSubscriptionForStudent = void 0;
const client_1 = require("../lib/supabase/client");
const subscriptionService_1 = require("../services/subscriptionService");
const applicationService_1 = require("../services/applicationService");
const zonePricingService_1 = require("../services/zonePricingService");
const supabase = (0, client_1.getSupabaseClient)();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isValidUuid = (value) => typeof value === 'string' && UUID_RE.test(value);
const generateTransactionId = () => `txn_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
const DEFAULT_PRO_PLAN_NAME = process.env.PRO_PLAN_NAME?.trim() || 'Pro Plan';
const statusError = (statusCode, message, code) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    if (code)
        error.code = code;
    return error;
};
const getStudentForUser = async (userId) => {
    const { data: student } = await supabase.from('students').select('*').eq('user_id', userId).maybeSingle();
    return student;
};
const getFullServiceById = async (serviceId) => {
    const { data } = await supabase
        .from('available_services')
        .select('id, name, description, max_applications, price, features')
        .eq('id', serviceId)
        .maybeSingle();
    return data;
};
const findDefaultProPlan = async (planKey = 'pro') => {
    const normalizedKey = String(planKey || '').trim().toLowerCase();
    if (normalizedKey && normalizedKey !== 'pro') {
        const { data: directMatch } = await supabase
            .from('available_services')
            .select('*')
            .eq('is_active', true)
            .ilike('name', planKey)
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle();
        if (directMatch)
            return directMatch;
    }
    const { data: strictMatch } = await supabase
        .from('available_services')
        .select('*')
        .eq('is_active', true)
        .ilike('name', DEFAULT_PRO_PLAN_NAME)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
    if (strictMatch)
        return strictMatch;
    const { data: fuzzyMatch } = await supabase
        .from('available_services')
        .select('*')
        .eq('is_active', true)
        .ilike('name', '%pro%')
        .order('price', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (fuzzyMatch)
        return fuzzyMatch;
    const { data: fallback } = await supabase
        .from('available_services')
        .select('*')
        .eq('is_active', true)
        .order('price', { ascending: false })
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
    return fallback;
};
exports.getAvailableServices = async (_req, res) => {
    try {
        const { data: services } = await supabase
            .from('available_services')
            .select('id, name, tier, description, max_applications, price, price_inr, price_usd, currency, billing_cycle, discount, features, badge, display_order, priority_support, profile_boost, application_highlight, all_zones_included')
            .eq('is_active', true)
            .order('display_order', { ascending: true })
            .order('price', { ascending: true });
        const serviceList = services || [];
        const serviceIds = serviceList.map((s) => s.id);
        const { data: planZones } = serviceIds.length
            ? await supabase.from('plan_zones').select('plan_id, zones ( id, name, description )').in('plan_id', serviceIds)
            : { data: [] };
        const zonesByPlan = {};
        for (const pz of planZones || []) {
            const zone = pz.zones;
            if (!zone)
                continue;
            if (!zonesByPlan[pz.plan_id])
                zonesByPlan[pz.plan_id] = [];
            zonesByPlan[pz.plan_id].push(zone);
        }
        const { data: allZones } = await supabase.from('zones').select('id, name, description');
        const servicesWithZones = serviceList.map((service) => ({
            ...service,
            zones: service.all_zones_included ? (allZones || []) : (zonesByPlan[service.id] || [])
        }));
        res.json({ services: servicesWithZones });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
};
exports.getCurrentSubscription = async (req, res) => {
    try {
        const student = await getStudentForUser(req.user.userId);
        if (!student)
            return res.status(404).json({ error: 'Student not found' });
        const applicationLimit = await (0, subscriptionService_1.getApplicationLimit)(student.id);
        const { applicationsUsed } = await (0, applicationService_1.getSubscriptionUsage)(student.id);
        const subscriptionState = await (0, subscriptionService_1.checkSubscriptionStatus)(student.id);
        if (!subscriptionState.subscription) {
            return res.json({
                subscriptionTier: student.subscription_tier || 'free',
                currentSubscription: null,
                status: 'free',
                isActive: true,
                inGracePeriod: false,
                applicationLimit: applicationLimit === Infinity ? null : applicationLimit,
                applicationsUsed,
                applicationsRemaining: applicationLimit === Infinity ? null : Math.max(0, applicationLimit - applicationsUsed)
            });
        }
        const subscription = subscriptionState.subscription;
        res.json({
            subscriptionTier: student.subscription_tier,
            status: subscriptionState.status,
            isActive: subscriptionState.isActive,
            inGracePeriod: subscriptionState.inGracePeriod,
            currentSubscription: {
                id: subscription.id,
                service: subscription.service,
                startDate: subscription.start_date,
                endDate: subscription.end_date,
                status: subscription.status,
                autoRenew: subscription.auto_renew
            },
            applicationLimit: applicationLimit === Infinity ? null : applicationLimit,
            applicationsUsed,
            applicationsRemaining: applicationLimit === Infinity ? null : Math.max(0, applicationLimit - applicationsUsed)
        });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
};
const createOrUpgradeSubscriptionForStudent = async ({ student, service, paymentMethod = 'manual', currency = 'USD', gatewayResponse = null, createPaymentRecord = true, paymentAmount = null }) => {
    if (!student) {
        throw statusError(404, 'Student not found');
    }
    if (!service) {
        throw statusError(404, 'Subscription service not found. Please configure the Pro plan or provide a valid serviceId.');
    }
    if (service.tier === 'free') {
        throw statusError(400, 'Cannot subscribe to free tier through this endpoint');
    }
    const now = new Date();
    let remainingApplications = 0;
    let addonZonesToPreserve = [];
    let currentSubscription = null;
    if (student.current_subscription_id) {
        const { data: curSub } = await supabase
            .from('active_subscriptions')
            .select('*')
            .eq('id', student.current_subscription_id)
            .eq('student_id', student.id)
            .in('status', ['active', 'pending'])
            .maybeSingle();
        if (curSub) {
            const { data: curService } = await supabase
                .from('available_services')
                .select('max_applications')
                .eq('id', curSub.service_id)
                .maybeSingle();
            currentSubscription = curSub;
            const currentMax = curService?.max_applications ?? null;
            const used = curSub.applications_used || 0;
            // Block same plan purchase
            if (curSub.service_id === service.id) {
                const remaining = currentMax === null ? Infinity : currentMax - used;
                if (remaining > 0 || currentMax === null) {
                    throw statusError(400, 'You already have an active subscription to this plan with remaining applications. Please use your current quota or upgrade to a different plan.', 'SAME_PLAN_ACTIVE');
                }
            }
            // Calculate remaining applications to stack (include unused addon credits so
            // they aren't silently discarded when the student upgrades or renews).
            if (currentMax !== null) {
                const addonCredits = await (0, zonePricingService_1.getAdditionalJobCredits)(curSub.id);
                const oldStackedApps = curSub.stacked_applications || 0;
                const effectiveMax = currentMax + oldStackedApps + addonCredits;
                remainingApplications = Math.max(0, effectiveMax - used);
            }
            // If currentMax is null (unlimited), we don't carry over anything special
            // Get addon-purchased zones to preserve
            const { data: addonZones } = await supabase
                .from('subscription_zones')
                .select('zone_id')
                .eq('subscription_id', curSub.id)
                .eq('source', 'addon');
            addonZonesToPreserve = (addonZones || []).map((z) => z.zone_id);
            // Mark previous subscription as exhausted
            await supabase.from('active_subscriptions').update({ status: 'exhausted', auto_renew: false }).eq('id', curSub.id);
        }
    }
    // Create new subscription with stacked quota
    const { data: subscription, error: subError } = await supabase
        .from('active_subscriptions')
        .insert({
        student_id: student.id,
        service_id: service.id,
        start_date: now.toISOString(),
        end_date: null, // Quota-based, not time-based
        status: 'active',
        auto_renew: false,
        applications_used: 0,
        stacked_applications: remainingApplications
    })
        .select()
        .single();
    if (subError || !subscription) {
        throw subError || new Error('Failed to create subscription');
    }
    let paymentRecord = null;
    if (createPaymentRecord) {
        const { data: payment, error: payError } = await supabase
            .from('payment_records')
            .insert({
            student_id: student.id,
            service_id: service.id,
            subscription_id: subscription.id,
            amount: paymentAmount ?? service.price,
            currency: String(currency || 'USD').toUpperCase(),
            payment_date: now.toISOString(),
            status: 'completed',
            transaction_id: generateTransactionId(),
            payment_method: paymentMethod,
            gateway_response: {
                ...gatewayResponse,
                stackedApplications: remainingApplications,
                previousSubscriptionId: currentSubscription?.id || null
            }
        })
            .select()
            .single();
        if (payError)
            throw payError;
        paymentRecord = payment;
    }
    await supabase
        .from('students')
        .update({ current_subscription_id: subscription.id, subscription_tier: service.tier === 'free' ? 'free' : 'paid' })
        .eq('id', student.id);
    // Populate subscription zones from plan configuration
    await (0, zonePricingService_1.ensureSubscriptionZonesForPlan)({ subscriptionId: subscription.id, serviceId: service.id });
    // Preserve addon-purchased zones from previous subscription
    if (addonZonesToPreserve.length > 0) {
        const rows = addonZonesToPreserve.map((zoneId) => ({
            subscription_id: subscription.id,
            zone_id: zoneId,
            source: 'addon'
        }));
        await supabase.from('subscription_zones').upsert(rows, { onConflict: 'subscription_id,zone_id', ignoreDuplicates: true });
    }
    // Also preserve zone-addon records from previous subscription. Job addon
    // credits are already rolled up into remainingApplications (and therefore
    // stacked_applications) above, so job addon records don't need migrating.
    if (currentSubscription) {
        const { data: previousAddons } = await supabase
            .from('subscription_addons')
            .select('*')
            .eq('subscription_id', currentSubscription.id);
        if (previousAddons && previousAddons.length) {
            const { data: zoneAddons } = await supabase.from('addons').select('id').eq('type', 'zone');
            const zoneAddonIds = new Set((zoneAddons || []).map((a) => a.id));
            const zoneAddonsToPreserve = previousAddons.filter((addon) => zoneAddonIds.has(addon.addon_id));
            if (zoneAddonsToPreserve.length > 0) {
                const rows = zoneAddonsToPreserve.map((addon) => ({
                    subscription_id: subscription.id,
                    addon_id: addon.addon_id,
                    payment_record_id: addon.payment_record_id,
                    quantity: addon.quantity
                }));
                await supabase.from('subscription_addons').upsert(rows, { onConflict: 'subscription_id,addon_id', ignoreDuplicates: true });
            }
        }
    }
    const fullService = await getFullServiceById(service.id);
    return {
        subscription: { ...subscription, service: fullService },
        payment: paymentRecord,
        stackedApplications: remainingApplications
    };
};
exports.createOrUpgradeSubscriptionForStudent = createOrUpgradeSubscriptionForStudent;
exports.createOrUpgradeSubscriptionForStudent = exports.createOrUpgradeSubscriptionForStudent;
exports.createOrUpgradeSubscription = async (req, res) => {
    try {
        const { serviceId, planKey = 'pro', paymentMethod = 'manual', currency = 'USD', gatewayResponse = null } = req.body;
        if (serviceId && !isValidUuid(serviceId)) {
            return res.status(400).json({ error: 'Invalid service ID format' });
        }
        const student = await getStudentForUser(req.user.userId);
        if (!student)
            return res.status(404).json({ error: 'Student not found' });
        let service = null;
        if (serviceId) {
            const { data } = await supabase.from('available_services').select('*').eq('id', serviceId).eq('is_active', true).maybeSingle();
            service = data;
        }
        else {
            service = await findDefaultProPlan(planKey);
        }
        if (!service) {
            return res.status(404).json({ error: 'Subscription service not found. Please configure the Pro plan or provide a valid serviceId.' });
        }
        const result = await (0, exports.createOrUpgradeSubscriptionForStudent)({
            student,
            service,
            paymentMethod,
            currency,
            gatewayResponse,
            createPaymentRecord: true,
            paymentAmount: service.price
        });
        res.status(201).json({ subscription: result.subscription, payment: result.payment });
    }
    catch (error) {
        console.error(error);
        if (error.statusCode) {
            return res.status(error.statusCode).json({ error: error.message });
        }
        res.status(500).json({ error: 'Server error' });
    }
};
exports.getPaymentHistory = async (req, res) => {
    try {
        const student = await getStudentForUser(req.user.userId);
        if (!student)
            return res.status(404).json({ error: 'Student not found' });
        const { data: payments } = await supabase
            .from('payment_records')
            .select('*')
            .eq('student_id', student.id)
            .order('payment_date', { ascending: false });
        const paymentList = payments || [];
        const subscriptionIds = [...new Set(paymentList.map((p) => p.subscription_id).filter(Boolean))];
        const { data: subs } = subscriptionIds.length
            ? await supabase.from('active_subscriptions').select('id, service_id').in('id', subscriptionIds)
            : { data: [] };
        const serviceIds = [...new Set((subs || []).map((s) => s.service_id))];
        const { data: services } = serviceIds.length
            ? await supabase.from('available_services').select('id, name, price, max_applications').in('id', serviceIds)
            : { data: [] };
        const serviceMap = new Map((services || []).map((s) => [s.id, s]));
        const subMap = new Map((subs || []).map((s) => [s.id, { ...s, service: serviceMap.get(s.service_id) }]));
        const shaped = paymentList.map((p) => ({
            ...p,
            subscriptionId: p.subscription_id ? subMap.get(p.subscription_id) : null
        }));
        res.json({ payments: shaped });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
};
exports.updateSubscription = async (req, res) => {
    try {
        const { autoRenew, extendByDays, status } = req.body;
        const student = await getStudentForUser(req.user.userId);
        if (!student)
            return res.status(404).json({ error: 'Student not found' });
        if (!student.current_subscription_id) {
            return res.status(404).json({ error: 'No active subscription found for student' });
        }
        const { data: subscription } = await supabase
            .from('active_subscriptions')
            .select('*')
            .eq('id', student.current_subscription_id)
            .eq('student_id', student.id)
            .maybeSingle();
        if (!subscription) {
            await supabase.from('students').update({ current_subscription_id: null, subscription_tier: 'free' }).eq('id', student.id);
            return res.status(404).json({ error: 'Subscription not found' });
        }
        const updateFields = {};
        if (typeof autoRenew !== 'undefined') {
            updateFields.auto_renew = Boolean(autoRenew);
        }
        if (typeof status !== 'undefined') {
            const normalizedStatus = String(status).toLowerCase();
            if (!['active', 'cancelled', 'pending'].includes(normalizedStatus)) {
                return res.status(400).json({ error: 'status must be active, pending, or cancelled' });
            }
            updateFields.status = normalizedStatus;
        }
        let createdPayment = null;
        if (typeof extendByDays !== 'undefined') {
            const extensionDays = parseInt(extendByDays, 10);
            if (Number.isNaN(extensionDays) || extensionDays < 1 || extensionDays > 365) {
                return res.status(400).json({ error: 'extendByDays must be between 1 and 365' });
            }
            const now = new Date();
            const baseline = subscription.end_date && new Date(subscription.end_date) > now ? new Date(subscription.end_date) : new Date(now);
            baseline.setDate(baseline.getDate() + extensionDays);
            updateFields.end_date = baseline.toISOString();
            updateFields.status = 'active';
            const { data: service } = await supabase.from('available_services').select('price').eq('id', subscription.service_id).maybeSingle();
            const { data: payment, error: payError } = await supabase
                .from('payment_records')
                .insert({
                student_id: student.id,
                subscription_id: subscription.id,
                amount: service?.price || 0,
                currency: 'USD',
                payment_date: now.toISOString(),
                status: 'completed',
                transaction_id: generateTransactionId(),
                payment_method: 'renewal',
                gateway_response: { type: 'renewal', extendByDays: extensionDays }
            })
                .select()
                .single();
            if (payError)
                throw payError;
            createdPayment = payment;
        }
        if (Object.keys(updateFields).length === 0) {
            return res.status(400).json({ error: 'No valid fields provided for update' });
        }
        const { data: updatedSubscription, error } = await supabase
            .from('active_subscriptions')
            .update(updateFields)
            .eq('id', subscription.id)
            .select()
            .single();
        if (error)
            throw error;
        if (updatedSubscription.status === 'cancelled') {
            await supabase.from('students').update({ current_subscription_id: null, subscription_tier: 'free' }).eq('id', student.id);
        }
        const fullService = await getFullServiceById(updatedSubscription.service_id);
        res.json({ subscription: { ...updatedSubscription, service: fullService }, payment: createdPayment });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
};
exports.cancelSubscription = async (req, res) => {
    try {
        const student = await getStudentForUser(req.user.userId);
        if (!student)
            return res.status(404).json({ error: 'Student not found' });
        if (!student.current_subscription_id) {
            return res.status(404).json({ error: 'No active subscription found for student' });
        }
        const { data: subscription } = await supabase
            .from('active_subscriptions')
            .update({ status: 'cancelled', auto_renew: false })
            .eq('id', student.current_subscription_id)
            .eq('student_id', student.id)
            .in('status', ['active', 'pending'])
            .select()
            .maybeSingle();
        if (!subscription) {
            await supabase.from('students').update({ current_subscription_id: null, subscription_tier: 'free' }).eq('id', student.id);
            return res.status(404).json({ error: 'Subscription not found or already inactive' });
        }
        await supabase.from('students').update({ current_subscription_id: null, subscription_tier: 'free' }).eq('id', student.id);
        const fullService = await getFullServiceById(subscription.service_id);
        res.json({ message: 'Subscription cancelled successfully', subscription: { ...subscription, service: fullService } });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Server error' });
    }
};
//# sourceMappingURL=subscriptionController.js.map