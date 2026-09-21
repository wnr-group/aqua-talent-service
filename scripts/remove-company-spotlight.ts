import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { getSupabaseClient } from '../src/lib/supabase/client';

// Notes on what changed from the old Mongoose version:
// - is_company_spotlight was never part of the Postgres schema (the feature
//   was already gone before the Mongo -> Postgres data export), so there's
//   no column to unset.
// - active_subscriptions/payment_records never had a company_id column in
//   Postgres, so there's no field to unset and no stray index to drop there
//   either - both tables were designed student-first from the start.
// What's left and still meaningful: purging any leftover "spotlight" plans
// by name/description, and making sure the free plan + its config exist.
const FREE_TIER_PLAN_NAME = 'Free Tier';
const FREE_TIER_MAX_APPLICATIONS = 2;

const getOrCreateFreePlan = async (supabase: ReturnType<typeof getSupabaseClient>) => {
  const { data: existing } = await supabase
    .from('available_services')
    .select('*')
    .eq('tier', 'free')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existing) {
    return existing;
  }

  const { data: created, error } = await supabase
    .from('available_services')
    .insert({
      name: FREE_TIER_PLAN_NAME,
      tier: 'free',
      description: 'Basic access to job listings and limited applications',
      max_applications: FREE_TIER_MAX_APPLICATIONS,
      price: 0,
      price_inr: 0,
      price_usd: 0,
      currency: 'USD',
      billing_cycle: 'one-time',
      features: ['Basic job search', 'Limited applications', 'Profile creation'],
      is_active: true,
      all_zones_included: true,
      display_order: 0
    })
    .select()
    .single();
  if (error) throw error;
  return created;
};

const runMigration = async () => {
  try {
    const supabase = getSupabaseClient();

    const { data: spotlightPlans, error: findError } = await supabase
      .from('available_services')
      .select('id')
      .or('name.ilike.%spotlight%,description.ilike.%spotlight%');
    if (findError) throw findError;

    let spotlightDeletedCount = 0;
    if (spotlightPlans && spotlightPlans.length) {
      const { error: deleteError } = await supabase
        .from('available_services')
        .delete()
        .in('id', spotlightPlans.map((p) => p.id));
      if (deleteError) throw deleteError;
      spotlightDeletedCount = spotlightPlans.length;
    }

    const freePlan = await getOrCreateFreePlan(supabase);

    const { data: existingConfig } = await supabase
      .from('system_config')
      .select('id')
      .eq('key', 'free_tier_max_applications')
      .maybeSingle();

    if (existingConfig) {
      await supabase
        .from('system_config')
        .update({ value: FREE_TIER_MAX_APPLICATIONS, description: 'Maximum applications allowed for free tier' })
        .eq('id', existingConfig.id);
    } else {
      await supabase.from('system_config').insert({
        key: 'free_tier_max_applications',
        value: FREE_TIER_MAX_APPLICATIONS,
        description: 'Maximum applications allowed for free tier'
      });
    }

    console.log('Company spotlight cleanup completed.');
    console.log(`Spotlight plans removed: ${spotlightDeletedCount}`);
    console.log(`Free tier plan ready: ${freePlan.name} (${freePlan.id})`);

    process.exit(0);
  } catch (error) {
    console.error('Company spotlight cleanup failed:', error);
    process.exit(1);
  }
};

runMigration();
