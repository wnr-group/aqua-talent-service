import { getSupabaseClient } from '../lib/supabase/client';
import { getAdditionalJobCredits } from './zonePricingService';

const DEFAULT_FREE_TIER_MAX_APPLICATIONS = 2;
export const SUBSCRIPTION_GRACE_PERIOD_DAYS = 3;

const toGracePeriodEnd = (endDate: string): Date => {
  const graceEndDate = new Date(endDate);
  graceEndDate.setDate(graceEndDate.getDate() + SUBSCRIPTION_GRACE_PERIOD_DAYS);
  return graceEndDate;
};

export const getFreeTierMaxApplications = async (): Promise<number> => DEFAULT_FREE_TIER_MAX_APPLICATIONS;

/**
 * Returns the subscription row with its plan attached under `.service`
 * (raw snake_case available_services row), mirroring the old
 * `.populate('serviceId')` call but under an explicit key instead of
 * overwriting serviceId in place.
 */
export const checkSubscriptionStatus = async (studentId: string) => {
  const supabase = getSupabaseClient();
  const { data: student } = await supabase.from('students').select('current_subscription_id').eq('id', studentId).maybeSingle();

  if (!student || !student.current_subscription_id) {
    return { tier: 'free' as const, status: 'free', isActive: true, inGracePeriod: false, subscription: null as any };
  }

  const { data: subscription } = await supabase
    .from('active_subscriptions')
    .select('*')
    .eq('id', student.current_subscription_id)
    .maybeSingle();

  if (!subscription) {
    // Best-effort self-heal of a stale pointer - the return value below is
    // already correct regardless of whether this write succeeds, so log
    // instead of throwing (this is a read-path helper called on every
    // dashboard/status check, not just error-recovery flows).
    const { error: clearStaleError } = await supabase.from('students').update({ current_subscription_id: null, subscription_tier: 'free' }).eq('id', studentId);
    if (clearStaleError) {
      console.error('[checkSubscriptionStatus] Failed to clear stale subscription pointer', { studentId, error: clearStaleError });
    }
    return { tier: 'free' as const, status: 'free', isActive: true, inGracePeriod: false, subscription: null as any };
  }

  const { data: service } = await supabase.from('available_services').select('*').eq('id', subscription.service_id).maybeSingle();
  const subscriptionWithService = { ...subscription, service };

  if (subscription.status === 'cancelled') {
    return { tier: 'paid' as const, status: 'cancelled', isActive: false, inGracePeriod: false, subscription: subscriptionWithService };
  }

  const now = new Date();
  const endDate = subscription.end_date ? new Date(subscription.end_date) : new Date('2099-12-31');
  const gracePeriodEnd = toGracePeriodEnd(endDate.toISOString());

  const inGracePeriod = endDate < now && now <= gracePeriodEnd;
  const isActive = subscription.status === 'active' && (endDate >= now || inGracePeriod);

  let status = subscription.status;
  if (!isActive && subscription.status !== 'expired' && endDate < now) {
    // Lazy-expiration persist - the computed status/isActive returned below
    // are already correct in-memory either way, so log rather than throw.
    const { error: expireError } = await supabase.from('active_subscriptions').update({ status: 'expired' }).eq('id', subscription.id);
    if (expireError) {
      console.error('[checkSubscriptionStatus] Failed to persist expired status', { subscriptionId: subscription.id, error: expireError });
    }
    status = 'expired';
  }

  return {
    tier: 'paid' as const,
    status,
    isActive,
    inGracePeriod,
    subscription: { ...subscriptionWithService, status }
  };
};

export const getApplicationLimit = async (studentId: string): Promise<number> => {
  const supabase = getSupabaseClient();
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
        const addonCredits = await getAdditionalJobCredits(subscription.id);
        const freeMax = await getFreeTierMaxApplications();
        return freeMax + addonCredits;
      }

      if (typeof service?.max_applications === 'number') {
        // Include stacked applications from previous plan
        const baseLimit = service.max_applications;
        const stackedApps = subscription.stacked_applications || 0;

        // Include additional job credits from addons
        const addonCredits = await getAdditionalJobCredits(subscription.id);

        return baseLimit + stackedApps + addonCredits;
      }

      // max_applications is null means unlimited
      if (service && service.max_applications === null) {
        return Infinity;
      }
    }
  }

  if (student?.subscription_tier === 'free') {
    return getFreeTierMaxApplications();
  }

  return Infinity;
};

export const isSubscriptionActive = async (studentId: string): Promise<boolean> => {
  const status = await checkSubscriptionStatus(studentId);
  return status.isActive;
};
