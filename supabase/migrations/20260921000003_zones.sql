-- zones  (<- Mongoose model: Zone)
create table zones (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  name text not null unique check (char_length(name) <= 120),
  description text not null check (char_length(description) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger zones_set_updated_at
  before update on zones
  for each row execute function set_updated_at();

alter table zones enable row level security;

-- zone_countries  (<- Mongoose model: ZoneCountry)
create table zone_countries (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  zone_id uuid not null references zones (id) on delete cascade,
  country_name text not null check (char_length(country_name) <= 120),
  unique (zone_id, country_name)
);

create index zone_countries_zone_id_idx on zone_countries (zone_id);
create index zone_countries_country_name_idx on zone_countries (country_name);

alter table zone_countries enable row level security;
