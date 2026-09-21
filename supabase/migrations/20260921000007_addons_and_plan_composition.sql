-- addons  (<- Mongoose model: Addon)
create table addons (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  name text not null unique check (char_length(name) <= 120),
  type text not null check (type in ('zone', 'jobs', 'pay-per-job')),
  price_inr numeric(10, 2) check (price_inr is null or price_inr >= 0),
  price_usd numeric(10, 2) check (price_usd is null or price_usd >= 0),
  zone_count int check (zone_count is null or zone_count >= 1),
  job_credit_count int check (job_credit_count is null or job_credit_count >= 1),
  unlock_all_zones boolean not null default false,
  created_at timestamptz not null default now(),
  -- Mirrors Addon's pre('validate') hook: each addon type only carries the
  -- fields that make sense for it.
  constraint addons_type_fields_consistent check (
    (type = 'jobs' and job_credit_count is not null and job_credit_count > 0 and zone_count is null)
    or (type = 'zone' and job_credit_count is null and (unlock_all_zones = true or (zone_count is not null and zone_count > 0)))
    or (type = 'pay-per-job' and zone_count is null and job_credit_count is null)
  )
);

create index addons_type_idx on addons (type);
create index addons_unlock_all_zones_idx on addons (unlock_all_zones);

alter table addons enable row level security;

-- plan_zones  (<- Mongoose model: PlanZone)
create table plan_zones (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  plan_id uuid not null references available_services (id) on delete cascade,
  zone_id uuid not null references zones (id) on delete cascade,
  unique (plan_id, zone_id)
);

create index plan_zones_plan_id_idx on plan_zones (plan_id);
create index plan_zones_zone_id_idx on plan_zones (zone_id);

alter table plan_zones enable row level security;

-- subscription_addons  (<- Mongoose model: SubscriptionAddon)
create table subscription_addons (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  subscription_id uuid not null references active_subscriptions (id) on delete cascade,
  addon_id uuid not null references addons (id),
  payment_record_id uuid references payment_records (id),
  quantity int not null default 1 check (quantity >= 1),
  created_at timestamptz not null default now(),
  unique (subscription_id, addon_id)
);

create index subscription_addons_subscription_id_idx on subscription_addons (subscription_id);
create index subscription_addons_addon_id_idx on subscription_addons (addon_id);

alter table subscription_addons enable row level security;

-- subscription_zones  (<- Mongoose model: SubscriptionZone)
create table subscription_zones (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  subscription_id uuid not null references active_subscriptions (id) on delete cascade,
  zone_id uuid not null references zones (id),
  source text not null default 'plan' check (source in ('plan', 'addon', 'bundle')),
  created_at timestamptz not null default now(),
  unique (subscription_id, zone_id)
);

create index subscription_zones_subscription_id_idx on subscription_zones (subscription_id);
create index subscription_zones_zone_id_idx on subscription_zones (zone_id);

alter table subscription_zones enable row level security;
