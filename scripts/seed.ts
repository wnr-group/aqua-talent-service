/**
 * DESTRUCTIVE: wipes core app data and reseeds a small demo dataset
 * (admin, 3 companies, 1 student, subscription plans, 22 jobs).
 * Run with: npx tsc && node scripts/seed.js
 */
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

if (process.env.NODE_ENV === 'production') {
  console.error('Seed script cannot be executed in production environment.');
  process.exit(1);
}

import bcrypt from 'bcrypt';
import { getSupabaseClient } from '../src/lib/supabase/client';

const supabase = getSupabaseClient();

const seedDatabase = async () => {
  try {
    // Clear old data first, in FK-safe order (Postgres enforces referential
    // integrity that Mongo never did).
    await supabase.from('applications').delete().not('id', 'is', null);
    await supabase.from('job_postings').delete().not('id', 'is', null);
    await supabase.from('students').update({ current_subscription_id: null }).not('current_subscription_id', 'is', null);
    await supabase.from('active_subscriptions').delete().not('id', 'is', null);
    await supabase.from('students').delete().not('id', 'is', null);
    await supabase.from('companies').delete().not('id', 'is', null);
    await supabase.from('users').delete().not('id', 'is', null);
    await supabase.from('available_services').delete().not('id', 'is', null);
    await supabase.from('system_config').delete().not('id', 'is', null);

    console.log('Cleared existing data...');

    // System config for free tier
    await supabase.from('system_config').insert([
      { key: 'free_tier_max_applications', value: 2, description: 'Maximum applications for free tier' },
      {
        key: 'free_tier_features',
        value: ['Basic job search', '2 applications lifetime', 'Profile creation'],
        description: 'Features for free tier'
      }
    ]);

    console.log('Created system config...');

    // Subscription plans (INR pricing)
    const { data: freePlan, error: freePlanError } = await supabase
      .from('available_services')
      .insert({
        name: 'Free Tier',
        tier: 'free',
        description: 'Basic access to job listings and limited applications',
        max_applications: 2,
        price: 0,
        price_inr: 0,
        price_usd: 0,
        currency: 'INR',
        billing_cycle: 'one-time',
        features: ['Basic job search', '2 applications lifetime', 'Profile creation'],
        display_order: 0,
        is_active: true
      })
      .select()
      .single();
    if (freePlanError) throw freePlanError;

    await supabase.from('available_services').insert([
      {
        name: 'Pro',
        tier: 'paid',
        description: 'Unlimited applications and premium features for serious job seekers',
        max_applications: null,
        price: 499,
        price_inr: 499,
        price_usd: 0,
        currency: 'INR',
        billing_cycle: 'one-time',
        features: ['Unlimited applications', 'Priority support', 'Profile boost in search', 'Application highlighting', 'Resume downloads', 'Video profile views'],
        badge: 'Popular',
        display_order: 1,
        priority_support: true,
        profile_boost: true,
        application_highlight: true,
        is_active: true
      },
      {
        name: 'Pro Yearly',
        tier: 'paid',
        description: 'All Pro features with 2 months free when you pay yearly',
        max_applications: null,
        price: 4999,
        price_inr: 4999,
        price_usd: 0,
        currency: 'INR',
        billing_cycle: 'one-time',
        discount: 17,
        features: [
          'Unlimited applications',
          'Priority support',
          'Profile boost in search',
          'Application highlighting',
          'Resume downloads',
          'Video profile views',
          '2 months free'
        ],
        badge: 'Best Value',
        display_order: 2,
        priority_support: true,
        profile_boost: true,
        application_highlight: true,
        is_active: true
      },
      {
        name: 'Lifetime',
        tier: 'paid',
        description: 'One-time payment for lifetime access to all premium features',
        max_applications: null,
        price: 9999,
        price_inr: 9999,
        price_usd: 0,
        currency: 'INR',
        billing_cycle: 'one-time',
        features: [
          'Unlimited applications forever',
          'Priority support',
          'Profile boost in search',
          'Application highlighting',
          'Resume downloads',
          'Video profile views',
          'All future features included'
        ],
        badge: 'Lifetime',
        display_order: 3,
        priority_support: true,
        profile_boost: true,
        application_highlight: true,
        is_active: true
      }
    ]);

    console.log('Created subscription plans...');

    // Admin user
    const passwordHash = await bcrypt.hash('password123', 10);

    await supabase.from('users').insert({ username: 'admin', password_hash: passwordHash, user_type: 'admin' });

    // Company users - Indian companies
    const companySeeds = [
      { username: 'infosys', name: 'Infosys Technologies', email: 'careers@infosys.com' },
      { username: 'tcs', name: 'Tata Consultancy Services', email: 'recruitment@tcs.com' },
      { username: 'wipro', name: 'Wipro Limited', email: 'jobs@wipro.com' }
    ];

    const companies: Record<string, any> = {};

    for (const c of companySeeds) {
      const { data: user, error: userError } = await supabase
        .from('users')
        .insert({ username: c.username, password_hash: passwordHash, user_type: 'company' })
        .select()
        .single();
      if (userError) throw userError;

      const { data: company, error: companyError } = await supabase
        .from('companies')
        .insert({
          user_id: user.id,
          name: c.name,
          email: c.email,
          status: 'approved',
          industry: 'Technology',
          size: '1000+',
          approved_at: new Date().toISOString()
        })
        .select()
        .single();
      if (companyError) throw companyError;

      companies[c.username] = company;
    }

    // Student user with free subscription - Indian name
    const { data: studentUser, error: studentUserError } = await supabase
      .from('users')
      .insert({ username: 'rahul', password_hash: passwordHash, user_type: 'student' })
      .select()
      .single();
    if (studentUserError) throw studentUserError;

    const { data: student, error: studentError } = await supabase
      .from('students')
      .insert({
        user_id: studentUser.id,
        student_id: 'STU001',
        full_name: 'Rahul Sharma',
        email: 'rahul.sharma@gmail.com',
        profile_link: 'https://linkedin.com/in/rahulsharma',
        subscription_tier: 'free'
      })
      .select()
      .single();
    if (studentError) throw studentError;

    const { data: freeSubscription, error: subError } = await supabase
      .from('active_subscriptions')
      .insert({
        student_id: student.id,
        service_id: freePlan.id,
        start_date: new Date().toISOString(),
        end_date: new Date('2099-12-31').toISOString(),
        status: 'active',
        auto_renew: false,
        applications_used: 0
      })
      .select()
      .single();
    if (subError) throw subError;

    await supabase.from('students').update({ current_subscription_id: freeSubscription.id }).eq('id', student.id);

    console.log('Created users...');

    // Jobs - Indian locations and INR salaries
    const now = new Date().toISOString();
    const jobs = [
      { companyId: companies.infosys.id, title: 'Senior Software Engineer', description: 'We are looking for a senior software engineer to join our team. You will be responsible for designing and implementing scalable backend systems using modern technologies.', requirements: '5+ years of experience in software development, proficiency in Java and Python', location: 'Bangalore', jobType: 'Full-time', salaryRange: '₹18,00,000 - ₹28,00,000', status: 'approved' },
      { companyId: companies.infosys.id, title: 'Frontend Developer', description: 'Join our frontend team to build beautiful and responsive user interfaces. You will work closely with designers and backend developers to deliver exceptional user experiences.', requirements: '3+ years experience with React, TypeScript, and modern CSS', location: 'Hyderabad', jobType: 'Full-time', salaryRange: '₹12,00,000 - ₹18,00,000', status: 'approved' },
      { companyId: companies.infosys.id, title: 'DevOps Engineer', description: 'We need a DevOps engineer to help us build and maintain our cloud infrastructure. Experience with AWS, Docker, and Kubernetes is essential.', requirements: 'Experience with CI/CD pipelines, cloud platforms, and containerization', location: 'Pune', jobType: 'Full-time', salaryRange: '₹15,00,000 - ₹22,00,000', status: 'approved' },
      { companyId: companies.tcs.id, title: 'Product Designer', description: 'We are seeking a talented product designer to create intuitive and visually appealing designs for our mobile and web applications.', requirements: 'Strong portfolio, proficiency in Figma, experience with design systems', location: 'Mumbai', jobType: 'Full-time', salaryRange: '₹10,00,000 - ₹16,00,000', status: 'approved' },
      { companyId: companies.tcs.id, title: 'Data Analyst Intern', description: 'Great opportunity for students to gain hands-on experience in data analysis. You will work with real datasets and help derive insights for business decisions.', requirements: 'Currently pursuing a degree in Statistics, Mathematics, or related field', location: 'Chennai', jobType: 'Internship', salaryRange: '₹25,000 - ₹35,000/month', status: 'approved' },
      { companyId: companies.tcs.id, title: 'Marketing Coordinator', description: 'Help us grow our brand presence through digital marketing campaigns. You will manage social media, create content, and analyze campaign performance.', requirements: 'Experience with social media marketing, content creation, and analytics tools', location: 'Delhi NCR', jobType: 'Part-time', salaryRange: '₹4,00,000 - ₹6,00,000', status: 'approved' },
      { companyId: companies.wipro.id, title: 'Backend Developer', description: 'Build robust and scalable APIs for our enterprise clients. You will work with microservices architecture and handle high-traffic systems.', requirements: '3+ years experience with Java or Node.js, knowledge of databases and caching', location: 'Bangalore', jobType: 'Full-time', salaryRange: '₹10,00,000 - ₹15,00,000', status: 'approved' },
      { companyId: companies.wipro.id, title: 'QA Engineer', description: 'Ensure the quality of our software products through comprehensive testing strategies. You will design test plans, automate tests, and work with development teams.', requirements: 'Experience with automated testing frameworks, attention to detail', location: 'Kolkata', jobType: 'Full-time', salaryRange: '₹8,00,000 - ₹12,00,000', status: 'approved' },
      { companyId: companies.infosys.id, title: 'Mobile Developer', description: 'Develop cross-platform mobile applications using React Native. You will be responsible for the entire mobile development lifecycle.', requirements: 'Experience with React Native, iOS and Android development', location: 'Hyderabad', jobType: 'Full-time', salaryRange: '₹14,00,000 - ₹20,00,000', status: 'approved' },
      { companyId: companies.tcs.id, title: 'Technical Writer', description: 'Create clear and comprehensive documentation for our products and APIs. You will work with engineering teams to understand complex systems.', requirements: 'Excellent writing skills, ability to explain technical concepts clearly', location: 'Remote', jobType: 'Contract', salaryRange: '₹6,00,000 - ₹9,00,000', status: 'approved' },
      { companyId: companies.wipro.id, title: 'Project Manager', description: 'Lead software development projects from inception to delivery. You will coordinate with stakeholders, manage timelines, and ensure project success.', requirements: 'PMP certification preferred, experience with Agile methodologies', location: 'Noida', jobType: 'Full-time', salaryRange: '₹12,00,000 - ₹18,00,000', status: 'approved' },
      { companyId: companies.infosys.id, title: 'Security Engineer', description: 'Protect our systems and data from security threats. You will conduct security assessments, implement security measures, and respond to incidents.', requirements: 'Experience with security tools, knowledge of OWASP, security certifications', location: 'Bangalore', jobType: 'Full-time', salaryRange: '₹20,00,000 - ₹30,00,000', status: 'approved' },
      { companyId: companies.tcs.id, title: 'UI/UX Design Intern', description: 'Learn and grow as a designer while working on real projects. Great opportunity to build your portfolio and gain industry experience.', requirements: 'Design portfolio, basic knowledge of design tools', location: 'Mumbai', jobType: 'Internship', salaryRange: '₹20,000 - ₹30,000/month', status: 'approved' },
      { companyId: companies.wipro.id, title: 'Database Administrator', description: 'Manage and optimize our database systems for performance and reliability. You will handle backups, migrations, and troubleshooting.', requirements: 'Experience with PostgreSQL, MySQL, database optimization', location: 'Remote', jobType: 'Full-time', salaryRange: '₹12,00,000 - ₹18,00,000', status: 'approved' },
      { companyId: companies.infosys.id, title: 'Machine Learning Engineer', description: 'Build and deploy machine learning models to solve business problems. You will work with large datasets and cutting-edge ML technologies.', requirements: 'Strong Python skills, experience with TensorFlow or PyTorch, statistics background', location: 'Bangalore', jobType: 'Full-time', salaryRange: '₹22,00,000 - ₹35,00,000', status: 'approved' },
      { companyId: companies.tcs.id, title: 'Customer Support Specialist', description: 'Provide excellent support to our customers through various channels. You will resolve issues, gather feedback, and improve customer satisfaction.', requirements: 'Strong communication skills, patience, problem-solving abilities', location: 'Gurgaon', jobType: 'Part-time', salaryRange: '₹3,00,000 - ₹5,00,000', status: 'pending' },
      { companyId: companies.wipro.id, title: 'Business Analyst', description: 'Bridge the gap between business needs and technical solutions. You will gather requirements, analyze processes, and propose improvements.', requirements: 'Analytical skills, experience with business process modeling', location: 'Pune', jobType: 'Full-time', salaryRange: '₹9,00,000 - ₹14,00,000', status: 'pending' },
      { companyId: companies.infosys.id, title: 'Cloud Architect', description: 'Design and implement cloud solutions for our enterprise applications. You will work with multi-cloud environments and ensure scalability.', requirements: 'AWS/GCP/Azure certifications, experience with cloud architecture patterns', location: 'Hyderabad', jobType: 'Full-time', salaryRange: '₹25,00,000 - ₹40,00,000', status: 'approved' },
      { companyId: companies.tcs.id, title: 'Content Creator', description: 'Create engaging content for our blog, social media, and marketing campaigns. You will help tell our brand story and connect with our audience.', requirements: 'Creative writing skills, social media savvy, video editing is a plus', location: 'Remote', jobType: 'Freelance', salaryRange: '₹5,00,000 - ₹8,00,000', status: 'approved' },
      { companyId: companies.wipro.id, title: 'Systems Administrator', description: 'Maintain and support our IT infrastructure including servers, networks, and security systems. You will ensure system uptime and performance.', requirements: 'Linux administration, networking knowledge, scripting skills', location: 'Chennai', jobType: 'Full-time', salaryRange: '₹7,00,000 - ₹11,00,000', status: 'approved' },
      { companyId: companies.infosys.id, title: 'AI Research Intern', description: null, requirements: null, location: null, jobType: null, salaryRange: null, status: 'draft' },
      { companyId: companies.wipro.id, title: 'Full Stack Developer', description: 'Develop end-to-end web applications using modern JavaScript frameworks. You will work on both frontend and backend components of our platform.', requirements: 'Experience with React, Node.js, and relational databases', location: 'Remote', jobType: 'Full-time', salaryRange: '₹14,00,000 - ₹22,00,000', status: 'unpublished' }
    ];

    const jobRows = jobs.map((j) => ({
      company_id: j.companyId,
      title: j.title,
      description: j.description,
      requirements: j.requirements,
      location: j.location,
      job_type: j.jobType,
      salary_range: j.salaryRange,
      status: j.status,
      approved_at: j.status === 'approved' ? now : null
    }));

    const { error: jobsError } = await supabase.from('job_postings').insert(jobRows);
    if (jobsError) throw jobsError;
    console.log(`Created ${jobRows.length} job postings!`);

    console.log('\n✅ Database seeded successfully!\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Test accounts:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Admin:    admin / password123');
    console.log('Company:  infosys / password123');
    console.log('Company:  tcs / password123');
    console.log('Company:  wipro / password123');
    console.log('Student:  rahul / password123 (Free plan)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    process.exit(0);
  } catch (error) {
    console.error('Seed error:', error);
    process.exit(1);
  }
};

seedDatabase();
