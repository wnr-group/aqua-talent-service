-- ============================================================================
-- Supabase seed data for aqua-talent-service.
--
-- This is the single source of demo/seed data for the project - the old
-- ad-hoc Node scripts (seed.ts, seed-pricing-and-zones.ts, seed-zones.ts,
-- reset.ts) have been removed in favor of this one file, the standard
-- Supabase CLI convention (runs after supabase/migrations/ on
-- `supabase db reset` locally, or via `npm run seed` /
-- `supabase db query --linked -f supabase/seed.sql` /
-- `psql "$DATABASE_URL" -f supabase/seed.sql` against a remote project).
--
-- Idempotent: every insert uses a fixed literal id (or, for
-- available_services, its unique name) and `on conflict ... do nothing`, so
-- re-running this file is a no-op once the rows already exist.
-- Passwords are hashed with pgcrypto's crypt()/gen_salt('bf') - this is real
-- bcrypt (blowfish), so bcrypt.compare() in the Node app verifies it exactly
-- like a hash produced by the bcrypt npm package.
--
-- WARNING: every seeded account below (including the admin user) shares the
-- password "password123". This is demo/dev fixture data only - never run
-- `npm run seed` / this file against a production-linked Supabase project.
--
-- All seeded accounts use the password: password123
-- ============================================================================

-- ── Zones ────────────────────────────────────────────────────────────────
insert into zones (id, name, description) values
  ('00000000-0000-4000-a000-000000000001', 'Zone 1', 'Premium Markets / Corporate Hubs'),
  ('00000000-0000-4000-a000-000000000002', 'Zone 2', 'Growing Markets'),
  ('00000000-0000-4000-a000-000000000003', 'Zone 3', 'Emerging Markets'),
  ('00000000-0000-4000-a000-000000000004', 'Zone 4', 'Niche / Optional Markets')
on conflict (id) do nothing;

insert into zone_countries (id, zone_id, country_name) values
  ('00000000-0000-4000-a001-000000000001', '00000000-0000-4000-a000-000000000001', 'USA'),
  ('00000000-0000-4000-a001-000000000002', '00000000-0000-4000-a000-000000000001', 'UK'),
  ('00000000-0000-4000-a001-000000000003', '00000000-0000-4000-a000-000000000001', 'Germany'),
  ('00000000-0000-4000-a001-000000000004', '00000000-0000-4000-a000-000000000001', 'Singapore'),
  ('00000000-0000-4000-a001-000000000005', '00000000-0000-4000-a000-000000000001', 'UAE'),
  ('00000000-0000-4000-a001-000000000006', '00000000-0000-4000-a000-000000000002', 'Canada'),
  ('00000000-0000-4000-a001-000000000007', '00000000-0000-4000-a000-000000000002', 'Japan'),
  ('00000000-0000-4000-a001-000000000008', '00000000-0000-4000-a000-000000000002', 'South Korea'),
  ('00000000-0000-4000-a001-000000000009', '00000000-0000-4000-a000-000000000003', 'India'),
  ('00000000-0000-4000-a001-000000000010', '00000000-0000-4000-a000-000000000003', 'Brazil'),
  ('00000000-0000-4000-a001-000000000011', '00000000-0000-4000-a000-000000000003', 'Mexico'),
  ('00000000-0000-4000-a001-000000000012', '00000000-0000-4000-a000-000000000003', 'Vietnam'),
  ('00000000-0000-4000-a001-000000000013', '00000000-0000-4000-a000-000000000003', 'Indonesia'),
  ('00000000-0000-4000-a001-000000000014', '00000000-0000-4000-a000-000000000004', 'Norway'),
  ('00000000-0000-4000-a001-000000000015', '00000000-0000-4000-a000-000000000004', 'Denmark'),
  ('00000000-0000-4000-a001-000000000016', '00000000-0000-4000-a000-000000000004', 'Panama')
on conflict (id) do nothing;

