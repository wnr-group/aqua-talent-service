/**
 * DESTRUCTIVE: wipes every table and reseeds base config (admin user,
 * zones, subscription plans, add-ons). Intentionally allowed to run in
 * production (see commit history) - do not run this against a database
 * with real data you care about without a fresh backup first.
 *
 * Run with: npx tsc && node scripts/reset.js
 */
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import bcrypt from 'bcrypt';
import { getSupabaseClient } from '../src/lib/supabase/client';

const supabase = getSupabaseClient();

const ZONES = [
  { name: 'Zone 1', description: 'Premium Markets / Corporate Hubs', countries: ['USA', 'UK', 'Germany', 'Singapore', 'UAE'] },
  { name: 'Zone 2', description: 'Growing Markets', countries: ['Canada', 'Japan', 'South Korea'] },
  { name: 'Zone 3', description: 'Emerging Markets', countries: ['India', 'Brazil', 'Mexico', 'Vietnam', 'Indonesia'] },
  { name: 'Zone 4', description: 'Niche / Optional Markets', countries: ['Norway', 'Denmark', 'Panama'] }
];

const PLANS = [
  {
    name: 'Free Tier',
    tier: 'free',
    description: 'Basic access to job listings with limited applications',
    maxApplications: 2,
    priceINR: 0,
    priceUSD: 0,
    features: ['Basic job search', '2 applications lifetime', 'Profile creation', 'Access to all zones (view only)'],
    displayOrder: 0,
    allZonesIncluded: true,
    zoneNames: ['Zone 1', 'Zone 2', 'Zone 3', 'Zone 4']
  },
  {
    name: 'Starter',
    tier: 'paid',
    description: 'Perfect for students just starting their job search with access to 2 zones',
    maxApplications: 5,
    priceINR: 599,
    priceUSD: 17,
    features: ['5 job applications', 'Access to 2 zones', 'Basic job search', 'Profile creation'],
    badge: null as string | null,
    displayOrder: 1,
    allZonesIncluded: false,
    zoneNames: ['Zone 1', 'Zone 2']
  },
  {
    name: 'Pro',
    tier: 'paid',
    description: 'Most popular choice for serious job seekers with access to 3 zones',
    maxApplications: 15,
    priceINR: 1699,
    priceUSD: 32,
    features: ['10-15 job applications', 'Access to 3 zones', 'Priority support', 'Profile boost in search', 'Application highlighting'],
    badge: 'Most Popular',
    displayOrder: 2,
    prioritySupport: true,
    profileBoost: true,
    applicationHighlight: true,
    allZonesIncluded: false,
    zoneNames: ['Zone 1', 'Zone 2', 'Zone 3']
  },
  {
    name: 'Premium',
    tier: 'paid',
    description: 'Unlimited access to all zones and unlimited job applications',
    maxApplications: null as number | null,
    priceINR: 3250,
    priceUSD: 55,
    features: [
      'Unlimited job applications',
      'Access to all zones',
      'Priority support',
      'Profile boost in search',
      'Application highlighting',
      'Resume downloads',
      'Video profile views'
    ],
    badge: 'Best Value',
    displayOrder: 3,
    prioritySupport: true,
    profileBoost: true,
    applicationHighlight: true,
    allZonesIncluded: true,
    zoneNames: ['Zone 1', 'Zone 2', 'Zone 3', 'Zone 4']
  }
];

const ADDONS = [
  { name: 'Single Extra Zone', type: 'zone', priceINR: 199, priceUSD: 3, zoneCount: 1, unlockAllZones: false },
  { name: '2-Zone Bundle', type: 'zone', priceINR: 349, priceUSD: 5, zoneCount: 2, unlockAllZones: false },
  { name: 'All Remaining Zones', type: 'zone', priceINR: 699, priceUSD: 10, zoneCount: null as number | null, unlockAllZones: true },
  { name: 'Extra Job Credits (3 Jobs)', type: 'jobs', priceINR: 99, priceUSD: 1, jobCreditCount: 3 },
  { name: 'Extra Job Credits (5 Jobs)', type: 'jobs', priceINR: 149, priceUSD: 2, jobCreditCount: 5 },
  { name: 'Pay Per Job', type: 'pay-per-job', priceINR: 2500, priceUSD: 35 }
];

