/**
 * Migration script to populate SubscriptionZone for existing subscriptions.
 * Run with: node scripts/migrate-subscription-zones.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

async function migrate() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const ActiveSubscription = require('../src/models/ActiveSubscription');
  const PlanZone = require('../src/models/PlanZone');
  const SubscriptionZone = require('../src/models/SubscriptionZone');

  const subscriptions = await ActiveSubscription.find({ status: 'active' })
    .populate('serviceId', 'allZonesIncluded');

  console.log(`Found ${subscriptions.length} active subscriptions`);

  let migrated = 0;
  let skipped = 0;

  for (const sub of subscriptions) {
    if (sub.serviceId?.allZonesIncluded) {
      skipped++;
      continue;
    }

    const planZones = await PlanZone.find({ planId: sub.serviceId._id });

    if (planZones.length === 0) {
      skipped++;
      continue;
    }

    for (const pz of planZones) {
      await SubscriptionZone.findOneAndUpdate(
        { subscriptionId: sub._id, zoneId: pz.zoneId },
        {
          $setOnInsert: {
            subscriptionId: sub._id,
            zoneId: pz.zoneId,
            source: 'plan',
            createdAt: new Date()
          }
        },
        { upsert: true }
      );
    }

    migrated++;
    console.log(`Migrated subscription ${sub._id}: ${planZones.length} zones`);
  }

  console.log(`\nMigration complete: ${migrated} migrated, ${skipped} skipped`);
  await mongoose.disconnect();
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
