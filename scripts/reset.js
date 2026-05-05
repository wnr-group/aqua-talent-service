require('dotenv').config();


const bcrypt = require('bcrypt');
const connectDB = require('../src/db');

const User                = require('../src/models/User');
const Company             = require('../src/models/Company');
const Student             = require('../src/models/Student');
const JobPosting          = require('../src/models/JobPosting');
const Application         = require('../src/models/Application');
const Notification        = require('../src/models/Notification');
const NotificationPreference = require('../src/models/NotificationPreference');
const PasswordResetToken  = require('../src/models/PasswordResetToken');
const ActiveSubscription  = require('../src/models/ActiveSubscription');
const SubscriptionZone    = require('../src/models/SubscriptionZone');
const SubscriptionAddon   = require('../src/models/SubscriptionAddon');
const PaymentRecord       = require('../src/models/PaymentRecord');
const PayPerJobPurchase   = require('../src/models/PayPerJobPurchase');
const AvailableService    = require('../src/models/AvailableService');
const PlanZone            = require('../src/models/PlanZone');
const Addon               = require('../src/models/Addon');
const Zone                = require('../src/models/Zone');
const ZoneCountry         = require('../src/models/ZoneCountry');
const SystemConfig        = require('../src/models/SystemConfig');

// ─── DATA ────────────────────────────────────────────────────────────────────

const ZONES = [
  {
    name: 'Zone 1',
    description: 'Premium Markets / Corporate Hubs',
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

const PLANS = [
  {
    name: 'Free Tier',
    tier: 'free',
    description: 'Basic access to job listings with limited applications',
    maxApplications: 2,
    priceINR: 0,
    priceUSD: 0,
    features: [
      'Basic job search',
      '2 applications lifetime',
      'Profile creation',
      'Access to all zones (view only)'
    ],
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
    features: [
      '5 job applications',
      'Access to 2 zones',
      'Basic job search',
      'Profile creation'
    ],
    badge: null,
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
    allZonesIncluded: false,
    zoneNames: ['Zone 1', 'Zone 2', 'Zone 3']
  },
  {
    name: 'Premium',
    tier: 'paid',
    description: 'Unlimited access to all zones and unlimited job applications',
    maxApplications: null,
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
  // Zone add-ons
  { name: 'Single Extra Zone',    type: 'zone',        priceINR: 199,  priceUSD: 3,  zoneCount: 1,    unlockAllZones: false },
  { name: '2-Zone Bundle',        type: 'zone',        priceINR: 349,  priceUSD: 5,  zoneCount: 2,    unlockAllZones: false },
  { name: 'All Remaining Zones',  type: 'zone',        priceINR: 699,  priceUSD: 10, zoneCount: null, unlockAllZones: true  },
  // Job credit add-ons
  { name: 'Extra Job Credits (3 Jobs)', type: 'jobs',  priceINR: 99,   priceUSD: 1,  jobCreditCount: 3 },
  { name: 'Extra Job Credits (5 Jobs)', type: 'jobs',  priceINR: 149,  priceUSD: 2,  jobCreditCount: 5 },
  // Pay-per-job
  { name: 'Pay Per Job',          type: 'pay-per-job', priceINR: 2500, priceUSD: 35 }
];

// ─── MAIN ─────────────────────────────────────────────────────────────────────

const reset = async () => {
  try {
    await connectDB();

    // ── 1. Wipe all collections ──────────────────────────────────────────────
    console.log('\n━━━ Wiping all data ━━━');
    await Promise.all([
      SubscriptionZone.deleteMany({}),
      SubscriptionAddon.deleteMany({}),
      PlanZone.deleteMany({}),
      ZoneCountry.deleteMany({}),
      Zone.deleteMany({}),
      Addon.deleteMany({}),
      AvailableService.deleteMany({}),
      ActiveSubscription.deleteMany({}),
      PaymentRecord.deleteMany({}),
      PayPerJobPurchase.deleteMany({}),
      Application.deleteMany({}),
      JobPosting.deleteMany({}),
      NotificationPreference.deleteMany({}),
      Notification.deleteMany({}),
      PasswordResetToken.deleteMany({}),
      Student.deleteMany({}),
      Company.deleteMany({}),
      User.deleteMany({}),
      SystemConfig.deleteMany({})
    ]);
    console.log('✓ All collections cleared');

    // ── 2. System config ─────────────────────────────────────────────────────
    console.log('\n━━━ System config ━━━');
    await SystemConfig.setValue('free_tier_max_applications', 2, 'Maximum applications for free tier');
    await SystemConfig.setValue('free_tier_features', ['Basic job search', '2 applications lifetime', 'Profile creation'], 'Features for free tier');
    console.log('✓ System config set');

    // ── 3. Admin user ────────────────────────────────────────────────────────
    console.log('\n━━━ Admin user ━━━');
    const passwordHash = await bcrypt.hash('password123', 10);
    await User.create({ username: 'admin', passwordHash, userType: 'admin' });
    console.log('✓ Admin user created  →  admin / password123');

    // ── 4. Zones ─────────────────────────────────────────────────────────────
    console.log('\n━━━ Zones ━━━');
    const zoneMap = new Map();
    for (const z of ZONES) {
      const zone = await Zone.create({ name: z.name, description: z.description });
      zoneMap.set(z.name, zone);
      for (const country of z.countries) {
        await ZoneCountry.create({ zoneId: zone._id, countryName: country });
      }
      console.log(`✓ ${z.name} (${z.countries.length} countries)`);
    }

    // ── 5. Subscription plans + zone mappings ────────────────────────────────
    console.log('\n━━━ Subscription plans ━━━');
    for (const p of PLANS) {
      const plan = await AvailableService.create({
        name: p.name,
        tier: p.tier,
        description: p.description,
        maxApplications: p.maxApplications ?? null,
        price: p.priceINR,
        priceINR: p.priceINR,
        priceUSD: p.priceUSD,
        currency: 'INR',
        billingCycle: 'one-time',
        features: p.features,
        badge: p.badge || null,
        displayOrder: p.displayOrder,
        prioritySupport: p.prioritySupport || false,
        profileBoost: p.profileBoost || false,
        applicationHighlight: p.applicationHighlight || false,
        isActive: true,
        allZonesIncluded: p.allZonesIncluded
      });

      for (const zoneName of p.zoneNames) {
        const zone = zoneMap.get(zoneName);
        if (zone) await PlanZone.create({ planId: plan._id, zoneId: zone._id });
      }

      const apps = p.maxApplications ? `${p.maxApplications} apps` : 'Unlimited apps';
      const price = p.priceINR === 0 ? 'Free' : `₹${p.priceINR} / $${p.priceUSD}`;
      console.log(`✓ ${p.name.padEnd(10)} ${price.padEnd(18)} ${apps}, ${p.zoneNames.length} zone(s)`);
    }

    // ── 6. Add-ons ───────────────────────────────────────────────────────────
    console.log('\n━━━ Add-ons ━━━');
    for (const a of ADDONS) {
      await Addon.create(a);
      console.log(`✓ ${a.name}`);
    }

    // ── Summary ──────────────────────────────────────────────────────────────
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
