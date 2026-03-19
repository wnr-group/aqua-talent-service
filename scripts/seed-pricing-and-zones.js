require('dotenv').config();

if (process.env.NODE_ENV === 'production') {
  console.error('This script cannot be executed in production environment.');
  process.exit(1);
}

const mongoose = require('mongoose');
const connectDB = require('../src/db');

const AvailableService = require('../src/models/AvailableService');
const Addon = require('../src/models/Addon');
const Zone = require('../src/models/Zone');
const ZoneCountry = require('../src/models/ZoneCountry');
const PlanZone = require('../src/models/PlanZone');
const SubscriptionZone = require('../src/models/SubscriptionZone');
const SubscriptionAddon = require('../src/models/SubscriptionAddon');
const ActiveSubscription = require('../src/models/ActiveSubscription');
const PayPerJobPurchase = require('../src/models/PayPerJobPurchase');
const PaymentRecord = require('../src/models/PaymentRecord');
const JobPosting = require('../src/models/JobPosting');
const Student = require('../src/models/Student');

// ============================================================================
// ZONE DEFINITIONS (from screenshot)
// ============================================================================
const ZONES = [
  {
    name: 'Zone 1',
    description: 'Premium Shipping / Corporate Hubs',
    countries: ['USA', 'UK', 'Germany', 'Singapore', 'UAE']
  },
  {
    name: 'Zone 2',
    description: 'Growing Markets',
    countries: ['Canada', 'Japan', 'South Korea']
  },
  {
    name: 'Zone 3',
    description: 'Emerging Markets',
    countries: ['India', 'Brazil', 'Mexico', 'Vietnam', 'Indonesia']
  },
  {
    name: 'Zone 4',
    description: 'Niche / Optional Markets',
    countries: ['Norway', 'Denmark', 'Panama']
  }
];

