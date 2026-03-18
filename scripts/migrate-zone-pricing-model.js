require('dotenv').config();

const connectDB = require('../src/db');

const Zone = require('../src/models/Zone');
const ZoneCountry = require('../src/models/ZoneCountry');
const PlanZone = require('../src/models/PlanZone');
const SubscriptionZone = require('../src/models/SubscriptionZone');
const Addon = require('../src/models/Addon');
const SubscriptionAddon = require('../src/models/SubscriptionAddon');
const {
  upsertZonesAndCountries,
  ensureDefaultPlanZoneMappings
} = require('../src/utils/zonePricingSetup');

const ensureIndexes = async () => {
  await Promise.all([
    Zone.init(),
    ZoneCountry.init(),
    PlanZone.init(),
    SubscriptionZone.init(),
    Addon.init(),
    SubscriptionAddon.init()
  ]);
};

const runMigration = async () => {
  try {
    await connectDB();
    await ensureIndexes();

    const zoneSummary = await upsertZonesAndCountries();
    const mappingSummary = await ensureDefaultPlanZoneMappings(zoneSummary.zonesByName);

    console.log('Zone pricing migration completed.');
    console.log(`Zones created: ${zoneSummary.createdZones}`);
    console.log(`Zone-country mappings created: ${zoneSummary.createdCountries}`);
    console.log(`Plan-zone mappings created: ${mappingSummary.createdMappings}`);

    if (mappingSummary.skippedPlans.length) {
      console.log(`Plan-zone mappings skipped for missing plans: ${mappingSummary.skippedPlans.join(', ')}`);
    }

    console.log('Addon catalog collection and indexes are ready for configuration.');
    process.exit(0);
  } catch (error) {
    console.error('Zone pricing migration failed:', error);
    process.exit(1);
  }
};

runMigration();