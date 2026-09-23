-- Rename the service_role RLS policies (created by the loop in
-- 20260921000009_rls_policies.sql as "service_role_full_access" on every
-- table) to explicit, per-table names. Editing an already-applied migration
-- file has no effect on a remote database, since supabase db push tracks
-- applied migrations by version, not content - so this is a real migration
-- that drops the old policies and recreates them under the new names.
--
-- Purely a naming/format change: same tables, same service_role-only access,
-- same USING (true) WITH CHECK (true).

DROP POLICY IF EXISTS "service_role_full_access" ON users;
DROP POLICY IF EXISTS "service_role_full_access" ON companies;
DROP POLICY IF EXISTS "service_role_full_access" ON students;
DROP POLICY IF EXISTS "service_role_full_access" ON zones;
DROP POLICY IF EXISTS "service_role_full_access" ON zone_countries;
DROP POLICY IF EXISTS "service_role_full_access" ON available_services;
DROP POLICY IF EXISTS "service_role_full_access" ON active_subscriptions;
DROP POLICY IF EXISTS "service_role_full_access" ON job_postings;
DROP POLICY IF EXISTS "service_role_full_access" ON applications;
DROP POLICY IF EXISTS "service_role_full_access" ON payment_records;
DROP POLICY IF EXISTS "service_role_full_access" ON pay_per_job_purchases;
DROP POLICY IF EXISTS "service_role_full_access" ON addons;
DROP POLICY IF EXISTS "service_role_full_access" ON plan_zones;
DROP POLICY IF EXISTS "service_role_full_access" ON subscription_addons;
DROP POLICY IF EXISTS "service_role_full_access" ON subscription_zones;
DROP POLICY IF EXISTS "service_role_full_access" ON system_config;
DROP POLICY IF EXISTS "service_role_full_access" ON notifications;
DROP POLICY IF EXISTS "service_role_full_access" ON notification_preferences;
DROP POLICY IF EXISTS "service_role_full_access" ON password_reset_tokens;

CREATE POLICY "Enable all operations for service_role on users" ON users FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Enable all operations for service_role on companies" ON companies FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Enable all operations for service_role on students" ON students FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Enable all operations for service_role on zones" ON zones FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Enable all operations for service_role on zone_countries" ON zone_countries FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Enable all operations for service_role on available_services" ON available_services FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Enable all operations for service_role on active_subscriptions" ON active_subscriptions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Enable all operations for service_role on job_postings" ON job_postings FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Enable all operations for service_role on applications" ON applications FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Enable all operations for service_role on payment_records" ON payment_records FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Enable all operations for service_role on pay_per_job_purchases" ON pay_per_job_purchases FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Enable all operations for service_role on addons" ON addons FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Enable all operations for service_role on plan_zones" ON plan_zones FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Enable all operations for service_role on subscription_addons" ON subscription_addons FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Enable all operations for service_role on subscription_zones" ON subscription_zones FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Enable all operations for service_role on system_config" ON system_config FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Enable all operations for service_role on notifications" ON notifications FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Enable all operations for service_role on notification_preferences" ON notification_preferences FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Enable all operations for service_role on password_reset_tokens" ON password_reset_tokens FOR ALL TO service_role USING (true) WITH CHECK (true);
