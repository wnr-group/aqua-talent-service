require('dotenv').config();

if (process.env.NODE_ENV === 'production') {
  console.error('Zone seed script cannot be executed in production environment.');
  process.exit(1);
}

const connectDB = require('../src/db');
const { upsertZonesAndCountries } = require('../src/utils/zonePricingSetup');

const seedZones = async () => {
  try {
    await connectDB();
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