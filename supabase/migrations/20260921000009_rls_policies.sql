-- Explicit RLS policies for every table.
--
-- Access model: this app has no Supabase Auth and no direct frontend-to-
-- Supabase traffic - the Express backend is the only caller, always using
-- the service-role key. service_role bypasses RLS by default regardless of
-- policies, so these are defense-in-depth / documentation, not a functional
-- requirement: they make the intended access model explicit and auditable,
-- and if this project is ever connected to from anon/authenticated context
-- (e.g. a future public read API, Supabase Auth adoption), there is no
-- accidental open access to fall back on - everything stays default-deny
-- until a policy is deliberately added for that role.
--
-- RLS is already enabled per table in each table's own creation migration
-- (e.g. 20260921000002_users_and_companies.sql); this file only adds the
-- policies.

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
