import { getSupabaseClient } from '../lib/supabase/client';
import { getPayPerJobPricing } from './zonePricingService';

export const getAccessibleZones = async (studentId: string): Promise<{ allZones: boolean; zoneIds: string[] }> => {
  const supabase = getSupabaseClient();

  const { data: student } = await supabase.from('students').select('current_subscription_id').eq('id', studentId).maybeSingle();
  if (!student || !student.current_subscription_id) {
    return { allZones: false, zoneIds: [] };
  }

  const { data: subscription } = await supabase
    .from('active_subscriptions')
    .select('id, service_id')
    .eq('id', student.current_subscription_id)
    .maybeSingle();
  if (!subscription) {
    return { allZones: false, zoneIds: [] };
  }

  const { data: service } = await supabase
    .from('available_services')
    .select('all_zones_included')
    .eq('id', subscription.service_id)
    .maybeSingle();

  // Check if plan grants all zones (Free tier, Premium, etc.)
  if (service?.all_zones_included) {
    return { allZones: true, zoneIds: [] };
  }

  // Check for "unlock all zones" addon
  const { data: unlockAllAddons } = await supabase.from('addons').select('id').eq('unlock_all_zones', true);
  const unlockAllAddonIds = (unlockAllAddons || []).map((a) => a.id);

  if (unlockAllAddonIds.length > 0) {
    const { count } = await supabase
      .from('subscription_addons')
      .select('*', { count: 'exact', head: true })
      .eq('subscription_id', subscription.id)
      .in('addon_id', unlockAllAddonIds);

    if ((count ?? 0) > 0) {
      return { allZones: true, zoneIds: [] };
    }
  }

  // Get zones from plan + individual addons via subscription_zones
  const { data: subZones } = await supabase.from('subscription_zones').select('zone_id').eq('subscription_id', subscription.id);

  return { allZones: false, zoneIds: (subZones || []).map((z) => z.zone_id) };
};

export const canAccessJob = async (studentId: string, jobPostingId: string) => {
  const supabase = getSupabaseClient();

  // Check Pay Per Job purchase first
  const { data: payPerJob } = await supabase
    .from('pay_per_job_purchases')
    .select('id')
    .eq('student_id', studentId)
    .eq('job_posting_id', jobPostingId)
    .eq('status', 'completed')
    .maybeSingle();
  if (payPerJob) {
    return { canAccess: true, source: 'pay-per-job' as const };
  }

  const { data: job } = await supabase.from('job_postings').select('id, country_id').eq('id', jobPostingId).maybeSingle();

  // Jobs without country set are accessible to all
  if (!job || !job.country_id) {
    return { canAccess: true, source: 'no-zone-restriction' as const };
  }

  const { data: country } = await supabase.from('zone_countries').select('zone_id').eq('id', job.country_id).maybeSingle();
  const jobZoneId = country?.zone_id;

  if (!jobZoneId) {
    return { canAccess: true, source: 'no-zone-restriction' as const };
  }

  const access = await getAccessibleZones(studentId);

  if (access.allZones) {
    return { canAccess: true, source: 'all-zones' as const };
  }

  const hasAccess = access.zoneIds.includes(jobZoneId);
  if (hasAccess) {
    return { canAccess: true, source: 'subscription' as const };
  }

  // Get zone details for the lock reason
  const { data: zone } = await supabase.from('zones').select('name').eq('id', jobZoneId).maybeSingle();

  return {
    canAccess: false as const,
    requiredZoneId: jobZoneId,
    zoneName: zone?.name || 'Unknown Zone'
  };
};

