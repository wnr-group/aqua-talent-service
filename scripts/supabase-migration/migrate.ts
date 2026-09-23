/**
 * One-time Mongo -> Supabase Postgres data migration.
 *
 * Safe by default: runs as a dry run (reads Mongo, builds rows, prints a
 * summary) unless invoked with --execute. Never writes to Mongo. Refuses to
 * run --execute against a Supabase project that already has rows in `users`
 * unless --force is also passed, to avoid double-inserting.
 *
 * Usage:
 *   npx tsc && node scripts/supabase-migration/migrate.js              # dry run
 *   npx tsc && node scripts/supabase-migration/migrate.js --execute     # real run
 */
import path from 'path';
import { randomUUID } from 'crypto';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { models, connectMongo, disconnectMongo } from './lib/mongo-models';
import { IdMaps, TableName } from './lib/id-map';
import { getSupabaseClient } from '../../src/lib/supabase/client';

const EXECUTE = process.argv.includes('--execute');
const FORCE = process.argv.includes('--force');
const CHUNK_SIZE = 500;

const iso = (value: any): string | null => (value ? new Date(value).toISOString() : null);
const str = (value: any): string | null => (value === null || value === undefined ? null : String(value));

type Loaded = Record<string, { docs: any[] }>;

const loadFromMongo = async (idMaps: IdMaps): Promise<Loaded> => {
  const loaded: Loaded = {};

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

  for (const [modelName, model] of Object.entries(models)) {
    const table = tableForModel[modelName];
    const docs = await model.find({}).lean();

    for (const doc of docs) {
      idMaps.set(table, String(doc._id), randomUUID());
    }

    loaded[table] = { docs };
  }

  return loaded;
};

// ─── Per-table row builders (Mongo doc -> Postgres row) ────────────────────

const buildUsers = (loaded: Loaded, idMaps: IdMaps) =>
  loaded.users.docs.map((d) => ({
    id: idMaps.getOrThrow('users', String(d._id), 'users row'),
    legacy_id: String(d._id),
    username: d.username,
    password_hash: d.passwordHash,
    user_type: d.userType,
    is_active: d.isActive ?? true,
    created_at: iso(d.createdAt) ?? new Date().toISOString()
  }));

const buildCompanies = (loaded: Loaded, idMaps: IdMaps) =>
  loaded.companies.docs.map((d) => ({
    id: idMaps.getOrThrow('companies', String(d._id), 'companies row'),
    legacy_id: String(d._id),
    user_id: idMaps.getOrThrow('users', str(d.userId), `companies(${d._id}).userId`),
    name: d.name,
    email: d.email,
    status: d.status,
    logo: d.logo ?? null,
    website: d.website ?? null,
    description: d.description ?? null,
    industry: d.industry ?? null,
    size: d.size ?? null,
    social_linkedin: d.socialLinks?.linkedin ?? null,
    social_twitter: d.socialLinks?.twitter ?? null,
    founded_year: d.foundedYear ?? null,
    rejection_reason: d.rejectionReason ?? null,
    created_at: iso(d.createdAt) ?? new Date().toISOString(),
    approved_at: iso(d.approvedAt)
  }));

const buildZones = (loaded: Loaded, idMaps: IdMaps) =>
  loaded.zones.docs.map((d) => ({
    id: idMaps.getOrThrow('zones', String(d._id), 'zones row'),
    legacy_id: String(d._id),
    name: d.name,
    description: d.description,
    created_at: iso(d.createdAt) ?? new Date().toISOString(),
    updated_at: iso(d.updatedAt) ?? new Date().toISOString()
  }));

const buildZoneCountries = (loaded: Loaded, idMaps: IdMaps) =>
  loaded.zone_countries.docs.map((d) => ({
    id: idMaps.getOrThrow('zone_countries', String(d._id), 'zone_countries row'),
    legacy_id: String(d._id),
    zone_id: idMaps.getOrThrow('zones', str(d.zoneId), `zone_countries(${d._id}).zoneId`),
    country_name: d.countryName
  }));

