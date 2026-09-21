-- students  (<- Mongoose model: Student)
-- current_subscription_id is added as a plain uuid column here; its FK to
-- active_subscriptions(id) is attached in the next migration once that
-- table exists (Student <-> ActiveSubscription reference each other, same
-- as they did in Mongo).
create table students (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  user_id uuid not null unique references users (id),
  student_id text not null unique check (char_length(student_id) between 3 and 30),
  full_name text not null check (char_length(full_name) between 2 and 100),
  email text not null unique,
  is_dg_shipping text not null default 'no' check (is_dg_shipping in ('yes', 'no')),
  profile_link text check (profile_link is null or char_length(profile_link) <= 500),
  is_hired boolean not null default false,
  bio text check (bio is null or char_length(bio) <= 2000),
  location text check (location is null or char_length(location) <= 200),
  available_from date,
  skills text[] not null default '{}',
  education jsonb not null default '[]',
  experience jsonb not null default '[]',
  resume_url text,
  intro_video_url text,
  current_subscription_id uuid,
  subscription_tier text not null default 'free' check (subscription_tier in ('free', 'paid')),
  created_at timestamptz not null default now()
);

create index students_is_hired_idx on students (is_hired);

alter table students enable row level security;

-- available_services  (<- Mongoose model: AvailableService)
create table available_services (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  name text not null check (char_length(name) <= 120),
  tier text not null default 'paid' check (tier in ('free', 'paid')),
  description text not null check (char_length(description) <= 1000),
  max_applications int check (max_applications is null or max_applications >= 1),
  price numeric(10, 2) not null check (price >= 0),
  price_inr numeric(10, 2) not null check (price_inr >= 0),
  price_usd numeric(10, 2) not null default 0 check (price_usd >= 0),
  currency text not null default 'USD' check (currency in ('USD', 'EUR', 'GBP', 'INR', 'AUD', 'CAD')),
  billing_cycle text not null default 'one-time' check (billing_cycle = 'one-time'),
  discount int not null default 0 check (discount between 0 and 100),
  features text[] not null default '{}',
  badge text check (badge is null or char_length(badge) <= 50),
  display_order int not null default 0,
  resume_downloads int,
  video_views int,
  priority_support boolean not null default false,
  profile_boost boolean not null default false,
  application_highlight boolean not null default false,
  is_active boolean not null default true,
  all_zones_included boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index available_services_is_active_idx on available_services (is_active);
create index available_services_price_idx on available_services (price);
create index available_services_display_order_idx on available_services (display_order);
create index available_services_tier_idx on available_services (tier);

create trigger available_services_set_updated_at
  before update on available_services
  for each row execute function set_updated_at();

alter table available_services enable row level security;
