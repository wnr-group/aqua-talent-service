import { getSupabaseClient } from '../lib/supabase/client';

export const ensureSubscriptionZonesForPlan = async ({
  subscriptionId,
  serviceId
}: { subscriptionId?: string | null; serviceId?: string | null }): Promise<number> => {
  if (!subscriptionId || !serviceId) {
    return 0;
  }

  const supabase = getSupabaseClient();

  const { data: plan } = await supabase.from('available_services').select('all_zones_included').eq('id', serviceId).maybeSingle();

  // Skip if plan has allZonesIncluded
  if (plan?.all_zones_included) {
    return 0;
  }

  const { data: planZones } = await supabase.from('plan_zones').select('zone_id').eq('plan_id', serviceId);

  if (!planZones || !planZones.length) {
    return 0;
  }

  const rows = planZones.map((pz) => ({
    subscription_id: subscriptionId,
    zone_id: pz.zone_id,
    source: 'plan' as const
  }));

  const { data: inserted, error } = await supabase
    .from('subscription_zones')
    .upsert(rows, { onConflict: 'subscription_id,zone_id', ignoreDuplicates: true })
    .select();

  if (error) {
    throw error;
  }

  return inserted?.length || 0;
};

export const getAdditionalJobCredits = async (subscriptionId?: string | null): Promise<number> => {
  if (!subscriptionId) {
    return 0;
  }

  const supabase = getSupabaseClient();

  const { data: subAddons } = await supabase
    .from('subscription_addons')
    .select('addon_id, quantity')
    .eq('subscription_id', subscriptionId);

  if (!subAddons || !subAddons.length) {
    return 0;
  }

  const addonIds = subAddons.map((sa) => sa.addon_id);
  const { data: addons } = await supabase
    .from('addons')
    .select('id, job_credit_count')
    .in('id', addonIds)
    .eq('type', 'jobs');

  const jobAddonCredits = new Map((addons || []).map((a) => [a.id, a.job_credit_count || 0]));

  return subAddons.reduce((total, sa) => {
    const credits = jobAddonCredits.get(sa.addon_id);
    return credits === undefined ? total : total + sa.quantity * credits;
  }, 0);
};

/** Mirrors the old Addon.getPayPerJobPricing() static. */
export const getPayPerJobPricing = async (): Promise<{ priceINR: number; priceUSD: number }> => {
  const supabase = getSupabaseClient();
  const { data: addon } = await supabase
    .from('addons')
    .select('price_inr, price_usd')
    .eq('type', 'pay-per-job')
    .maybeSingle();

  if (addon) {
    return { priceINR: addon.price_inr ?? 0, priceUSD: addon.price_usd ?? 0 };
  }

  // Fallback defaults if not configured
  return { priceINR: 2500, priceUSD: 35 };
};