// current_subscription_id deliberately left null here - resolved in a
// separate UPDATE pass after active_subscriptions has been inserted.
const buildStudents = (loaded: Loaded, idMaps: IdMaps) =>
  loaded.students.docs.map((d) => ({
    id: idMaps.getOrThrow('students', String(d._id), 'students row'),
    legacy_id: String(d._id),
    user_id: idMaps.getOrThrow('users', str(d.userId), `students(${d._id}).userId`),
    student_id: d.studentId,
    full_name: d.fullName,
    email: d.email,
    is_dg_shipping: d.isDGShipping ?? 'no',
    profile_link: d.profileLink ?? null,
    is_hired: d.isHired ?? false,
    bio: d.bio ?? null,
    location: d.location ?? null,
    available_from: d.availableFrom ? new Date(d.availableFrom).toISOString().slice(0, 10) : null,
    skills: Array.isArray(d.skills) ? d.skills : [],
    education: Array.isArray(d.education) ? d.education : [],
    experience: Array.isArray(d.experience) ? d.experience : [],
    resume_url: d.resumeUrl ?? null,
    intro_video_url: d.introVideoUrl ?? null,
    current_subscription_id: null as string | null,
    subscription_tier: d.subscriptionTier ?? 'free',
    created_at: iso(d.createdAt) ?? new Date().toISOString()
  }));

const buildAvailableServices = (loaded: Loaded, idMaps: IdMaps) =>
  loaded.available_services.docs.map((d) => ({
    id: idMaps.getOrThrow('available_services', String(d._id), 'available_services row'),
    legacy_id: String(d._id),
    name: d.name,
    tier: d.tier ?? 'paid',
    description: d.description,
    max_applications: d.maxApplications ?? null,
    price: d.price,
    price_inr: d.priceINR,
    price_usd: d.priceUSD ?? 0,
    currency: d.currency ?? 'USD',
    // The destination billing_cycle CHECK constraint only accepts 'one-time'
    // (supabase/migrations/20260921000004_students_and_plans.sql) - legacy
    // Mongo values ('monthly', 'yearly', 'one_time') must be normalized here
    // or the insert fails the constraint before scripts/migrate-billing-cycle-
    // to-one-time.ts ever gets a chance to run.
    billing_cycle: 'one-time',
    discount: d.discount ?? 0,
    features: Array.isArray(d.features) ? d.features : [],
    badge: d.badge ?? null,
    display_order: d.displayOrder ?? 0,
    resume_downloads: d.resumeDownloads ?? null,
    video_views: d.videoViews ?? null,
    priority_support: d.prioritySupport ?? false,
    profile_boost: d.profileBoost ?? false,
    application_highlight: d.applicationHighlight ?? false,
    is_active: d.isActive ?? true,
    all_zones_included: d.allZonesIncluded ?? false,
    created_at: iso(d.createdAt) ?? new Date().toISOString(),
    updated_at: iso(d.updatedAt) ?? new Date().toISOString()
  }));

const buildActiveSubscriptions = (loaded: Loaded, idMaps: IdMaps) =>
  loaded.active_subscriptions.docs.map((d) => ({
    id: idMaps.getOrThrow('active_subscriptions', String(d._id), 'active_subscriptions row'),
    legacy_id: String(d._id),
    student_id: idMaps.getOrThrow('students', str(d.studentId), `active_subscriptions(${d._id}).studentId`),
    service_id: idMaps.getOrThrow('available_services', str(d.serviceId), `active_subscriptions(${d._id}).serviceId`),
    start_date: iso(d.startDate) ?? new Date().toISOString(),
    end_date: iso(d.endDate),
    status: d.status ?? 'pending',
    auto_renew: d.autoRenew ?? false,
    applications_used: d.applicationsUsed ?? 0,
    stacked_applications: d.stackedApplications ?? 0,
    created_at: iso(d.createdAt) ?? new Date().toISOString()
  }));

const buildJobPostings = (loaded: Loaded, idMaps: IdMaps) =>
  loaded.job_postings.docs.map((d) => ({
    id: idMaps.getOrThrow('job_postings', String(d._id), 'job_postings row'),
    legacy_id: String(d._id),
    company_id: idMaps.getOrThrow('companies', str(d.companyId), `job_postings(${d._id}).companyId`),
    title: d.title ?? null,
    description: d.description ?? null,
    requirements: d.requirements ?? null,
    location: d.location ?? null,
    country_id: idMaps.get('zone_countries', str(d.countryId)),
    job_type: d.jobType ?? null,
    salary_range: d.salaryRange ?? null,
    deadline: iso(d.deadline),
    status: d.status ?? 'pending',
    rejection_reason: d.rejectionReason ?? null,
    created_at: iso(d.createdAt) ?? new Date().toISOString(),
    approved_at: iso(d.approvedAt)
  }));

