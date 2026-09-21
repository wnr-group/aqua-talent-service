import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

if (process.env.NODE_ENV === 'production') {
  console.error('Zone seed script cannot be executed in production environment.');
  process.exit(1);
}

import { upsertZonesAndCountries } from '../src/utils/zonePricingSetup';

const seedZones = async () => {
  try {
    const summary = await upsertZonesAndCountries();

    console.log('Zone seed completed.');
    console.log(`Zones present: ${summary.totalZones}`);
    console.log(`New zones created: ${summary.createdZones}`);
    console.log(`Zone-country mappings present: ${summary.totalCountries}`);
    console.log(`New zone-country mappings created: ${summary.createdCountries}`);

    process.exit(0);
  } catch (error) {
    console.error('Zone seed failed:', error);
    process.exit(1);
  }
};

seedZones();
