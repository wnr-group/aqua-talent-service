-- job_postings  (<- Mongoose model: JobPosting)
create table job_postings (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  company_id uuid not null references companies (id),
  title text check (title is null or char_length(title) <= 100),
  description text check (description is null or char_length(description) <= 5000),
  requirements text check (requirements is null or char_length(requirements) <= 2000),
  location text check (location is null or char_length(location) <= 100),
  country_id uuid references zone_countries (id),
  job_type text check (
    job_type is null or job_type in ('Full-time', 'Part-time', 'Contract', 'Internship', 'Freelance', 'Project')
  ),
  salary_range text check (salary_range is null or char_length(salary_range) <= 50),
  deadline timestamptz,
  status text not null default 'pending' check (status in ('draft', 'pending', 'approved', 'rejected', 'unpublished', 'closed')),
  rejection_reason text,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  search_vector tsvector generated always as (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, ''))
  ) stored
);

create index job_postings_company_id_idx on job_postings (company_id);
create index job_postings_status_idx on job_postings (status);
create index job_postings_created_at_idx on job_postings (created_at desc);
create index job_postings_country_id_idx on job_postings (country_id);
create index job_postings_search_vector_idx on job_postings using gin (search_vector);

alter table job_postings enable row level security;

-- Attach the FK deferred from the subscriptions/payments migration now that
-- job_postings exists.
alter table pay_per_job_purchases
  add constraint pay_per_job_purchases_job_posting_id_fkey
  foreign key (job_posting_id) references job_postings (id);

-- applications  (<- Mongoose model: Application)
create table applications (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  student_id uuid not null references students (id),
  job_posting_id uuid not null references job_postings (id),
  status text not null default 'pending' check (
    status in ('pending', 'reviewed', 'interview_scheduled', 'offer_extended', 'hired', 'rejected', 'withdrawn')
  ),
  rejection_reason text,
  rejection_source text check (rejection_source is null or rejection_source in ('admin', 'company')),
  interview_date timestamptz,
  interview_notes text check (interview_notes is null or char_length(interview_notes) <= 2000),
  offer_details text check (offer_details is null or char_length(offer_details) <= 2000),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  -- Compound unique index - prevents duplicate applications
  unique (student_id, job_posting_id)
);

create index applications_student_id_idx on applications (student_id);
create index applications_job_posting_id_idx on applications (job_posting_id);
create index applications_status_idx on applications (status);
create index applications_created_at_idx on applications (created_at desc);

alter table applications enable row level security;
