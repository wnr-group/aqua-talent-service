-- users  (<- Mongoose model: User)
create table users (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,              -- original Mongo ObjectId, migration/audit bridge only
  username text not null unique,
  password_hash text not null,
  user_type text not null check (user_type in ('admin', 'company', 'student')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index users_user_type_idx on users (user_type);

alter table users enable row level security;
-- No policies: this backend talks to Supabase via the service-role key only
-- (custom JWT auth, not Supabase Auth), which bypasses RLS by design.
-- RLS is enabled here purely as a default-deny safety net.

-- companies  (<- Mongoose model: Company)
create table companies (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  user_id uuid not null unique references users (id),
  name text not null check (char_length(name) between 2 and 100),
  email text not null unique,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  logo text,
  website text,
  description text check (char_length(description) <= 2000),
  industry text check (
    industry is null or industry in (
      'Technology', 'Finance', 'Healthcare', 'Education', 'Manufacturing',
      'Retail', 'Consulting', 'Media', 'Non-profit', 'Other'
    )
  ),
  size text check (
    size is null or size in ('1-10', '11-50', '51-200', '201-500', '501-1000', '1000+')
  ),
  social_linkedin text,
  social_twitter text,
  founded_year int check (founded_year is null or founded_year between 1800 and 2200),
  rejection_reason text,
  created_at timestamptz not null default now(),
  approved_at timestamptz
);

create index companies_status_idx on companies (status);
create index companies_created_at_idx on companies (created_at desc);

alter table companies enable row level security;
