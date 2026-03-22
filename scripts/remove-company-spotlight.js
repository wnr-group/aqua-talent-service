require('dotenv').config();

const connectDB = require('../src/db');
const AvailableService = require('../src/models/AvailableService');
const ActiveSubscription = require('../src/models/ActiveSubscription');
const PaymentRecord = require('../src/models/PaymentRecord');
const SystemConfig = require('../src/models/SystemConfig');
const { CONFIG_KEYS } = require('../src/constants');

const dropIndexIfExists = async (collection, indexName) => {
  try {
    await collection.dropIndex(indexName);
    console.log(`Dropped index: ${indexName}`);
  } catch (error) {
    if (error.codeName !== 'IndexNotFound' && error.code !== 27) {
      throw error;
    }
  }
};

const runMigration = async () => {
  try {
    await connectDB();

    const spotlightDeleteResult = await AvailableService.collection.deleteMany({
      $or: [
        { isCompanySpotlight: true },
        { name: /spotlight/i },
        { description: /spotlight/i }
      ]
    });

    const serviceCleanupResult = await AvailableService.collection.updateMany(
      { isCompanySpotlight: { $exists: true } },
      { $unset: { isCompanySpotlight: '' } }
    );

    const subscriptionCleanupResult = await ActiveSubscription.collection.updateMany(
      { companyId: { $exists: true } },
      { $unset: { companyId: '' } }
    );

    const paymentCleanupResult = await PaymentRecord.collection.updateMany(
      { companyId: { $exists: true } },
      { $unset: { companyId: '' } }
    );

    await dropIndexIfExists(ActiveSubscription.collection, 'companyId_1_status_1');

    const freePlan = await AvailableService.getFreePlan();
    await SystemConfig.setValue(
      CONFIG_KEYS.FREE_TIER_MAX_APPLICATIONS,
      2,
      'Maximum applications allowed for free tier'
    );

    console.log('Company spotlight cleanup completed.');
    console.log(`Spotlight plans removed: ${spotlightDeleteResult.deletedCount ?? 0}`);
    console.log(`Service documents cleaned: ${serviceCleanupResult.modifiedCount ?? 0}`);
    console.log(`Subscriptions cleaned: ${subscriptionCleanupResult.modifiedCount ?? 0}`);
    console.log(`Payment records cleaned: ${paymentCleanupResult.modifiedCount ?? 0}`);
    console.log(`Free tier plan ready: ${freePlan.name} (${freePlan._id})`);

    process.exit(0);
  } catch (error) {
    console.error('Company spotlight cleanup failed:', error);
    process.exit(1);
  }
};

runMigration();