const buildApplications = (loaded: Loaded, idMaps: IdMaps) =>
  loaded.applications.docs.map((d) => ({
    id: idMaps.getOrThrow('applications', String(d._id), 'applications row'),
    legacy_id: String(d._id),
    student_id: idMaps.getOrThrow('students', str(d.studentId), `applications(${d._id}).studentId`),
    job_posting_id: idMaps.getOrThrow('job_postings', str(d.jobPostingId), `applications(${d._id}).jobPostingId`),
    status: d.status ?? 'pending',
    rejection_reason: d.rejectionReason ?? null,
    rejection_source: d.rejectionSource ?? null,
    interview_date: iso(d.interviewDate),
    interview_notes: d.interviewNotes ?? null,
    offer_details: d.offerDetails ?? null,
    created_at: iso(d.createdAt) ?? new Date().toISOString(),
    reviewed_at: iso(d.reviewedAt)
  }));

const buildPaymentRecords = (loaded: Loaded, idMaps: IdMaps) =>
  loaded.payment_records.docs.map((d) => ({
    id: idMaps.getOrThrow('payment_records', String(d._id), 'payment_records row'),
    legacy_id: String(d._id),
    student_id: idMaps.getOrThrow('students', str(d.studentId), `payment_records(${d._id}).studentId`),
    service_id: idMaps.get('available_services', str(d.serviceId)),
    subscription_id: idMaps.get('active_subscriptions', str(d.subscriptionId)),
    amount: d.amount,
    currency: d.currency ?? 'USD',
    payment_date: iso(d.paymentDate) ?? new Date().toISOString(),
    status: d.status ?? 'completed',
    razorpay_order_id: d.razorpayOrderId ?? null,
    razorpay_payment_id: d.razorpayPaymentId ?? null,
    transaction_id: d.transactionId,
    payment_gateway: d.paymentGateway ?? 'razorpay',
    payment_method: d.paymentMethod ?? null,
    gateway_response: d.gatewayResponse ?? null,
    created_at: iso(d.createdAt) ?? new Date().toISOString()
  }));

const buildPayPerJobPurchases = (loaded: Loaded, idMaps: IdMaps) =>
  loaded.pay_per_job_purchases.docs.map((d) => ({
    id: idMaps.getOrThrow('pay_per_job_purchases', String(d._id), 'pay_per_job_purchases row'),
    legacy_id: String(d._id),
    student_id: idMaps.getOrThrow('students', str(d.studentId), `pay_per_job_purchases(${d._id}).studentId`),
    job_posting_id: idMaps.getOrThrow('job_postings', str(d.jobPostingId), `pay_per_job_purchases(${d._id}).jobPostingId`),
    amount: d.amount,
    currency: d.currency,
    payment_record_id: idMaps.get('payment_records', str(d.paymentRecordId)),
    razorpay_order_id: d.razorpayOrderId ?? null,
    status: d.status ?? 'pending',
    created_at: iso(d.createdAt) ?? new Date().toISOString(),
    completed_at: iso(d.completedAt)
  }));

const buildAddons = (loaded: Loaded, idMaps: IdMaps) =>
  loaded.addons.docs.map((d) => ({
    id: idMaps.getOrThrow('addons', String(d._id), 'addons row'),
    legacy_id: String(d._id),
    name: d.name,
    type: d.type,
    price_inr: d.priceINR ?? null,
    price_usd: d.priceUSD ?? null,
    zone_count: d.zoneCount ?? null,
    job_credit_count: d.jobCreditCount ?? null,
    unlock_all_zones: d.unlockAllZones ?? false,
    created_at: iso(d.createdAt) ?? new Date().toISOString()
  }));

const buildPlanZones = (loaded: Loaded, idMaps: IdMaps) =>
  loaded.plan_zones.docs.map((d) => ({
    id: idMaps.getOrThrow('plan_zones', String(d._id), 'plan_zones row'),
    legacy_id: String(d._id),
    plan_id: idMaps.getOrThrow('available_services', str(d.planId), `plan_zones(${d._id}).planId`),
    zone_id: idMaps.getOrThrow('zones', str(d.zoneId), `plan_zones(${d._id}).zoneId`)
  }));