// ============================================================================
// SUBSCRIPTION PLANS (from screenshot)
// ============================================================================
const PLANS = [
  {
    name: 'Starter',
    tier: 'paid',
    description: 'Perfect for students just starting their job search with access to 2 zones',
    maxApplications: 5,
    priceINR: 599,
    priceUSD: 17, // midpoint of $15-20
    zonesIncluded: 2,
    zoneNames: ['Zone 1', 'Zone 2'],
    features: [
      '5 job applications',
      'Access to 2 zones',
      'Basic job search',
      'Profile creation'
    ],
    badge: null,
    displayOrder: 1,
    allZonesIncluded: false
  },
  {
    name: 'Pro',
    tier: 'paid',
    description: 'Most popular choice for serious job seekers with access to 3 zones',
    maxApplications: 15, // midpoint of 10-15
    priceINR: 1699,
    priceUSD: 32, // midpoint of $30-35
    zonesIncluded: 3,
    zoneNames: ['Zone 1', 'Zone 2', 'Zone 3'],
    features: [
      '10-15 job applications',
      'Access to 3 zones',
      'Priority support',
      'Profile boost in search',
      'Application highlighting'
    ],
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
    maxApplications: null, // Unlimited
    priceINR: 3250,
    priceUSD: 55, // midpoint of $50-60
    zonesIncluded: 4, // All zones
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

// ============================================================================
// ZONE ADD-ONS (from screenshot)
// ============================================================================
const ZONE_ADDONS = [
  {
    name: 'Single Extra Zone',
    type: 'zone',
    priceINR: 199,
    priceUSD: 3,
    zoneCount: 1,
    unlockAllZones: false
  },
  {
    name: '2-Zone Bundle',
    type: 'zone',
    priceINR: 349,
    priceUSD: 5,
    zoneCount: 2,
    unlockAllZones: false
  },
  {
    name: 'All Remaining Zones',
    type: 'zone',
    priceINR: 699,
    priceUSD: 10,
    zoneCount: null,
    unlockAllZones: true
  }
];

// ============================================================================
// JOB CREDIT ADD-ONS (from screenshot - for Starter and Pro plans)
// ============================================================================
const JOB_CREDIT_ADDONS = [
  {
    name: 'Extra Job Credits (3 Jobs)',
    type: 'jobs',
    priceINR: 99,
    priceUSD: 1, // Approximation, screenshot shows this for Starter
    jobCreditCount: 3
  },
  {
    name: 'Extra Job Credits (5 Jobs)',
    type: 'jobs',
    priceINR: 149,
    priceUSD: 2,
    jobCreditCount: 5
  }
];

// Pay Per Job pricing (stored as addon for configurability)
const PAY_PER_JOB_ADDON = {
  name: 'Pay Per Job',
  type: 'pay-per-job',
  priceINR: 2500,
  priceUSD: 35
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

const cleanupPricingData = async () => {
  console.log('\n--- Cleaning up existing pricing data ---');

  // Delete in order to respect foreign key-like relationships
  const subscriptionZonesResult = await SubscriptionZone.deleteMany({});
  console.log(`Deleted ${subscriptionZonesResult.deletedCount} subscription zones`);

  const subscriptionAddonsResult = await SubscriptionAddon.deleteMany({});
  console.log(`Deleted ${subscriptionAddonsResult.deletedCount} subscription addons`);

  const planZonesResult = await PlanZone.deleteMany({});
  console.log(`Deleted ${planZonesResult.deletedCount} plan-zone mappings`);

  const zoneCountriesResult = await ZoneCountry.deleteMany({});
  console.log(`Deleted ${zoneCountriesResult.deletedCount} zone-country mappings`);

  const zonesResult = await Zone.deleteMany({});
  console.log(`Deleted ${zonesResult.deletedCount} zones`);

  const addonsResult = await Addon.deleteMany({});
  console.log(`Deleted ${addonsResult.deletedCount} addons`);

  const plansResult = await AvailableService.deleteMany({});
  console.log(`Deleted ${plansResult.deletedCount} plans/services`);

  const payPerJobResult = await PayPerJobPurchase.deleteMany({});
  console.log(`Deleted ${payPerJobResult.deletedCount} pay-per-job purchases`);

  const paymentRecordsResult = await PaymentRecord.deleteMany({});
  console.log(`Deleted ${paymentRecordsResult.deletedCount} payment records`);

  // Reset active subscriptions but keep references (will be cleaned up later)
  const subscriptionsResult = await ActiveSubscription.deleteMany({});
  console.log(`Deleted ${subscriptionsResult.deletedCount} active subscriptions`);

  // Clear subscription references from students
  await Student.updateMany({}, {
    $set: {
      currentSubscriptionId: null,
      subscriptionTier: 'free'
    }
  });
  console.log('Reset student subscription references');
};

const createZones = async () => {
  console.log('\n--- Creating zones ---');
  const zoneMap = new Map();

  for (const zoneData of ZONES) {
    const zone = await Zone.create({
      name: zoneData.name,
      description: zoneData.description
    });
    zoneMap.set(zoneData.name, zone);
    console.log(`Created zone: ${zone.name}`);

    // Create zone-country mappings
    for (const country of zoneData.countries) {
      await ZoneCountry.create({
        zoneId: zone._id,
        countryName: country
      });
    }
    console.log(`  - Added ${zoneData.countries.length} countries: ${zoneData.countries.join(', ')}`);
  }

  return zoneMap;
};

const createFreePlan = async (zoneMap) => {
  console.log('\n--- Creating Free Tier plan ---');

  const freePlan = await AvailableService.create({
    name: 'Free Tier',
    tier: 'free',
    description: 'Basic access to job listings with limited applications',
    maxApplications: 2,
    price: 0,
    priceINR: 0,
    priceUSD: 0,
    currency: 'INR',
    billingCycle: 'one-time',
    features: [
      'Basic job search',
      '2 applications lifetime',
      'Profile creation',
      'Access to all zones (view only)'
    ],
    displayOrder: 0,
    isActive: true,
    allZonesIncluded: true // Free tier can view all zones
  });

  // Map free plan to all zones
  for (const [zoneName, zone] of zoneMap) {
    await PlanZone.create({
      planId: freePlan._id,
      zoneId: zone._id
    });
  }

  console.log(`Created Free Tier plan with access to all ${zoneMap.size} zones`);
  return freePlan;
};

const createPaidPlans = async (zoneMap) => {
  console.log('\n--- Creating paid plans ---');
  const planMap = new Map();

  for (const planData of PLANS) {
    const plan = await AvailableService.create({
      name: planData.name,
      tier: planData.tier,
      description: planData.description,
      maxApplications: planData.maxApplications,
      price: planData.priceINR,
      priceINR: planData.priceINR,
      priceUSD: planData.priceUSD,
      currency: 'INR',
      billingCycle: 'one-time',
      features: planData.features,
      badge: planData.badge,
      displayOrder: planData.displayOrder,
      prioritySupport: planData.prioritySupport || false,
      profileBoost: planData.profileBoost || false,
      applicationHighlight: planData.applicationHighlight || false,
      isActive: true,
      allZonesIncluded: planData.allZonesIncluded
    });

    planMap.set(planData.name, plan);

    // Create plan-zone mappings
    for (const zoneName of planData.zoneNames) {
      const zone = zoneMap.get(zoneName);
      if (zone) {
        await PlanZone.create({
          planId: plan._id,
          zoneId: zone._id
        });
      }
    }

    const appLimit = planData.maxApplications ? `${planData.maxApplications} jobs` : 'Unlimited jobs';
    console.log(`Created ${plan.name} plan: INR ${planData.priceINR} / $${planData.priceUSD}, ${appLimit}, ${planData.zoneNames.length} zones`);
  }

  return planMap;
};

const createAddons = async () => {
  console.log('\n--- Creating add-ons ---');

  // Create zone add-ons
  for (const addonData of ZONE_ADDONS) {
    const addon = await Addon.create(addonData);
    console.log(`Created zone addon: ${addon.name} - INR ${addon.priceINR} / $${addon.priceUSD}`);
  }

  // Create job credit add-ons
  for (const addonData of JOB_CREDIT_ADDONS) {
    const addon = await Addon.create(addonData);
    console.log(`Created job addon: ${addon.name} - INR ${addon.priceINR} / $${addon.priceUSD} (${addon.jobCreditCount} jobs)`);
  }

  // Create pay-per-job addon (for configurable pricing)
  const payPerJobAddon = await Addon.create(PAY_PER_JOB_ADDON);
  console.log(`Created pay-per-job addon: ${payPerJobAddon.name} - INR ${payPerJobAddon.priceINR} / $${payPerJobAddon.priceUSD}`);
};

const assignJobsToRandomZones = async (zoneMap) => {
  console.log('\n--- Assigning jobs to random zones ---');

  // Get all zone countries
  const zoneCountries = await ZoneCountry.find({}).lean();

  if (zoneCountries.length === 0) {
    console.log('No zone countries found, skipping job zone assignment');
    return;
  }

  // Get all jobs
  const jobs = await JobPosting.find({});

  if (jobs.length === 0) {
    console.log('No jobs found to assign zones');
    return;
  }

  let assignedCount = 0;
  for (const job of jobs) {
    // Randomly pick a zone country
    const randomIndex = Math.floor(Math.random() * zoneCountries.length);
    const randomCountry = zoneCountries[randomIndex];

    job.countryId = randomCountry._id;
    await job.save();
    assignedCount++;
  }

  console.log(`Assigned ${assignedCount} jobs to random zone countries`);

  // Show distribution
  const distribution = {};
  for (const [zoneName] of zoneMap) {
    distribution[zoneName] = 0;
  }

  const jobsWithCountries = await JobPosting.find({}).populate({
    path: 'countryId',
    populate: { path: 'zoneId' }
  });

  for (const job of jobsWithCountries) {
    if (job.countryId?.zoneId?.name) {
      distribution[job.countryId.zoneId.name] = (distribution[job.countryId.zoneId.name] || 0) + 1;
    }
  }

  console.log('Job distribution by zone:');
  for (const [zoneName, count] of Object.entries(distribution)) {
    console.log(`  - ${zoneName}: ${count} jobs`);
  }
};

const createFreeSubscriptionsForStudents = async (freePlan, zoneMap) => {
  console.log('\n--- Creating free subscriptions for existing students ---');

  const students = await Student.find({});

  if (students.length === 0) {
    console.log('No students found');
    return;
  }

  const allZoneIds = Array.from(zoneMap.values()).map(z => z._id);

  for (const student of students) {
    // Create free subscription
    const subscription = await ActiveSubscription.create({
      studentId: student._id,
      serviceId: freePlan._id,
      startDate: new Date(),
      endDate: new Date('2099-12-31'),
      status: 'active',
      autoRenew: false,
      applicationsUsed: 0
    });

    // Create subscription zone mappings for all zones (free tier)
    for (const zoneId of allZoneIds) {
      await SubscriptionZone.create({
        subscriptionId: subscription._id,
        zoneId: zoneId,
        source: 'plan'
      });
    }

    // Update student with subscription reference
    student.currentSubscriptionId = subscription._id;
    student.subscriptionTier = 'free';
    await student.save();
  }

  console.log(`Created free subscriptions for ${students.length} students`);
};

// ============================================================================
// MAIN EXECUTION
// ============================================================================

const seedPricingAndZones = async () => {
  try {
    await connectDB();

    console.log('====================================================');
    console.log('PRICING AND ZONES SEED SCRIPT');
    console.log('====================================================');

    // Step 1: Clean up existing data
    await cleanupPricingData();

    // Step 2: Create zones
    const zoneMap = await createZones();

    // Step 3: Create Free Tier plan
    const freePlan = await createFreePlan(zoneMap);

    // Step 4: Create paid plans
    const planMap = await createPaidPlans(zoneMap);

    // Step 5: Create add-ons
    await createAddons();

    // Step 6: Assign existing jobs to random zones
    await assignJobsToRandomZones(zoneMap);

    // Step 7: Create free subscriptions for existing students
    await createFreeSubscriptionsForStudents(freePlan, zoneMap);

    // Summary
    console.log('\n====================================================');
    console.log('SEED COMPLETED SUCCESSFULLY');
    console.log('====================================================');

    console.log('\nZones Created:');
    console.log('----------------------------------------------------');
    for (const zone of ZONES) {
      console.log(`${zone.name}: ${zone.description}`);
      console.log(`  Countries: ${zone.countries.join(', ')}`);
    }

    console.log('\nSubscription Plans:');
    console.log('----------------------------------------------------');
    console.log('Free Tier:  INR 0 / $0 (2 applications, all zones view)');
    for (const plan of PLANS) {
      const apps = plan.maxApplications ? `${plan.maxApplications} jobs` : 'Unlimited';
      console.log(`${plan.name}:     INR ${plan.priceINR} / $${plan.priceUSD} (${apps}, ${plan.zonesIncluded} zones)`);
    }

    console.log('\nZone Add-Ons:');
    console.log('----------------------------------------------------');
    for (const addon of ZONE_ADDONS) {
      console.log(`${addon.name}: INR ${addon.priceINR} / $${addon.priceUSD}`);
    }

    console.log('\nJob Credit Add-Ons:');
    console.log('----------------------------------------------------');
    for (const addon of JOB_CREDIT_ADDONS) {
      console.log(`${addon.name}: INR ${addon.priceINR} / $${addon.priceUSD}`);
    }

    console.log('\nPay Per Job:');
    console.log('----------------------------------------------------');
    console.log(`${PAY_PER_JOB_ADDON.name}: INR ${PAY_PER_JOB_ADDON.priceINR} / $${PAY_PER_JOB_ADDON.priceUSD}`);

    console.log('\n====================================================\n');

    process.exit(0);
  } catch (error) {
    console.error('Seed script failed:', error);
    process.exit(1);
  }
};

seedPricingAndZones();
