import { getSupabaseClient } from '../lib/supabase/client';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DEFAULT_ZONES, DEFAULT_PLAN_ZONE_ASSIGNMENTS } = require('../constants/zonePricing');

const supabase = getSupabaseClient();

export const upsertZonesAndCountries = async () => {
  const zonesByName = new Map<string, any>();
  let createdZones = 0;
  let createdCountries = 0;

  for (const zone of DEFAULT_ZONES as Array<{ name: string; description: string; countries: string[] }>) {
    const { data: existing } = await supabase.from('zones').select('*').eq('name', zone.name).maybeSingle();

    let zoneRow: any;
    if (existing) {
      if (existing.description !== zone.description) {
        const { data: updated, error } = await supabase
          .from('zones')
          .update({ description: zone.description })
          .eq('id', existing.id)
          .select()
          .single();
        if (error) throw error;
        zoneRow = updated;
      } else {
        zoneRow = existing;
      }
    } else {
      const { data: created, error } = await supabase.from('zones').insert({ name: zone.name, description: zone.description }).select().single();
      if (error) throw error;
      zoneRow = created;
      createdZones += 1;
    }

    zonesByName.set(zone.name, zoneRow);
  }

  const countryRows: Array<{ zone_id: string; country_name: string }> = [];
  for (const zone of DEFAULT_ZONES as Array<{ name: string; countries: string[] }>) {
    const zoneRow = zonesByName.get(zone.name);
    for (const countryName of zone.countries) {
      countryRows.push({ zone_id: zoneRow.id, country_name: countryName });
    }
  }

  if (countryRows.length) {
    const { data: inserted, error } = await supabase
      .from('zone_countries')
      .upsert(countryRows, { onConflict: 'zone_id,country_name', ignoreDuplicates: true })
      .select();
    if (error) throw error;
    createdCountries = inserted?.length || 0;
  }

  const totalCountries = (DEFAULT_ZONES as Array<{ countries: string[] }>).reduce((sum, zone) => sum + zone.countries.length, 0);

  return {
    zonesByName,
    createdZones,
    createdCountries,
    totalZones: DEFAULT_ZONES.length,
    totalCountries
  };
};

export const ensureDefaultPlanZoneMappings = async (zonesByName: Map<string, any>) => {
  const planNames: string[] = Object.keys(DEFAULT_PLAN_ZONE_ASSIGNMENTS);
  const premiumPlanAliases = ['Premium Plan', 'Premium'];
  const allPlanNames = [...new Set([...planNames, ...premiumPlanAliases])];

  const { data: plans } = await supabase.from('available_services').select('id, name').in('name', allPlanNames);
  const { data: allZones } = await supabase.from('zones').select('id, name');

  if (!plans || !plans.length) {
    return { matchedPlans: [] as string[], createdMappings: 0, skippedPlans: planNames };
  }

  const planMap = new Map(plans.map((plan) => [plan.name, plan]));
  const zoneMap = new Map((allZones || []).map((zone) => [zone.name, zone]));
  const rows: Array<{ plan_id: string; zone_id: string }> = [];

  for (const planName of planNames) {
    const plan = planMap.get(planName);
    if (!plan) continue;

    for (const zoneName of DEFAULT_PLAN_ZONE_ASSIGNMENTS[planName] as string[]) {
      const zone = zoneMap.get(zoneName) || zonesByName.get(zoneName);
      if (!zone) continue;
      rows.push({ plan_id: plan.id, zone_id: zone.id });
    }
  }

  const premiumPlan = premiumPlanAliases.map((planName) => planMap.get(planName)).find(Boolean);

  if (premiumPlan) {
    const { count: premiumPlanMappings } = await supabase
      .from('plan_zones')
      .select('*', { count: 'exact', head: true })
      .eq('plan_id', premiumPlan.id);

    if ((premiumPlanMappings ?? 0) === 0) {
      for (const zone of allZones || []) {
        rows.push({ plan_id: premiumPlan.id, zone_id: zone.id });
      }
    }
  }

  let createdMappings = 0;
  if (rows.length) {
    const { data: inserted, error } = await supabase
      .from('plan_zones')
      .upsert(rows, { onConflict: 'plan_id,zone_id', ignoreDuplicates: true })
      .select();
    if (error) throw error;
    createdMappings = inserted?.length || 0;
  }

  return {
    matchedPlans: plans.map((plan) => plan.name),
    createdMappings,
    skippedPlans: planNames.filter((planName) => {
      if (planName === 'Premium Plan') return !premiumPlan;
      return !planMap.has(planName);
    })
  };
};