const buildSubscriptionAddons = (loaded: Loaded, idMaps: IdMaps) =>
  loaded.subscription_addons.docs.map((d) => ({
    id: idMaps.getOrThrow('subscription_addons', String(d._id), 'subscription_addons row'),
    legacy_id: String(d._id),
    subscription_id: idMaps.getOrThrow('active_subscriptions', str(d.subscriptionId), `subscription_addons(${d._id}).subscriptionId`),
    addon_id: idMaps.getOrThrow('addons', str(d.addonId), `subscription_addons(${d._id}).addonId`),
    payment_record_id: idMaps.get('payment_records', str(d.paymentRecordId)),
    quantity: d.quantity ?? 1,
    created_at: iso(d.createdAt) ?? new Date().toISOString()
  }));

const buildSubscriptionZones = (loaded: Loaded, idMaps: IdMaps) =>
  loaded.subscription_zones.docs.map((d) => ({
    id: idMaps.getOrThrow('subscription_zones', String(d._id), 'subscription_zones row'),
    legacy_id: String(d._id),
    subscription_id: idMaps.getOrThrow('active_subscriptions', str(d.subscriptionId), `subscription_zones(${d._id}).subscriptionId`),
    zone_id: idMaps.getOrThrow('zones', str(d.zoneId), `subscription_zones(${d._id}).zoneId`),
    source: d.source ?? 'plan',
    created_at: iso(d.createdAt) ?? new Date().toISOString()
  }));

const buildSystemConfig = (loaded: Loaded, idMaps: IdMaps) =>
  loaded.system_config.docs.map((d) => ({
    id: idMaps.getOrThrow('system_config', String(d._id), 'system_config row'),
    legacy_id: String(d._id),
    key: d.key,
    value: d.value,
    description: d.description ?? null,
    updated_at: iso(d.updatedAt) ?? new Date().toISOString(),
    updated_by: idMaps.get('users', str(d.updatedBy))
  }));

const buildNotifications = (loaded: Loaded, idMaps: IdMaps) =>
  loaded.notifications.docs.map((d) => ({
    id: idMaps.getOrThrow('notifications', String(d._id), 'notifications row'),
    legacy_id: String(d._id),
    recipient_id: idMaps.getOrThrow('users', str(d.recipientId), `notifications(${d._id}).recipientId`),
    recipient_type: d.recipientType,
    type: d.type,
    title: d.title,
    message: d.message,
    link: d.link ?? null,
    is_read: d.isRead ?? false,
    created_at: iso(d.createdAt) ?? new Date().toISOString()
  }));

const buildNotificationPreferences = (loaded: Loaded, idMaps: IdMaps) =>
  loaded.notification_preferences.docs.map((d) => ({
    id: idMaps.getOrThrow('notification_preferences', String(d._id), 'notification_preferences row'),
    legacy_id: String(d._id),
    user_id: idMaps.getOrThrow('users', str(d.userId), `notification_preferences(${d._id}).userId`),
    channel: d.channel ?? 'email',
    email_type: d.emailType,
    opted_out: d.optedOut ?? false,
    metadata: d.metadata ?? null,
    created_at: iso(d.createdAt) ?? new Date().toISOString(),
    updated_at: iso(d.updatedAt) ?? new Date().toISOString()
  }));

const buildPasswordResetTokens = (loaded: Loaded, idMaps: IdMaps) =>
  loaded.password_reset_tokens.docs.map((d) => ({
    id: idMaps.getOrThrow('password_reset_tokens', String(d._id), 'password_reset_tokens row'),
    legacy_id: String(d._id),
    token: d.token,
    user_id: idMaps.getOrThrow('users', str(d.userId), `password_reset_tokens(${d._id}).userId`),
    user_type: d.userType,
    email: d.email,
    expires_at: iso(d.expiresAt) ?? new Date().toISOString(),
    used_at: iso(d.usedAt),
    created_at: iso(d.createdAt) ?? new Date().toISOString()
  }));

// ─── Insert helpers ─────────────────────────────────────────────────────────

const insertChunked = async (supabase: ReturnType<typeof getSupabaseClient>, table: TableName, rows: any[]) => {
  if (!rows.length) {
    return;
  }

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const { error } = await supabase.from(table).insert(chunk as any);
    if (error) {
      throw new Error(`Insert into ${table} failed at rows ${i}-${i + chunk.length}: ${error.message}`);
    }
  }
};

// ─── Main ───────────────────────────────────────────────────────────────────

