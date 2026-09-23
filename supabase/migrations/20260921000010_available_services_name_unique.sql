-- available_services never had a uniqueness guarantee on name, unlike zones
-- and addons which both already enforce it. That gap let a seed re-run
-- create a second "Free Tier" plan alongside the real migrated one (caught
-- and cleaned up manually after supabase/seed.sql's first run). Closing it
-- here so seed.sql can safely use `on conflict (name) do nothing`.
alter table available_services add constraint available_services_name_key unique (name);
