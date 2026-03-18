require('dotenv').config();

const connectDB = require('../src/db');
const AvailableService = require('../src/models/AvailableService');

const runMigration = async () => {
  try {
    await connectDB();

    const result = await AvailableService.updateMany(
      { billingCycle: { $in: ['monthly', 'yearly', 'one-time'] } },
      { $set: { billingCycle: 'one_time' } }
    );

    console.log('Billing cycle migration completed.');
    console.log(`Matched plans: ${result.matchedCount ?? 0}`);
    console.log(`Updated plans: ${result.modifiedCount ?? 0}`);

    process.exit(0);
  } catch (error) {
    console.error('Billing cycle migration failed:', error);
    process.exit(1);
  }
};

runMigration();