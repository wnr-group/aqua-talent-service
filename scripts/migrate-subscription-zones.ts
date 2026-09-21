/**
 * Backfill script: populate subscription_zones for active subscriptions that
 * don't have any yet (e.g. ones created before zone tracking existed).
 * Run with: npx tsc && node scripts/migrate-subscription-zones.js
 */
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { getSupabaseClient } from '../src/lib/supabase/client';
import { ensureSubscriptionZonesForPlan } from '../src/services/zonePricingService';

const migrate = async () => {
  const supabase = getSupabaseClient();

  const { data: subscriptions, error } = await supabase
    .from('active_subscriptions')
    .select('id, service_id')
    .eq('status', 'active');
  if (error) throw error;

  console.log(`Found ${subscriptions?.length ?? 0} active subscriptions`);

  let migrated = 0;
  let skipped = 0;

  for (const sub of subscriptions || []) {
    const { count: existingZones } = await supabase
      .from('subscription_zones')
      .select('*', { count: 'exact', head: true })
      .eq('subscription_id', sub.id);

    if ((existingZones ?? 0) > 0) {
      skipped++;
      continue;
    }

    const created = await ensureSubscriptionZonesForPlan({ subscriptionId: sub.id, serviceId: sub.service_id });

    if (created > 0) {
      migrated++;
      console.log(`Migrated subscription ${sub.id}: ${created} zones`);
    } else {
      skipped++;
    }
  }

  console.log(`\nMigration complete: ${migrated} migrated, ${skipped} skipped`);
};

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
