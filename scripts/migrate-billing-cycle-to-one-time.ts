import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { getSupabaseClient } from '../src/lib/supabase/client';

// The Postgres schema's billing_cycle CHECK constraint only ever allows
// 'one-time' (supabase/migrations/20260921000004_students_and_plans.sql),
// so this is now a defensive idempotent normalization rather than a real
// migration - any stray legacy value (from the old Mongo 'monthly'/'yearly'/
// 'one_time' days) gets corrected to the one value the schema accepts.
const runMigration = async () => {
  try {
    const supabase = getSupabaseClient();

    const { data: strayRows } = await supabase.from('available_services').select('id, billing_cycle').neq('billing_cycle', 'one-time');

    if (!strayRows || !strayRows.length) {
      console.log('Billing cycle migration: nothing to do, all plans already use one-time.');
      process.exit(0);
    }

    const { data: updated, error } = await supabase
      .from('available_services')
      .update({ billing_cycle: 'one-time' })
      .in('id', strayRows.map((row) => row.id))
      .select('id');
    if (error) throw error;

    console.log('Billing cycle migration completed.');
    console.log(`Matched plans: ${strayRows.length}`);
    console.log(`Updated plans: ${updated?.length ?? 0}`);

    process.exit(0);
  } catch (error) {
    console.error('Billing cycle migration failed:', error);
    process.exit(1);
  }
};

runMigration();
