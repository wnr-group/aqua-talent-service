-- system_config  (<- Mongoose model: SystemConfig)
create table system_config (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  key text not null unique,
  value jsonb not null,
  description text,
  updated_at timestamptz not null default now(),
  updated_by uuid references users (id)
);

create trigger system_config_set_updated_at
  before update on system_config
  for each row execute function set_updated_at();

alter table system_config enable row level security;

-- notifications  (<- Mongoose model: Notification)
create table notifications (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  recipient_id uuid not null references users (id),
  recipient_type text not null check (recipient_type in ('student', 'company', 'admin')),
  type text not null check (
    type in (
      'application_submitted', 'application_approved', 'application_rejected',
      'application_interview_scheduled', 'application_offer_extended', 'application_hired',
      'application_received', 'job_approved', 'company_approved', 'company_rejected',
      'ADMIN_NEW_COMPANY_PENDING', 'ADMIN_NEW_JOB_PENDING', 'ADMIN_COMPANY_REVERIFY_REQUIRED',
      'ADMIN_NEW_APPLICATION', 'withdrawal_requested', 'withdrawal_approved', 'withdrawal_rejected',
      'APPLICATION_WITHDRAWN'
    )
  ),
  title text not null check (char_length(title) <= 200),
  message text not null check (char_length(message) <= 1000),
  link text check (link is null or char_length(link) <= 500),
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index notifications_recipient_id_idx on notifications (recipient_id);
create index notifications_is_read_idx on notifications (is_read);
create index notifications_recipient_unread_created_idx on notifications (recipient_id, is_read, created_at desc);
create index notifications_recipient_created_idx on notifications (recipient_id, created_at desc);

alter table notifications enable row level security;

-- notification_preferences  (<- Mongoose model: NotificationPreference)
create table notification_preferences (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  user_id uuid not null references users (id),
  channel text not null default 'email' check (channel = 'email'),
  email_type text not null,
  opted_out boolean not null default false,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, channel, email_type)
);

create trigger notification_preferences_set_updated_at
  before update on notification_preferences
  for each row execute function set_updated_at();

alter table notification_preferences enable row level security;

-- password_reset_tokens  (<- Mongoose model: PasswordResetToken)
create table password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  token text not null unique,
  user_id uuid not null references users (id),
  user_type text not null check (user_type in ('admin', 'company', 'student')),
  email text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index password_reset_tokens_user_id_idx on password_reset_tokens (user_id);

alter table password_reset_tokens enable row level security;

-- Note: Mongo used a TTL index (expireAfterSeconds: 0 on expiresAt) to
-- auto-delete expired tokens. Every read in authController already filters
-- `expires_at > now()`, so correctness doesn't depend on physical deletion.
-- An optional cleanup job (pg_cron, or a periodic
-- `delete from password_reset_tokens where expires_at < now() - interval '7 days'`)
-- can be added later purely for table hygiene -- not required for this migration.
