/**
 * Post-migration verification: compares row counts between Mongo collections
 * and their Postgres tables, plus a handful of relational-integrity spot
 * checks that don't exist as constraints in Mongo but are now enforced (or
 * worth confirming) in Postgres.
 *
 * Usage: npx tsc && node scripts/supabase-migration/verify.js
 */
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { models, connectMongo, disconnectMongo } from './lib/mongo-models';
import { getSupabaseClient } from '../../src/lib/supabase/client';
import { TableName } from './lib/id-map';

const tableForModel: Record<string, TableName> = {
  User: 'users',
  Company: 'companies',
  Student: 'students',
  JobPosting: 'job_postings',
  Application: 'applications',
  AvailableService: 'available_services',
  ActiveSubscription: 'active_subscriptions',
  PaymentRecord: 'payment_records',
  PayPerJobPurchase: 'pay_per_job_purchases',
  Addon: 'addons',
  PlanZone: 'plan_zones',
  SubscriptionAddon: 'subscription_addons',
  SubscriptionZone: 'subscription_zones',
  Zone: 'zones',
  ZoneCountry: 'zone_countries',
  SystemConfig: 'system_config',
  Notification: 'notifications',
  NotificationPreference: 'notification_preferences',
  PasswordResetToken: 'password_reset_tokens'
};

const run = async () => {
  await connectMongo();
  const supabase = getSupabaseClient();

  console.log('Row count comparison (Mongo collection -> Postgres table):\n');
  let mismatches = 0;

  for (const [modelName, model] of Object.entries(models)) {
    const table = tableForModel[modelName];
    const mongoCount = await model.countDocuments({});
    const { count: pgCount, error } = await supabase.from(table).select('*', { count: 'exact', head: true });

    if (error) {
      console.log(`  ${table.padEnd(26)} ERROR: ${error.message}`);
      mismatches++;
      continue;
    }

    const match = mongoCount === (pgCount ?? 0);
    if (!match) mismatches++;

    console.log(`  ${table.padEnd(26)} mongo=${mongoCount}  postgres=${pgCount}  ${match ? 'OK' : 'MISMATCH'}`);
  }

  console.log('\nRelational integrity spot checks:\n');

  const checks: Array<[string, () => Promise<number | null>]> = [
    [
      'students with current_subscription_id pointing at a missing subscription',
      async () => {
        const { data: students } = await supabase.from('students').select('id, current_subscription_id');
        if (!students) return null;
        const withSub = students.filter((s: any) => s.current_subscription_id);
        if (!withSub.length) return 0;
        const { data: subs } = await supabase
          .from('active_subscriptions')
          .select('id')
          .in('id', withSub.map((s: any) => s.current_subscription_id));
        const validIds = new Set((subs ?? []).map((s: any) => s.id));
        return withSub.filter((s: any) => !validIds.has(s.current_subscription_id)).length;
      }
    ],
    [
      'applications referencing a missing student or job posting',
      async () => {
        const { data: apps } = await supabase.from('applications').select('id, student_id, job_posting_id');
        if (!apps || !apps.length) return 0;
        const { data: students } = await supabase.from('students').select('id');
        const { data: jobs } = await supabase.from('job_postings').select('id');
        const studentIds = new Set((students ?? []).map((s: any) => s.id));
        const jobIds = new Set((jobs ?? []).map((j: any) => j.id));
        return apps.filter((a: any) => !studentIds.has(a.student_id) || !jobIds.has(a.job_posting_id)).length;
      }
    ]
  ];

  for (const [label, check] of checks) {
    const result = await check();
    console.log(`  ${label}: ${result === null ? 'skipped' : result}`);
    if (result) mismatches++;
  }

  console.log(mismatches ? `\n${mismatches} issue(s) found - review above.` : '\nAll checks passed.');
  await disconnectMongo();
  process.exitCode = mismatches ? 1 : 0;
};

run().catch((error) => {
  console.error('Verification failed:', error.message || error);
  process.exitCode = 1;
});
