import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { upsertZonesAndCountries, ensureDefaultPlanZoneMappings } from '../src/utils/zonePricingSetup';

// Note: the old Mongoose version of this script also called Model.init() to
// force index creation. Postgres indexes are declared directly in the SQL
// migrations (supabase/migrations/*.sql) and already exist once those are
// applied, so there's no equivalent step needed here.
const runMigration = async () => {
  try {
    const zoneSummary = await upsertZonesAndCountries();
    const mappingSummary = await ensureDefaultPlanZoneMappings(zoneSummary.zonesByName);

    console.log('Zone pricing migration completed.');
    console.log(`Zones created: ${zoneSummary.createdZones}`);
    console.log(`Zone-country mappings created: ${zoneSummary.createdCountries}`);
    console.log(`Plan-zone mappings created: ${mappingSummary.createdMappings}`);

    if (mappingSummary.skippedPlans.length) {
      console.log(`Plan-zone mappings skipped for missing plans: ${mappingSummary.skippedPlans.join(', ')}`);
    }

    console.log('Addon catalog table is ready for configuration.');
    process.exit(0);
  } catch (error) {
    console.error('Zone pricing migration failed:', error);
    process.exit(1);
  }
};

runMigration();