-- ── Subscription plans ──────────────────────────────────────────────────
insert into available_services (
  id, name, tier, description, max_applications, price, price_inr, price_usd,
  currency, billing_cycle, features, badge, display_order,
  priority_support, profile_boost, application_highlight, is_active, all_zones_included
) values
  (
    '00000000-0000-4000-a002-000000000001', 'Free Tier', 'free',
    'Basic access to job listings with limited applications', 2, 0, 0, 0,
    'INR', 'one-time',
    array['Basic job search', '2 applications lifetime', 'Profile creation', 'Access to all zones (view only)'],
    null, 0, false, false, false, true, true
  ),
  (
    '00000000-0000-4000-a002-000000000002', 'Starter', 'paid',
    'Perfect for students just starting their job search with access to 2 zones', 5, 599, 599, 17,
    'INR', 'one-time',
    array['5 job applications', 'Access to 2 zones', 'Basic job search', 'Profile creation'],
    null, 1, false, false, false, true, false
  ),
  (
    '00000000-0000-4000-a002-000000000003', 'Pro', 'paid',
    'Most popular choice for serious job seekers with access to 3 zones', 15, 1699, 1699, 32,
    'INR', 'one-time',
    array['10-15 job applications', 'Access to 3 zones', 'Priority support', 'Profile boost in search', 'Application highlighting'],
    'Most Popular', 2, true, true, true, true, false
  ),
  (
    '00000000-0000-4000-a002-000000000004', 'Premium', 'paid',
    'Unlimited access to all zones and unlimited job applications', null, 3250, 3250, 55,
    'INR', 'one-time',
    array['Unlimited job applications', 'Access to all zones', 'Priority support', 'Profile boost in search', 'Application highlighting', 'Resume downloads', 'Video profile views'],
    'Best Value', 3, true, true, true, true, true
  )
on conflict (name) do nothing;

-- available_services is keyed by name (on conflict (name) do nothing above),
-- so if a plan with one of these names already existed under a different id
-- (e.g. re-seeded after a manual admin-UI edit), the fixed literal
-- '00000000-0000-4000-a002-...' ids used elsewhere would NOT be the plan's
-- actual id. Resolve plan_id by name via a join instead of assuming it.
insert into plan_zones (plan_id, zone_id)
select s.id, z.zone_id
from (
  values
    ('Free Tier', '00000000-0000-4000-a000-000000000001'::uuid),
    ('Free Tier', '00000000-0000-4000-a000-000000000002'::uuid),
    ('Free Tier', '00000000-0000-4000-a000-000000000003'::uuid),
    ('Free Tier', '00000000-0000-4000-a000-000000000004'::uuid),
    ('Starter', '00000000-0000-4000-a000-000000000001'::uuid),
    ('Starter', '00000000-0000-4000-a000-000000000002'::uuid),
    ('Pro', '00000000-0000-4000-a000-000000000001'::uuid),
    ('Pro', '00000000-0000-4000-a000-000000000002'::uuid),
    ('Pro', '00000000-0000-4000-a000-000000000003'::uuid),
    ('Premium', '00000000-0000-4000-a000-000000000001'::uuid),
    ('Premium', '00000000-0000-4000-a000-000000000002'::uuid),
    ('Premium', '00000000-0000-4000-a000-000000000003'::uuid),
    ('Premium', '00000000-0000-4000-a000-000000000004'::uuid)
) as z(plan_name, zone_id)
join available_services s on s.name = z.plan_name
on conflict (plan_id, zone_id) do nothing;

-- ── Add-ons ─────────────────────────────────────────────────────────────
insert into addons (id, name, type, price_inr, price_usd, zone_count, job_credit_count, unlock_all_zones) values
  ('00000000-0000-4000-a003-000000000001', 'Single Extra Zone', 'zone', 199, 3, 1, null, false),
  ('00000000-0000-4000-a003-000000000002', '2-Zone Bundle', 'zone', 349, 5, 2, null, false),
  ('00000000-0000-4000-a003-000000000003', 'All Remaining Zones', 'zone', 699, 10, null, null, true),
  ('00000000-0000-4000-a003-000000000004', 'Extra Job Credits (3 Jobs)', 'jobs', 99, 1, null, 3, false),
  ('00000000-0000-4000-a003-000000000005', 'Extra Job Credits (5 Jobs)', 'jobs', 149, 2, null, 5, false),
  ('00000000-0000-4000-a003-000000000006', 'Pay Per Job', 'pay-per-job', 2500, 35, null, null, false)
on conflict (id) do nothing;

-- ── System config ───────────────────────────────────────────────────────
insert into system_config (key, value, description) values
  ('free_tier_max_applications', '2'::jsonb, 'Maximum applications for free tier'),
  ('free_tier_features', '["Basic job search", "2 applications lifetime", "Profile creation"]'::jsonb, 'Features for free tier')
