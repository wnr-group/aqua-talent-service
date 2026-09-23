-- Extensions required by the schema.
-- gen_random_uuid() lives in pgcrypto on Postgres < 13; Supabase ships both
-- pgcrypto and the native pg 13+ gen_random_uuid() already enabled, this is
-- just belt-and-braces for environments where it isn't.
create extension if not exists pgcrypto;

-- Generic "bump updated_at on any UPDATE" trigger, reused by every table
-- below that has an updated_at column (mirrors the pre('save') hooks that
-- Mongoose used on AvailableService, Zone, SystemConfig, NotificationPreference).
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