const run = async () => {
  console.log(EXECUTE ? '=== EXECUTE MODE: writing to Supabase ===' : '=== DRY RUN: no writes will happen ===');

  await connectMongo();
  const idMaps = new IdMaps();
  const loaded = await loadFromMongo(idMaps);

  const tableRows: Array<[TableName, any[]]> = [
    ['users', buildUsers(loaded, idMaps)],
    ['companies', buildCompanies(loaded, idMaps)],
    ['zones', buildZones(loaded, idMaps)],
    ['zone_countries', buildZoneCountries(loaded, idMaps)],
    ['students', buildStudents(loaded, idMaps)],
    ['available_services', buildAvailableServices(loaded, idMaps)],
    ['active_subscriptions', buildActiveSubscriptions(loaded, idMaps)],
    ['job_postings', buildJobPostings(loaded, idMaps)],
    ['applications', buildApplications(loaded, idMaps)],
    ['payment_records', buildPaymentRecords(loaded, idMaps)],
    ['pay_per_job_purchases', buildPayPerJobPurchases(loaded, idMaps)],
    ['addons', buildAddons(loaded, idMaps)],
    ['plan_zones', buildPlanZones(loaded, idMaps)],
    ['subscription_addons', buildSubscriptionAddons(loaded, idMaps)],
    ['subscription_zones', buildSubscriptionZones(loaded, idMaps)],
    ['system_config', buildSystemConfig(loaded, idMaps)],
    ['notifications', buildNotifications(loaded, idMaps)],
    ['notification_preferences', buildNotificationPreferences(loaded, idMaps)],
    ['password_reset_tokens', buildPasswordResetTokens(loaded, idMaps)]
  ];

  console.log('\nRows built from Mongo (Mongo was only read, never modified):');
  for (const [table, rows] of tableRows) {
    console.log(`  ${table.padEnd(26)} ${rows.length}`);
  }

  // Resolve students.current_subscription_id now that active_subscriptions ids are known.
  const studentUpdates = loaded.students.docs
    .filter((d) => d.currentSubscriptionId)
    .map((d) => ({
      id: idMaps.getOrThrow('students', String(d._id), `students(${d._id}) update`),
      current_subscription_id: idMaps.get('active_subscriptions', str(d.currentSubscriptionId))
    }))
    .filter((u) => u.current_subscription_id);

  console.log(`  students.current_subscription_id backfill: ${studentUpdates.length} row(s)`);

  if (!EXECUTE) {
    // Print only column names + id, never row values - many of these tables
    // carry password hashes, reset tokens, emails, or gateway responses, and
    // this dry-run output routinely ends up in terminal scrollback/CI logs.
    console.log('\nDry run only - columns and id for the first row of each non-empty table:');
    for (const [table, rows] of tableRows) {
      if (rows.length) {
        const sample = rows[0] as Record<string, unknown>;
        console.log(`\n[${table}] id=${String(sample.id)} columns=[${Object.keys(sample).join(', ')}]`);
      }
    }
    console.log('\nRe-run with --execute to write these rows to Supabase.');
    await disconnectMongo();
    return;
  }

  const supabase = getSupabaseClient();

  if (!FORCE) {
    const { count, error } = await supabase.from('users').select('*', { count: 'exact', head: true });
    if (error) {
      throw new Error(`Pre-flight check against Supabase failed: ${error.message}`);
    }
    if ((count ?? 0) > 0) {
      throw new Error(
        `Supabase "users" table already has ${count} row(s). Refusing to run to avoid duplicate inserts. ` +
        `Pass --force to override (only if you know what you're doing).`
      );
    }
  }

  for (const [table, rows] of tableRows) {
    await insertChunked(supabase, table, rows);
    console.log(`  inserted ${table} (${rows.length})`);
  }

  if (studentUpdates.length) {
    for (const update of studentUpdates) {
      const { error } = await supabase
        .from('students')
        .update({ current_subscription_id: update.current_subscription_id })
        .eq('id', update.id);
      if (error) {
        throw new Error(`Failed to backfill students.current_subscription_id for ${update.id}: ${error.message}`);
      }
    }
    console.log(`  backfilled students.current_subscription_id (${studentUpdates.length})`);
  }

  console.log('\nMigration complete. Run verify.ts next.');
  await disconnectMongo();
};

run()
  .catch((error) => {
    console.error('\nMigration failed:', error.message || error);
    process.exitCode = 1;
  })
  .finally(() => disconnectMongo());