on conflict (key) do nothing;

-- ── Users (password for every seeded account: password123) ────────────────
insert into users (id, username, password_hash, user_type, is_active) values
  ('00000000-0000-4000-a004-000000000001', 'admin', crypt('password123', gen_salt('bf')), 'admin', true),
  ('00000000-0000-4000-a004-000000000002', 'infosys', crypt('password123', gen_salt('bf')), 'company', true),
  ('00000000-0000-4000-a004-000000000003', 'tcs', crypt('password123', gen_salt('bf')), 'company', true),
  ('00000000-0000-4000-a004-000000000004', 'wipro', crypt('password123', gen_salt('bf')), 'company', true),
  ('00000000-0000-4000-a004-000000000005', 'rahul', crypt('password123', gen_salt('bf')), 'student', true)
on conflict (id) do nothing;

-- ── Companies ───────────────────────────────────────────────────────────
insert into companies (id, user_id, name, email, status, industry, size, approved_at) values
  ('00000000-0000-4000-a005-000000000001', '00000000-0000-4000-a004-000000000002', 'Infosys Technologies', 'careers@infosys.com', 'approved', 'Technology', '1000+', now()),
  ('00000000-0000-4000-a005-000000000002', '00000000-0000-4000-a004-000000000003', 'Tata Consultancy Services', 'recruitment@tcs.com', 'approved', 'Technology', '1000+', now()),
  ('00000000-0000-4000-a005-000000000003', '00000000-0000-4000-a004-000000000004', 'Wipro Limited', 'jobs@wipro.com', 'approved', 'Technology', '1000+', now())
on conflict (id) do nothing;

-- ── Student + free subscription ────────────────────────────────────────
insert into students (id, user_id, student_id, full_name, email, profile_link, subscription_tier) values
  ('00000000-0000-4000-a006-000000000001', '00000000-0000-4000-a004-000000000005', 'STU001', 'Rahul Sharma', 'rahul.sharma@gmail.com', 'https://linkedin.com/in/rahulsharma', 'free')
on conflict (id) do nothing;

-- Resolve the Free Tier plan's actual id by name, same reason as plan_zones above.
insert into active_subscriptions (id, student_id, service_id, start_date, end_date, status, auto_renew, applications_used)
select '00000000-0000-4000-a007-000000000001', '00000000-0000-4000-a006-000000000001', s.id, now(), '2099-12-31T00:00:00Z', 'active', false, 0
from available_services s
where s.name = 'Free Tier'
on conflict (id) do nothing;

update students
  set current_subscription_id = '00000000-0000-4000-a007-000000000001'
  where id = '00000000-0000-4000-a006-000000000001'
    and current_subscription_id is distinct from '00000000-0000-4000-a007-000000000001';

insert into subscription_zones (subscription_id, zone_id, source) values
  ('00000000-0000-4000-a007-000000000001', '00000000-0000-4000-a000-000000000001', 'plan'),
  ('00000000-0000-4000-a007-000000000001', '00000000-0000-4000-a000-000000000002', 'plan'),
  ('00000000-0000-4000-a007-000000000001', '00000000-0000-4000-a000-000000000003', 'plan'),
  ('00000000-0000-4000-a007-000000000001', '00000000-0000-4000-a000-000000000004', 'plan')
on conflict (subscription_id, zone_id) do nothing;

