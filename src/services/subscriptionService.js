"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSubscriptionActive = exports.getApplicationLimit = exports.checkSubscriptionStatus = exports.getFreeTierMaxApplications = exports.SUBSCRIPTION_GRACE_PERIOD_DAYS = void 0;
const client_1 = require("../lib/supabase/client");
const zonePricingService_1 = require("./zonePricingService");
const DEFAULT_FREE_TIER_MAX_APPLICATIONS = 2;
exports.SUBSCRIPTION_GRACE_PERIOD_DAYS = 3;
const toGracePeriodEnd = (endDate) => {
    const graceEndDate = new Date(endDate);
    graceEndDate.setDate(graceEndDate.getDate() + exports.SUBSCRIPTION_GRACE_PERIOD_DAYS);
    return graceEndDate;
};
const getFreeTierMaxApplications = async () => DEFAULT_FREE_TIER_MAX_APPLICATIONS;
exports.getFreeTierMaxApplications = getFreeTierMaxApplications;
/**
 * Returns the subscription row with its plan attached under `.service`
 * (raw snake_case available_services row), mirroring the old
 * `.populate('serviceId')` call but under an explicit key instead of
 * overwriting serviceId in place.
 */
const checkSubscriptionStatus = async (studentId) => {
    const supabase = (0, client_1.getSupabaseClient)();
    const { data: student } = await supabase.from('students').select('current_subscription_id').eq('id', studentId).maybeSingle();
    if (!student || !student.current_subscription_id) {
        return { tier: 'free', status: 'free', isActive: true, inGracePeriod: false, subscription: null };
    }
    const { data: subscription } = await supabase
        .from('active_subscriptions')
        .select('*')
        .eq('id', student.current_subscription_id)
        .maybeSingle();
    if (!subscription) {
        await supabase.from('students').update({ current_subscription_id: null, subscription_tier: 'free' }).eq('id', studentId);
        return { tier: 'free', status: 'free', isActive: true, inGracePeriod: false, subscription: null };
    }
    const { data: service } = await supabase.from('available_services').select('*').eq('id', subscription.service_id).maybeSingle();
    const subscriptionWithService = { ...subscription, service };
    if (subscription.status === 'cancelled') {
        return { tier: 'paid', status: 'cancelled', isActive: false, inGracePeriod: false, subscription: subscriptionWithService };
    }
    const now = new Date();
    const endDate = subscription.end_date ? new Date(subscription.end_date) : new Date('2099-12-31');
    const gracePeriodEnd = toGracePeriodEnd(endDate.toISOString());
    const inGracePeriod = endDate < now && now <= gracePeriodEnd;
    const isActive = subscription.status === 'active' && (endDate >= now || inGracePeriod);
    let status = subscription.status;
    if (!isActive && subscription.status !== 'expired' && endDate < now) {
        await supabase.from('active_subscriptions').update({ status: 'expired' }).eq('id', subscription.id);
        status = 'expired';
    }
    return {
        tier: 'paid',
        status,
        isActive,
        inGracePeriod,
        subscription: { ...subscriptionWithService, status }
    };
};
exports.checkSubscriptionStatus = checkSubscriptionStatus;
const getApplicationLimit = async (studentId) => {
    const supabase = (0, client_1.getSupabaseClient)();
    const { data: student } = await supabase.from('students').select('current_subscription_id, subscription_tier').eq('id', studentId).maybeSingle();
    if (student?.current_subscription_id) {
        const { data: subscription } = await supabase
            .from('active_subscriptions')
            .select('id, stacked_applications, service_id')
            .eq('id', student.current_subscription_id)
            .maybeSingle();
        if (subscription) {
            const { data: service } = await supabase
                .from('available_services')
                .select('tier, max_applications')
                .eq('id', subscription.service_id)
                .maybeSingle();
            if (service?.tier === 'free') {
                // Include any purchased job-addon credits even on the free-tier plan so that
                // students who bought extra credits while on a free plan are not silently blocked.
                const addonCredits = await (0, zonePricingService_1.getAdditionalJobCredits)(subscription.id);
                const freeMax = await (0, exports.getFreeTierMaxApplications)();
                return freeMax + addonCredits;
            }
            if (typeof service?.max_applications === 'number') {
                // Include stacked applications from previous plan
                const baseLimit = service.max_applications;
                const stackedApps = subscription.stacked_applications || 0;
                // Include additional job credits from addons
                const addonCredits = await (0, zonePricingService_1.getAdditionalJobCredits)(subscription.id);
                return baseLimit + stackedApps + addonCredits;
            }
            // max_applications is null means unlimited
            if (service && service.max_applications === null) {
                return Infinity;
            }
        }
    }
    if (student?.subscription_tier === 'free') {
        return (0, exports.getFreeTierMaxApplications)();
    }
    return Infinity;
};
exports.getApplicationLimit = getApplicationLimit;
const isSubscriptionActive = async (studentId) => {
    const status = await (0, exports.checkSubscriptionStatus)(studentId);
    return status.isActive;
};
exports.isSubscriptionActive = isSubscriptionActive;
//# sourceMappingURL=subscriptionService.js.map