export const getUnlockOptions = async (zoneId: string | null | undefined, studentId: string | null = null): Promise<any[]> => {
  const supabase = getSupabaseClient();

  const { data: addons } = await supabase
    .from('addons')
    .select('id, name, price_inr, price_usd, zone_count, unlock_all_zones')
    .eq('type', 'zone');
  const list = addons || [];

  const zoneRow = zoneId ? (await supabase.from('zones').select('name').eq('id', zoneId).maybeSingle()).data : null;
  const zoneName = zoneRow?.name || 'this zone';

  const options: any[] = [];

  // Single zone addon
  const singleZone = list.find((a) => a.zone_count === 1 && !a.unlock_all_zones);
  if (singleZone) {
    options.push({
      type: 'zone-addon',
      addonId: singleZone.id,
      label: singleZone.name,
      description: `Unlock ${zoneName} permanently`,
      priceINR: singleZone.price_inr,
      priceUSD: singleZone.price_usd,
      zonesIncluded: singleZone.zone_count
    });
  }

  // Multi-zone bundle addons (2+ zones, not unlock all)
  const bundles = list
    .filter((a) => (a.zone_count ?? 0) > 1 && !a.unlock_all_zones)
    .sort((a, b) => (a.zone_count ?? 0) - (b.zone_count ?? 0));

  for (const bundle of bundles) {
    options.push({
      type: 'zone-addon',
      addonId: bundle.id,
      label: bundle.name,
      description: `Unlock any ${bundle.zone_count} zones`,
      priceINR: bundle.price_inr,
      priceUSD: bundle.price_usd,
      zonesIncluded: bundle.zone_count
    });
  }

  // Unlock all zones addon
  const unlockAll = list.find((a) => a.unlock_all_zones);
  if (unlockAll) {
    options.push({
      type: 'zone-addon',
      addonId: unlockAll.id,
      label: unlockAll.name,
      description: 'Unlock all zones permanently',
      priceINR: unlockAll.price_inr,
      priceUSD: unlockAll.price_usd,
      unlockAllZones: true
    });
  }

  // Pay per job option (pricing from database)
  const payPerJobPricing = await getPayPerJobPricing();
  options.push({
    type: 'pay-per-job',
    label: 'One-time Job Access',
    description: 'Apply to this job only',
    priceINR: payPerJobPricing.priceINR,
    priceUSD: payPerJobPricing.priceUSD
  });

  // Upgrade plan option - find a plan with more zones than current plan
  let currentPlanZoneCount = 0;
  let currentPlanId: string | null = null;

  if (studentId) {
    const { data: student } = await supabase.from('students').select('current_subscription_id').eq('id', studentId).maybeSingle();
    if (student?.current_subscription_id) {
      const { data: subscription } = await supabase
        .from('active_subscriptions')
        .select('service_id')
        .eq('id', student.current_subscription_id)
        .maybeSingle();
      if (subscription?.service_id) {
        currentPlanId = subscription.service_id;
        const { count } = await supabase
          .from('plan_zones')
          .select('*', { count: 'exact', head: true })
          .eq('plan_id', currentPlanId);
        currentPlanZoneCount = count ?? 0;
      }
    }
  }

  const { data: allPlans } = await supabase
    .from('available_services')
    .select('id, name, all_zones_included')
    .eq('is_active', true)
    .eq('tier', 'paid');
  const plans = allPlans || [];

  const { data: allPlanZoneRows } = await supabase.from('plan_zones').select('plan_id');
  const zoneCountMap = new Map<string, number>();
  for (const row of allPlanZoneRows || []) {
    zoneCountMap.set(row.plan_id, (zoneCountMap.get(row.plan_id) || 0) + 1);
  }

  // Find upgrade options: plans with more zones OR allZonesIncluded
  const upgradePlans = plans.filter((plan) => {
    if (currentPlanId && plan.id === currentPlanId) {
      return false;
    }
    if (plan.all_zones_included) {
      return true;
    }
    const planZones = zoneCountMap.get(plan.id) || 0;
    return planZones > currentPlanZoneCount;
  });

  // Pick the cheapest upgrade option (next tier up)
  if (upgradePlans.length > 0) {
    const sorted = [...upgradePlans].sort((a, b) => {
      const aZones = a.all_zones_included ? 999 : (zoneCountMap.get(a.id) || 0);
      const bZones = b.all_zones_included ? 999 : (zoneCountMap.get(b.id) || 0);
      return aZones - bZones;
    });

    const upgradePlan = sorted[0];
    options.push({
      type: 'upgrade-plan',
      label: `Upgrade to ${upgradePlan.name}`,
      description: upgradePlan.all_zones_included
        ? 'Get access to all zones + more applications'
        : 'Get access to more zones + applications',
      planId: upgradePlan.id,
      url: '/pricing'
    });
  }

  return options;
};

export const getQuotaUnlockOptions = async (studentId: string | null = null): Promise<any[]> => {
  const supabase = getSupabaseClient();
  const options: any[] = [];

  const { data: jobAddons } = await supabase
    .from('addons')
    .select('id, name, price_inr, price_usd, job_credit_count')
    .eq('type', 'jobs')
    .order('job_credit_count', { ascending: true });

  for (const addon of jobAddons || []) {
    options.push({
      type: 'jobs-addon',
      addonId: addon.id,
      label: addon.name,
      description: `Add ${addon.job_credit_count} extra job application${(addon.job_credit_count || 0) > 1 ? 's' : ''}`,
      priceINR: addon.price_inr,
      priceUSD: addon.price_usd,
      jobCredits: addon.job_credit_count
    });
  }

  let currentPlanMaxApps = 0;
  let currentPlanId: string | null = null;

  if (studentId) {
    const { data: student } = await supabase.from('students').select('current_subscription_id').eq('id', studentId).maybeSingle();
    if (student?.current_subscription_id) {
      const { data: subscription } = await supabase
        .from('active_subscriptions')
        .select('service_id')
        .eq('id', student.current_subscription_id)
        .maybeSingle();
      if (subscription?.service_id) {
        const { data: service } = await supabase
          .from('available_services')
          .select('id, max_applications')
          .eq('id', subscription.service_id)
          .maybeSingle();
        if (service) {
          currentPlanId = service.id;
          currentPlanMaxApps = service.max_applications || 0;
        }
      }
    }
  }

  let query = supabase.from('available_services').select('id, name, max_applications').eq('is_active', true).eq('tier', 'paid');
  if (currentPlanId) {
    query = query.neq('id', currentPlanId);
  }
  const { data: candidatePlans } = await query;

  const upgradePlans = (candidatePlans || [])
    .filter((p) => p.max_applications === null || (p.max_applications ?? 0) > currentPlanMaxApps)
    .sort((a, b) => (a.max_applications ?? Infinity) - (b.max_applications ?? Infinity));

  if (upgradePlans.length > 0) {
    const upgradePlan = upgradePlans[0];
    options.push({
      type: 'upgrade-plan',
      label: `Upgrade to ${upgradePlan.name}`,
      description: upgradePlan.max_applications === null
        ? 'Unlimited job applications'
        : `Up to ${upgradePlan.max_applications} job applications`,
      planId: upgradePlan.id,
      url: '/pricing'
    });
  }

  return options;
};