-- ── Job postings ────────────────────────────────────────────────────────
-- country_id is set on a handful of jobs (one per zone) to demonstrate the
-- zone-lock feature; the rest are left unrestricted (null), matching most
-- of the original random-assignment script's practical effect.
insert into job_postings (id, company_id, title, description, requirements, location, job_type, salary_range, status, approved_at, country_id) values
  ('00000000-0000-4000-a008-000000000001', '00000000-0000-4000-a005-000000000001', 'Senior Software Engineer', 'We are looking for a senior software engineer to join our team. You will be responsible for designing and implementing scalable backend systems using modern technologies.', '5+ years of experience in software development, proficiency in Java and Python', 'Bangalore', 'Full-time', '₹18,00,000 - ₹28,00,000', 'approved', now(), '00000000-0000-4000-a001-000000000001'),
  ('00000000-0000-4000-a008-000000000002', '00000000-0000-4000-a005-000000000001', 'Frontend Developer', 'Join our frontend team to build beautiful and responsive user interfaces. You will work closely with designers and backend developers to deliver exceptional user experiences.', '3+ years experience with React, TypeScript, and modern CSS', 'Hyderabad', 'Full-time', '₹12,00,000 - ₹18,00,000', 'approved', now(), null),
  ('00000000-0000-4000-a008-000000000003', '00000000-0000-4000-a005-000000000001', 'DevOps Engineer', 'We need a DevOps engineer to help us build and maintain our cloud infrastructure. Experience with AWS, Docker, and Kubernetes is essential.', 'Experience with CI/CD pipelines, cloud platforms, and containerization', 'Pune', 'Full-time', '₹15,00,000 - ₹22,00,000', 'approved', now(), '00000000-0000-4000-a001-000000000009'),
  ('00000000-0000-4000-a008-000000000004', '00000000-0000-4000-a005-000000000002', 'Product Designer', 'We are seeking a talented product designer to create intuitive and visually appealing designs for our mobile and web applications.', 'Strong portfolio, proficiency in Figma, experience with design systems', 'Mumbai', 'Full-time', '₹10,00,000 - ₹16,00,000', 'approved', now(), '00000000-0000-4000-a001-000000000001'),
  ('00000000-0000-4000-a008-000000000005', '00000000-0000-4000-a005-000000000002', 'Data Analyst Intern', 'Great opportunity for students to gain hands-on experience in data analysis. You will work with real datasets and help derive insights for business decisions.', 'Currently pursuing a degree in Statistics, Mathematics, or related field', 'Chennai', 'Internship', '₹25,000 - ₹35,000/month', 'approved', now(), null),
  ('00000000-0000-4000-a008-000000000006', '00000000-0000-4000-a005-000000000002', 'Marketing Coordinator', 'Help us grow our brand presence through digital marketing campaigns. You will manage social media, create content, and analyze campaign performance.', 'Experience with social media marketing, content creation, and analytics tools', 'Delhi NCR', 'Part-time', '₹4,00,000 - ₹6,00,000', 'approved', now(), null),
  ('00000000-0000-4000-a008-000000000007', '00000000-0000-4000-a005-000000000003', 'Backend Developer', 'Build robust and scalable APIs for our enterprise clients. You will work with microservices architecture and handle high-traffic systems.', '3+ years experience with Java or Node.js, knowledge of databases and caching', 'Bangalore', 'Full-time', '₹10,00,000 - ₹15,00,000', 'approved', now(), '00000000-0000-4000-a001-000000000006'),
  ('00000000-0000-4000-a008-000000000008', '00000000-0000-4000-a005-000000000003', 'QA Engineer', 'Ensure the quality of our software products through comprehensive testing strategies. You will design test plans, automate tests, and work with development teams.', 'Experience with automated testing frameworks, attention to detail', 'Kolkata', 'Full-time', '₹8,00,000 - ₹12,00,000', 'approved', now(), null),
  ('00000000-0000-4000-a008-000000000009', '00000000-0000-4000-a005-000000000001', 'Mobile Developer', 'Develop cross-platform mobile applications using React Native. You will be responsible for the entire mobile development lifecycle.', 'Experience with React Native, iOS and Android development', 'Hyderabad', 'Full-time', '₹14,00,000 - ₹20,00,000', 'approved', now(), null),
  ('00000000-0000-4000-a008-000000000010', '00000000-0000-4000-a005-000000000002', 'Technical Writer', 'Create clear and comprehensive documentation for our products and APIs. You will work with engineering teams to understand complex systems.', 'Excellent writing skills, ability to explain technical concepts clearly', 'Remote', 'Contract', '₹6,00,000 - ₹9,00,000', 'approved', now(), null),
  ('00000000-0000-4000-a008-000000000011', '00000000-0000-4000-a005-000000000003', 'Project Manager', 'Lead software development projects from inception to delivery. You will coordinate with stakeholders, manage timelines, and ensure project success.', 'PMP certification preferred, experience with Agile methodologies', 'Noida', 'Full-time', '₹12,00,000 - ₹18,00,000', 'approved', now(), '00000000-0000-4000-a001-000000000009'),
  ('00000000-0000-4000-a008-000000000012', '00000000-0000-4000-a005-000000000001', 'Security Engineer', 'Protect our systems and data from security threats. You will conduct security assessments, implement security measures, and respond to incidents.', 'Experience with security tools, knowledge of OWASP, security certifications', 'Bangalore', 'Full-time', '₹20,00,000 - ₹30,00,000', 'approved', now(), null),
  ('00000000-0000-4000-a008-000000000013', '00000000-0000-4000-a005-000000000002', 'UI/UX Design Intern', 'Learn and grow as a designer while working on real projects. Great opportunity to build your portfolio and gain industry experience.', 'Design portfolio, basic knowledge of design tools', 'Mumbai', 'Internship', '₹20,000 - ₹30,000/month', 'approved', now(), null),
  ('00000000-0000-4000-a008-000000000014', '00000000-0000-4000-a005-000000000003', 'Database Administrator', 'Manage and optimize our database systems for performance and reliability. You will handle backups, migrations, and troubleshooting.', 'Experience with PostgreSQL, MySQL, database optimization', 'Remote', 'Full-time', '₹12,00,000 - ₹18,00,000', 'approved', now(), null),
  ('00000000-0000-4000-a008-000000000015', '00000000-0000-4000-a005-000000000001', 'Machine Learning Engineer', 'Build and deploy machine learning models to solve business problems. You will work with large datasets and cutting-edge ML technologies.', 'Strong Python skills, experience with TensorFlow or PyTorch, statistics background', 'Bangalore', 'Full-time', '₹22,00,000 - ₹35,00,000', 'approved', now(), null),
  ('00000000-0000-4000-a008-000000000016', '00000000-0000-4000-a005-000000000002', 'Customer Support Specialist', 'Provide excellent support to our customers through various channels. You will resolve issues, gather feedback, and improve customer satisfaction.', 'Strong communication skills, patience, problem-solving abilities', 'Gurgaon', 'Part-time', '₹3,00,000 - ₹5,00,000', 'pending', null, null),
  ('00000000-0000-4000-a008-000000000017', '00000000-0000-4000-a005-000000000003', 'Business Analyst', 'Bridge the gap between business needs and technical solutions. You will gather requirements, analyze processes, and propose improvements.', 'Analytical skills, experience with business process modeling', 'Pune', 'Full-time', '₹9,00,000 - ₹14,00,000', 'pending', null, null),
  ('00000000-0000-4000-a008-000000000018', '00000000-0000-4000-a005-000000000001', 'Cloud Architect', 'Design and implement cloud solutions for our enterprise applications. You will work with multi-cloud environments and ensure scalability.', 'AWS/GCP/Azure certifications, experience with cloud architecture patterns', 'Hyderabad', 'Full-time', '₹25,00,000 - ₹40,00,000', 'approved', now(), '00000000-0000-4000-a001-000000000014'),
  ('00000000-0000-4000-a008-000000000019', '00000000-0000-4000-a005-000000000002', 'Content Creator', 'Create engaging content for our blog, social media, and marketing campaigns. You will help tell our brand story and connect with our audience.', 'Creative writing skills, social media savvy, video editing is a plus', 'Remote', 'Freelance', '₹5,00,000 - ₹8,00,000', 'approved', now(), null),
  ('00000000-0000-4000-a008-000000000020', '00000000-0000-4000-a005-000000000003', 'Systems Administrator', 'Maintain and support our IT infrastructure including servers, networks, and security systems. You will ensure system uptime and performance.', 'Linux administration, networking knowledge, scripting skills', 'Chennai', 'Full-time', '₹7,00,000 - ₹11,00,000', 'approved', now(), null),
  ('00000000-0000-4000-a008-000000000021', '00000000-0000-4000-a005-000000000001', 'AI Research Intern', null, null, null, null, null, 'draft', null, null),
  ('00000000-0000-4000-a008-000000000022', '00000000-0000-4000-a005-000000000003', 'Full Stack Developer', 'Develop end-to-end web applications using modern JavaScript frameworks. You will work on both frontend and backend components of our platform.', 'Experience with React, Node.js, and relational databases', 'Remote', 'Full-time', '₹14,00,000 - ₹22,00,000', 'unpublished', null, null)
on conflict (id) do nothing;

-- ============================================================================
-- Seeded accounts (password: password123 for all):
--   Admin:    admin
--   Company:  infosys / tcs / wipro
--   Student:  rahul (Free plan, all 4 zones, 2/2 applications remaining)
-- ============================================================================