const wipeAllTables = async () => {
  console.log('\n━━━ Wiping all data ━━━');

  // FK-safe order: leaf tables (nothing references them) first, tables that
  // are referenced by others last. Mongo never enforced this, but Postgres
  // does.
  const deleteAll = async (table: string) => {
    const { error } = await supabase.from(table as any).delete().not('id', 'is', null);
    if (error) throw new Error(`Failed to wipe ${table}: ${error.message}`);
  };

  await deleteAll('notifications');
  await deleteAll('notification_preferences');
  await deleteAll('password_reset_tokens');
  await deleteAll('subscription_zones');
  await deleteAll('subscription_addons');
  await deleteAll('applications');
  await deleteAll('pay_per_job_purchases');
  await deleteAll('payment_records');
  await deleteAll('plan_zones');
  await deleteAll('job_postings');
  await deleteAll('zone_countries');

  await supabase.from('students').update({ current_subscription_id: null }).not('current_subscription_id', 'is', null);
  await deleteAll('active_subscriptions');
  await deleteAll('students');
  await deleteAll('companies');
  await deleteAll('system_config');
  await deleteAll('users');
  await deleteAll('available_services');
  await deleteAll('addons');
  await deleteAll('zones');

  console.log('✓ All tables cleared');
};

const reset = async () => {
  try {
    await wipeAllTables();

    // ── System config ────────────────────────────────────────────────────
    console.log('\n━━━ System config ━━━');
    await supabase.from('system_config').insert([
      { key: 'free_tier_max_applications', value: 2, description: 'Maximum applications for free tier' },
      {
        key: 'free_tier_features',
        value: ['Basic job search', '2 applications lifetime', 'Profile creation'],
        description: 'Features for free tier'
      }
    ]);
    console.log('✓ System config set');

    // ── Admin user ────────────────────────────────────────────────────────
    console.log('\n━━━ Admin user ━━━');
    const passwordHash = await bcrypt.hash('password123', 10);
    await supabase.from('users').insert({ username: 'admin', password_hash: passwordHash, user_type: 'admin' });
    console.log('✓ Admin user created  →  admin / password123');

    // ── Zones ─────────────────────────────────────────────────────────────
    console.log('\n━━━ Zones ━━━');
    const zoneMap = new Map<string, any>();
    for (const z of ZONES) {
      const { data: zone, error } = await supabase.from('zones').insert({ name: z.name, description: z.description }).select().single();
      if (error) throw error;
      zoneMap.set(z.name, zone);

      const countryRows = z.countries.map((countryName) => ({ zone_id: zone.id, country_name: countryName }));
      await supabase.from('zone_countries').insert(countryRows);
      console.log(`✓ ${z.name} (${z.countries.length} countries)`);
    }

    // ── Subscription plans + zone mappings ───────────────────────────────
    console.log('\n━━━ Subscription plans ━━━');
    for (const p of PLANS) {
      const { data: plan, error } = await supabase
        .from('available_services')
        .insert({
          name: p.name,
          tier: p.tier,
          description: p.description,
          max_applications: p.maxApplications ?? null,
          price: p.priceINR,
          price_inr: p.priceINR,
          price_usd: p.priceUSD,
          currency: 'INR',
          billing_cycle: 'one-time',
          features: p.features,
          badge: (p as any).badge || null,
          display_order: p.displayOrder,
          priority_support: (p as any).prioritySupport || false,
          profile_boost: (p as any).profileBoost || false,
          application_highlight: (p as any).applicationHighlight || false,
          is_active: true,
          all_zones_included: p.allZonesIncluded
        })
        .select()
        .single();
      if (error) throw error;

      const planZoneRows = p.zoneNames
        .map((zoneName) => zoneMap.get(zoneName))
        .filter(Boolean)
        .map((zone) => ({ plan_id: plan.id, zone_id: zone.id }));
      if (planZoneRows.length) {
        await supabase.from('plan_zones').insert(planZoneRows);
      }

      const apps = p.maxApplications ? `${p.maxApplications} apps` : 'Unlimited apps';
      const price = p.priceINR === 0 ? 'Free' : `₹${p.priceINR} / $${p.priceUSD}`;
      console.log(`✓ ${p.name.padEnd(10)} ${price.padEnd(18)} ${apps}, ${p.zoneNames.length} zone(s)`);
    }

    // ── Add-ons ───────────────────────────────────────────────────────────
    console.log('\n━━━ Add-ons ━━━');
    for (const a of ADDONS) {
      const { error } = await supabase.from('addons').insert({
        name: a.name,
        type: a.type,
        price_inr: a.priceINR,
        price_usd: a.priceUSD,
        zone_count: (a as any).zoneCount ?? null,
        job_credit_count: (a as any).jobCreditCount ?? null,
        unlock_all_zones: (a as any).unlockAllZones ?? false
      });
      if (error) throw error;
      console.log(`✓ ${a.name}`);
    }

    // ── Summary ──────────────────────────────────────────────────────────
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  ✅  Database reset complete');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  Admin login:  admin / password123');
    console.log(`  Zones:        ${ZONES.length}`);
    console.log(`  Plans:        ${PLANS.length} (Free + Starter + Pro + Premium)`);
    console.log(`  Add-ons:      ${ADDONS.length}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    process.exit(0);
  } catch (err) {
    console.error('\n❌  Reset failed:', err);
    process.exit(1);
  }
};

reset();
