-- active_subscriptions  (<- Mongoose model: ActiveSubscription)
create table active_subscriptions (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  student_id uuid not null references students (id) on delete cascade,
  service_id uuid not null references available_services (id),
  start_date timestamptz not null default now(),
  end_date timestamptz,
  status text not null default 'pending' check (status in ('active', 'expired', 'cancelled', 'pending', 'exhausted')),
  auto_renew boolean not null default false,
  applications_used int not null default 0 check (applications_used >= 0),
  stacked_applications int not null default 0 check (stacked_applications >= 0),
  created_at timestamptz not null default now()
);

create index active_subscriptions_student_status_idx on active_subscriptions (student_id, status);
create index active_subscriptions_student_end_date_idx on active_subscriptions (student_id, end_date desc);

alter table active_subscriptions enable row level security;

-- Now that active_subscriptions exists, attach students.current_subscription_id's FK.
alter table students
  add constraint students_current_subscription_id_fkey
  foreign key (current_subscription_id) references active_subscriptions (id);

-- payment_records  (<- Mongoose model: PaymentRecord)
create table payment_records (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  student_id uuid not null references students (id),
  service_id uuid references available_services (id),
  subscription_id uuid references active_subscriptions (id),
  amount numeric(10, 2) not null check (amount >= 0),
  currency text not null default 'USD',
  payment_date timestamptz not null default now(),
  status text not null default 'completed' check (status in ('pending', 'paid', 'completed', 'failed', 'refunded')),
  razorpay_order_id text unique,
  razorpay_payment_id text,
  transaction_id text not null unique,
  payment_gateway text not null default 'razorpay',
  payment_method text,
  gateway_response jsonb,
  created_at timestamptz not null default now()
);

create index payment_records_student_payment_date_idx on payment_records (student_id, payment_date desc);

alter table payment_records enable row level security;

-- pay_per_job_purchases  (<- Mongoose model: PayPerJobPurchase)
-- job_posting_id FK is added in the jobs migration once job_postings exists.
create table pay_per_job_purchases (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  student_id uuid not null references students (id),
  job_posting_id uuid not null,
  amount numeric(10, 2) not null check (amount >= 0),
  currency text not null check (currency in ('INR', 'USD')),
  payment_record_id uuid references payment_records (id),
  razorpay_order_id text,
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- Unique constraint only on completed purchases - allows retrying failed purchases
-- (mirrors the Mongo partialFilterExpression: { status: 'completed' } index).
create unique index pay_per_job_purchases_student_job_completed_uq
  on pay_per_job_purchases (student_id, job_posting_id)
  where status = 'completed';

create index pay_per_job_purchases_student_id_idx on pay_per_job_purchases (student_id);
create index pay_per_job_purchases_job_posting_id_idx on pay_per_job_purchases (job_posting_id);
create index pay_per_job_purchases_status_idx on pay_per_job_purchases (status);
create index pay_per_job_purchases_razorpay_order_id_idx on pay_per_job_purchases (razorpay_order_id);

alter table pay_per_job_purchases enable row level security;
