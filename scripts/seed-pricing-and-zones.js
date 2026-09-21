"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * DESTRUCTIVE: wipes all zone/pricing/subscription/payment data and reseeds
 * it from the constants below. Do not run against a database with real data
 * you care about without a fresh backup.
 *
 * Run with: npx tsc && node scripts/seed-pricing-and-zones.js
 */
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config({ path: path_1.default.resolve(__dirname, '../.env') });
if (process.env.NODE_ENV === 'production') {
    console.error('This script cannot be executed in production environment.');
    process.exit(1);
}
const client_1 = require("../src/lib/supabase/client");
const supabase = (0, client_1.getSupabaseClient)();
// ============================================================================
// ZONE DEFINITIONS
// ============================================================================
const ZONES = [
    { name: 'Zone 1', description: 'Premium Shipping / Corporate Hubs', countries: ['USA', 'UK', 'Germany', 'Singapore', 'UAE'] },
    { name: 'Zone 2', description: 'Growing Markets', countries: ['Canada', 'Japan', 'South Korea'] },
    { name: 'Zone 3', description: 'Emerging Markets', countries: ['India', 'Brazil', 'Mexico', 'Vietnam', 'Indonesia'] },
    { name: 'Zone 4', description: 'Niche / Optional Markets', countries: ['Norway', 'Denmark', 'Panama'] }
];
// ============================================================================
// SUBSCRIPTION PLANS
// ============================================================================
const PLANS = [
    {
        name: 'Starter',
        tier: 'paid',
        description: 'Perfect for students just starting their job search with access to 2 zones',
        maxApplications: 5,
        priceINR: 599,
        priceUSD: 17,
        zoneNames: ['Zone 1', 'Zone 2'],
        features: ['5 job applications', 'Access to 2 zones', 'Basic job search', 'Profile creation'],
        badge: null,
        displayOrder: 1,
        allZonesIncluded: false
    },
    {
        name: 'Pro',
        tier: 'paid',
        description: 'Most popular choice for serious job seekers with access to 3 zones',
        maxApplications: 15,
        priceINR: 1699,
        priceUSD: 32,
        zoneNames: ['Zone 1', 'Zone 2', 'Zone 3'],
        features: ['10-15 job applications', 'Access to 3 zones', 'Priority support', 'Profile boost in search', 'Application highlighting'],
        badge: 'Most Popular',
        displayOrder: 2,
        prioritySupport: true,
        profileBoost: true,
        applicationHighlight: true,
        allZonesIncluded: false
    },
    {
        name: 'Premium',
        tier: 'paid',
        description: 'Unlimited access to all zones and unlimited job applications',
        maxApplications: null,
        priceINR: 3250,
        priceUSD: 55,
        zoneNames: ['Zone 1', 'Zone 2', 'Zone 3', 'Zone 4'],
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
        allZonesIncluded: true
    }
];
const ZONE_ADDONS = [
    { name: 'Single Extra Zone', type: 'zone', priceINR: 199, priceUSD: 3, zoneCount: 1, unlockAllZones: false },
    { name: '2-Zone Bundle', type: 'zone', priceINR: 349, priceUSD: 5, zoneCount: 2, unlockAllZones: false },
    { name: 'All Remaining Zones', type: 'zone', priceINR: 699, priceUSD: 10, zoneCount: null, unlockAllZones: true }
];
const JOB_CREDIT_ADDONS = [
    { name: 'Extra Job Credits (3 Jobs)', type: 'jobs', priceINR: 99, priceUSD: 1, jobCreditCount: 3 },
    { name: 'Extra Job Credits (5 Jobs)', type: 'jobs', priceINR: 149, priceUSD: 2, jobCreditCount: 5 }
];
const PAY_PER_JOB_ADDON = { name: 'Pay Per Job', type: 'pay-per-job', priceINR: 2500, priceUSD: 35 };
// ============================================================================
// HELPERS
// ============================================================================
const cleanupPricingData = async () => {
    console.log('\n--- Cleaning up existing pricing data ---');
    // Delete in FK-safe order (Postgres enforces referential integrity that
    // Mongo never did, so this has to go child-to-parent, unlike the original).
    await supabase.from('subscription_zones').delete().not('id', 'is', null);
    await supabase.from('subscription_addons').delete().not('id', 'is', null);
    // Free up zone_countries for deletion below.
    await supabase.from('job_postings').update({ country_id: null }).not('country_id', 'is', null);
    await supabase.from('plan_zones').delete().not('id', 'is', null);
    const { count: payPerJobCount } = await supabase.from('pay_per_job_purchases').select('*', { count: 'exact', head: true });
    await supabase.from('pay_per_job_purchases').delete().not('id', 'is', null);
    console.log(`Deleted ${payPerJobCount ?? 0} pay-per-job purchases`);
    const { count: paymentRecordsCount } = await supabase.from('payment_records').select('*', { count: 'exact', head: true });
    await supabase.from('payment_records').delete().not('id', 'is', null);
    console.log(`Deleted ${paymentRecordsCount ?? 0} payment records`);
    // Free up available_services for deletion below.
    await supabase.from('students').update({ current_subscription_id: null, subscription_tier: 'free' }).not('current_subscription_id', 'is', null);
    console.log('Reset student subscription references');
    const { count: subscriptionsCount } = await supabase.from('active_subscriptions').select('*', { count: 'exact', head: true });
    await supabase.from('active_subscriptions').delete().not('id', 'is', null);
    console.log(`Deleted ${subscriptionsCount ?? 0} active subscriptions`);
    const { count: zoneCountriesCount } = await supabase.from('zone_countries').select('*', { count: 'exact', head: true });
    await supabase.from('zone_countries').delete().not('id', 'is', null);
    console.log(`Deleted ${zoneCountriesCount ?? 0} zone-country mappings`);
    const { count: zonesCount } = await supabase.from('zones').select('*', { count: 'exact', head: true });
    await supabase.from('zones').delete().not('id', 'is', null);
    console.log(`Deleted ${zonesCount ?? 0} zones`);
    const { count: addonsCount } = await supabase.from('addons').select('*', { count: 'exact', head: true });
    await supabase.from('addons').delete().not('id', 'is', null);
    console.log(`Deleted ${addonsCount ?? 0} addons`);
    const { count: plansCount } = await supabase.from('available_services').select('*', { count: 'exact', head: true });
    await supabase.from('available_services').delete().not('id', 'is', null);
    console.log(`Deleted ${plansCount ?? 0} plans/services`);
};
const createZones = async () => {
    console.log('\n--- Creating zones ---');
    const zoneMap = new Map();
    for (const zoneData of ZONES) {
        const { data: zone, error } = await supabase.from('zones').insert({ name: zoneData.name, description: zoneData.description }).select().single();
        if (error)
            throw error;
        zoneMap.set(zoneData.name, zone);
        console.log(`Created zone: ${zone.name}`);
        const countryRows = zoneData.countries.map((countryName) => ({ zone_id: zone.id, country_name: countryName }));
        await supabase.from('zone_countries').insert(countryRows);
        console.log(`  - Added ${zoneData.countries.length} countries: ${zoneData.countries.join(', ')}`);
    }
    return zoneMap;
};
const createFreePlan = async (zoneMap) => {
    console.log('\n--- Creating Free Tier plan ---');
    const { data: freePlan, error } = await supabase
        .from('available_services')
        .insert({
        name: 'Free Tier',
        tier: 'free',
        description: 'Basic access to job listings with limited applications',
        max_applications: 2,
        price: 0,
        price_inr: 0,
        price_usd: 0,
        currency: 'INR',
        billing_cycle: 'one-time',
        features: ['Basic job search', '2 applications lifetime', 'Profile creation', 'Access to all zones (view only)'],
        display_order: 0,
        is_active: true,
        all_zones_included: true
    })
        .select()
        .single();
    if (error)
        throw error;
    const planZoneRows = Array.from(zoneMap.values()).map((zone) => ({ plan_id: freePlan.id, zone_id: zone.id }));
    if (planZoneRows.length) {
        await supabase.from('plan_zones').insert(planZoneRows);
    }
    console.log(`Created Free Tier plan with access to all ${zoneMap.size} zones`);
    return freePlan;
};
const createPaidPlans = async (zoneMap) => {
    console.log('\n--- Creating paid plans ---');
    const planMap = new Map();
    for (const planData of PLANS) {
        const { data: plan, error } = await supabase
            .from('available_services')
            .insert({
            name: planData.name,
            tier: planData.tier,
            description: planData.description,
            max_applications: planData.maxApplications,
            price: planData.priceINR,
            price_inr: planData.priceINR,
            price_usd: planData.priceUSD,
            currency: 'INR',
            billing_cycle: 'one-time',
            features: planData.features,
            badge: planData.badge,
            display_order: planData.displayOrder,
            priority_support: planData.prioritySupport || false,
            profile_boost: planData.profileBoost || false,
            application_highlight: planData.applicationHighlight || false,
            is_active: true,
            all_zones_included: planData.allZonesIncluded
        })
            .select()
            .single();
        if (error)
            throw error;
        planMap.set(planData.name, plan);
        const planZoneRows = planData.zoneNames
            .map((zoneName) => zoneMap.get(zoneName))
            .filter(Boolean)
            .map((zone) => ({ plan_id: plan.id, zone_id: zone.id }));
        if (planZoneRows.length) {
            await supabase.from('plan_zones').insert(planZoneRows);
        }
        const appLimit = planData.maxApplications ? `${planData.maxApplications} jobs` : 'Unlimited jobs';
        console.log(`Created ${plan.name} plan: INR ${planData.priceINR} / $${planData.priceUSD}, ${appLimit}, ${planData.zoneNames.length} zones`);
    }
    return planMap;
};
const createAddons = async () => {
    console.log('\n--- Creating add-ons ---');
    for (const addonData of ZONE_ADDONS) {
        const { data: addon, error } = await supabase
            .from('addons')
            .insert({ name: addonData.name, type: addonData.type, price_inr: addonData.priceINR, price_usd: addonData.priceUSD, zone_count: addonData.zoneCount, unlock_all_zones: addonData.unlockAllZones })
            .select()
            .single();
        if (error)
            throw error;
        console.log(`Created zone addon: ${addon.name} - INR ${addon.price_inr} / $${addon.price_usd}`);
    }
    for (const addonData of JOB_CREDIT_ADDONS) {
        const { data: addon, error } = await supabase
            .from('addons')
            .insert({ name: addonData.name, type: addonData.type, price_inr: addonData.priceINR, price_usd: addonData.priceUSD, job_credit_count: addonData.jobCreditCount })
            .select()
            .single();
        if (error)
            throw error;
        console.log(`Created job addon: ${addon.name} - INR ${addon.price_inr} / $${addon.price_usd} (${addon.job_credit_count} jobs)`);
    }
    const { data: payPerJobAddon, error } = await supabase
        .from('addons')
        .insert({ name: PAY_PER_JOB_ADDON.name, type: PAY_PER_JOB_ADDON.type, price_inr: PAY_PER_JOB_ADDON.priceINR, price_usd: PAY_PER_JOB_ADDON.priceUSD })
        .select()
        .single();
    if (error)
        throw error;
    console.log(`Created pay-per-job addon: ${payPerJobAddon.name} - INR ${payPerJobAddon.price_inr} / $${payPerJobAddon.price_usd}`);
};
const assignJobsToRandomZones = async (zoneMap) => {
    console.log('\n--- Assigning jobs to random zones ---');
    const { data: zoneCountries } = await supabase.from('zone_countries').select('id, zone_id');
    if (!zoneCountries || !zoneCountries.length) {
        console.log('No zone countries found, skipping job zone assignment');
        return;
    }
    const { data: jobs } = await supabase.from('job_postings').select('id');
    if (!jobs || !jobs.length) {
        console.log('No jobs found to assign zones');
        return;
    }
    let assignedCount = 0;
    const zoneIdToName = new Map(Array.from(zoneMap.values()).map((z) => [z.id, z.name]));
    const distribution = {};
    for (const [zoneName] of zoneMap)
        distribution[zoneName] = 0;
    for (const job of jobs) {
        const randomCountry = zoneCountries[Math.floor(Math.random() * zoneCountries.length)];
        await supabase.from('job_postings').update({ country_id: randomCountry.id }).eq('id', job.id);
        assignedCount++;
        const zoneName = zoneIdToName.get(randomCountry.zone_id);
        if (zoneName)
            distribution[zoneName] = (distribution[zoneName] || 0) + 1;
    }
    console.log(`Assigned ${assignedCount} jobs to random zone countries`);
    console.log('Job distribution by zone:');
    for (const [zoneName, count] of Object.entries(distribution)) {
        console.log(`  - ${zoneName}: ${count} jobs`);
    }
};
const createFreeSubscriptionsForStudents = async (freePlan, zoneMap) => {
    console.log('\n--- Creating free subscriptions for existing students ---');
    const { data: students } = await supabase.from('students').select('id');
    if (!students || !students.length) {
        console.log('No students found');
        return;
    }
    const allZoneIds = Array.from(zoneMap.values()).map((z) => z.id);
    for (const student of students) {
        const { data: subscription, error } = await supabase
            .from('active_subscriptions')
            .insert({
            student_id: student.id,
            service_id: freePlan.id,
            start_date: new Date().toISOString(),
            end_date: new Date('2099-12-31').toISOString(),
            status: 'active',
            auto_renew: false,
            applications_used: 0
        })
            .select()
            .single();
        if (error)
            throw error;
        const zoneRows = allZoneIds.map((zoneId) => ({ subscription_id: subscription.id, zone_id: zoneId, source: 'plan' }));
        if (zoneRows.length) {
            await supabase.from('subscription_zones').insert(zoneRows);
        }
        await supabase.from('students').update({ current_subscription_id: subscription.id, subscription_tier: 'free' }).eq('id', student.id);
    }
    console.log(`Created free subscriptions for ${students.length} students`);
};
// ============================================================================
// MAIN
// ============================================================================
const seedPricingAndZones = async () => {
    try {
        console.log('====================================================');
        console.log('PRICING AND ZONES SEED SCRIPT');
        console.log('====================================================');
        await cleanupPricingData();
        const zoneMap = await createZones();
        const freePlan = await createFreePlan(zoneMap);
        await createPaidPlans(zoneMap);
        await createAddons();
        await assignJobsToRandomZones(zoneMap);
        await createFreeSubscriptionsForStudents(freePlan, zoneMap);
        console.log('\n====================================================');
        console.log('SEED COMPLETED SUCCESSFULLY');
        console.log('====================================================');
        process.exit(0);
    }
    catch (error) {
        console.error('Seed script failed:', error);
        process.exit(1);
    }
};
seedPricingAndZones();
//# sourceMappingURL=seed-pricing-and-zones.js.map