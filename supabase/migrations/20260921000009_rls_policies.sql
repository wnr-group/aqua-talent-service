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
do $$
declare
  t text;
begin
  foreach t in array array[
    'users', 'companies', 'students', 'zones', 'zone_countries',
    'available_services', 'active_subscriptions', 'job_postings', 'applications',
    'payment_records', 'pay_per_job_purchases', 'addons', 'plan_zones',
    'subscription_addons', 'subscription_zones', 'system_config',
    'notifications', 'notification_preferences', 'password_reset_tokens'
  ]
  loop
    execute format(
      'create policy "service_role_full_access" on %I for all to service_role using (true) with check (true);',
      t
    );
  end loop;
end $$;
