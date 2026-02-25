require('dotenv').config();

if (process.env.NODE_ENV === 'production') {
  console.error('❌ Seed script cannot be executed in production environment.');
  process.exit(1);
}

const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const connectDB = require('../src/db');

const User = require('../src/models/User');
const Company = require('../src/models/Company');
const Student = require('../src/models/Student');
const JobPosting = require('../src/models/JobPosting');
const Application = require('../src/models/Application');
const AvailableService = require('../src/models/AvailableService');
const ActiveSubscription = require('../src/models/ActiveSubscription');
const SystemConfig = require('../src/models/SystemConfig');

const seedDatabase = async () => {
  try {
    // Clear old data first
    await User.deleteMany({});
    await Company.deleteMany({});
    await Student.deleteMany({});
    await JobPosting.deleteMany({});
    await Application.deleteMany({});
    await AvailableService.deleteMany({});
    await ActiveSubscription.deleteMany({});
    await SystemConfig.deleteMany({});

    console.log('Cleared existing data...');

    // Create system config for free tier
    await SystemConfig.setValue('free_tier_max_applications', 2, 'Maximum applications for free tier');
    await SystemConfig.setValue('free_tier_features', [
      'Basic job search',
      '2 applications lifetime',
      'Profile creation'
    ], 'Features for free tier');

    console.log('Created system config...');

    // Create subscription plans (INR pricing)
    const freePlan = await AvailableService.create({
      name: 'Free',
      tier: 'free',
      description: 'Basic access to job listings and limited applications',
      maxApplications: null, // Uses SystemConfig value
      price: 0,
      currency: 'INR',
      billingCycle: 'monthly',
      features: [
        'Basic job search',
        '2 applications lifetime',
        'Profile creation'
      ],
      displayOrder: 0,
      isActive: true
    });

    const proPlan = await AvailableService.create({
      name: 'Pro',
      tier: 'paid',
      description: 'Unlimited applications and premium features for serious job seekers',
      maxApplications: null, // Unlimited
      price: 499,
      currency: 'INR',
      billingCycle: 'monthly',
      trialDays: 7,
      features: [
        'Unlimited applications',
        'Priority support',
        'Profile boost in search',
        'Application highlighting',
        'Resume downloads',
        'Video profile views'
      ],
      badge: 'Popular',
      displayOrder: 1,
      prioritySupport: true,
      profileBoost: true,
      applicationHighlight: true,
      isActive: true
    });

    const proYearlyPlan = await AvailableService.create({
      name: 'Pro Yearly',
      tier: 'paid',
      description: 'All Pro features with 2 months free when you pay yearly',
      maxApplications: null,
      price: 4999,
      currency: 'INR',
      billingCycle: 'yearly',
      discount: 17, // ~2 months free
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
      displayOrder: 2,
      prioritySupport: true,
      profileBoost: true,
      applicationHighlight: true,
      isActive: true
    });

    const lifetimePlan = await AvailableService.create({
      name: 'Lifetime',
      tier: 'paid',
      description: 'One-time payment for lifetime access to all premium features',
      maxApplications: null,
      price: 9999,
      currency: 'INR',
      billingCycle: 'one-time',
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
      displayOrder: 3,
      prioritySupport: true,
      profileBoost: true,
      applicationHighlight: true,
      isActive: true
    });

    console.log('Created subscription plans...');

    // Admin user
    const passwordHash = await bcrypt.hash('password123', 10);

    const adminUser = await User.create({
      username: 'admin',
      passwordHash,
      userType: 'admin'
    });

    // Company users - Indian companies
    const companyUser1 = await User.create({
      username: 'infosys',
      passwordHash,
      userType: 'company'
    });

    const company1 = await Company.create({
      userId: companyUser1._id,
      name: 'Infosys Technologies',
      email: 'careers@infosys.com',
      status: 'approved',
      industry: 'Technology',
      size: '1000+',
      approvedAt: new Date()
    });

    const companyUser2 = await User.create({
      username: 'tcs',
      passwordHash,
      userType: 'company'
    });

    const company2 = await Company.create({
      userId: companyUser2._id,
      name: 'Tata Consultancy Services',
      email: 'recruitment@tcs.com',
      status: 'approved',
      industry: 'Technology',
      size: '1000+',
      approvedAt: new Date()
    });

    const companyUser3 = await User.create({
      username: 'wipro',
      passwordHash,
      userType: 'company'
    });

    const company3 = await Company.create({
      userId: companyUser3._id,
      name: 'Wipro Limited',
      email: 'jobs@wipro.com',
      status: 'approved',
      industry: 'Technology',
      size: '1000+',
      approvedAt: new Date()
    });

    // Student user with free subscription - Indian name
    const studentUser = await User.create({
      username: 'rahul',
      passwordHash,
      userType: 'student'
    });

    // Create student first
    const student = await Student.create({
      userId: studentUser._id,
      fullName: 'Rahul Sharma',
      email: 'rahul.sharma@gmail.com',
      profileLink: 'https://linkedin.com/in/rahulsharma',
      subscriptionTier: 'free'
    });

    // Create free subscription with student ID
    const freeSubscription = await ActiveSubscription.create({
      studentId: student._id,
      serviceId: freePlan._id,
      startDate: new Date(),
      endDate: new Date('2099-12-31'),
      status: 'active',
      autoRenew: false
    });

    // Update student with subscription ID
    await Student.findByIdAndUpdate(student._id, {
      currentSubscriptionId: freeSubscription._id
    });

    console.log('Created users...');

    // Create jobs - Indian locations and INR salaries
    const jobs = [
      {
        companyId: company1._id,
        title: 'Senior Software Engineer',
        description: 'We are looking for a senior software engineer to join our team. You will be responsible for designing and implementing scalable backend systems using modern technologies.',
        requirements: '5+ years of experience in software development, proficiency in Java and Python',
        location: 'Bangalore',
        jobType: 'Full-time',
        salaryRange: '₹18,00,000 - ₹28,00,000',
        status: 'approved',
        approvedAt: new Date()
      },
      {
        companyId: company1._id,
        title: 'Frontend Developer',
        description: 'Join our frontend team to build beautiful and responsive user interfaces. You will work closely with designers and backend developers to deliver exceptional user experiences.',
        requirements: '3+ years experience with React, TypeScript, and modern CSS',
        location: 'Hyderabad',
        jobType: 'Full-time',
        salaryRange: '₹12,00,000 - ₹18,00,000',
        status: 'approved',
        approvedAt: new Date()
      },
      {
        companyId: company1._id,
        title: 'DevOps Engineer',
        description: 'We need a DevOps engineer to help us build and maintain our cloud infrastructure. Experience with AWS, Docker, and Kubernetes is essential.',
        requirements: 'Experience with CI/CD pipelines, cloud platforms, and containerization',
        location: 'Pune',
        jobType: 'Full-time',
        salaryRange: '₹15,00,000 - ₹22,00,000',
        status: 'approved',
        approvedAt: new Date()
      },
      {
        companyId: company2._id,
        title: 'Product Designer',
        description: 'We are seeking a talented product designer to create intuitive and visually appealing designs for our mobile and web applications.',
        requirements: 'Strong portfolio, proficiency in Figma, experience with design systems',
        location: 'Mumbai',
        jobType: 'Full-time',
        salaryRange: '₹10,00,000 - ₹16,00,000',
        status: 'approved',
        approvedAt: new Date()
      },
      {
        companyId: company2._id,
        title: 'Data Analyst Intern',
        description: 'Great opportunity for students to gain hands-on experience in data analysis. You will work with real datasets and help derive insights for business decisions.',
        requirements: 'Currently pursuing a degree in Statistics, Mathematics, or related field',
        location: 'Chennai',
        jobType: 'Internship',
        salaryRange: '₹25,000 - ₹35,000/month',
        status: 'approved',
        approvedAt: new Date()
      },
      {
        companyId: company2._id,
        title: 'Marketing Coordinator',
        description: 'Help us grow our brand presence through digital marketing campaigns. You will manage social media, create content, and analyze campaign performance.',
        requirements: 'Experience with social media marketing, content creation, and analytics tools',
        location: 'Delhi NCR',
        jobType: 'Part-time',
        salaryRange: '₹4,00,000 - ₹6,00,000',
        status: 'approved',
        approvedAt: new Date()
      },
      {
        companyId: company3._id,
        title: 'Backend Developer',
        description: 'Build robust and scalable APIs for our enterprise clients. You will work with microservices architecture and handle high-traffic systems.',
        requirements: '3+ years experience with Java or Node.js, knowledge of databases and caching',
        location: 'Bangalore',
        jobType: 'Full-time',
        salaryRange: '₹10,00,000 - ₹15,00,000',
        status: 'approved',
        approvedAt: new Date()
      },
      {
        companyId: company3._id,
        title: 'QA Engineer',
        description: 'Ensure the quality of our software products through comprehensive testing strategies. You will design test plans, automate tests, and work with development teams.',
        requirements: 'Experience with automated testing frameworks, attention to detail',
        location: 'Kolkata',
        jobType: 'Full-time',
        salaryRange: '₹8,00,000 - ₹12,00,000',
        status: 'approved',
        approvedAt: new Date()
      },
      {
        companyId: company1._id,
        title: 'Mobile Developer',
        description: 'Develop cross-platform mobile applications using React Native. You will be responsible for the entire mobile development lifecycle.',
        requirements: 'Experience with React Native, iOS and Android development',
        location: 'Hyderabad',
        jobType: 'Full-time',
        salaryRange: '₹14,00,000 - ₹20,00,000',
        status: 'approved',
        approvedAt: new Date()
      },
      {
        companyId: company2._id,
        title: 'Technical Writer',
        description: 'Create clear and comprehensive documentation for our products and APIs. You will work with engineering teams to understand complex systems.',
        requirements: 'Excellent writing skills, ability to explain technical concepts clearly',
        location: 'Remote',
        jobType: 'Contract',
        salaryRange: '₹6,00,000 - ₹9,00,000',
        status: 'approved',
        approvedAt: new Date()
      },
      {
        companyId: company3._id,
        title: 'Project Manager',
        description: 'Lead software development projects from inception to delivery. You will coordinate with stakeholders, manage timelines, and ensure project success.',
        requirements: 'PMP certification preferred, experience with Agile methodologies',
        location: 'Noida',
        jobType: 'Full-time',
        salaryRange: '₹12,00,000 - ₹18,00,000',
        status: 'approved',
        approvedAt: new Date()
      },
      {
        companyId: company1._id,
        title: 'Security Engineer',
        description: 'Protect our systems and data from security threats. You will conduct security assessments, implement security measures, and respond to incidents.',
        requirements: 'Experience with security tools, knowledge of OWASP, security certifications',
        location: 'Bangalore',
        jobType: 'Full-time',
        salaryRange: '₹20,00,000 - ₹30,00,000',
        status: 'approved',
        approvedAt: new Date()
      },
      {
        companyId: company2._id,
        title: 'UI/UX Design Intern',
        description: 'Learn and grow as a designer while working on real projects. Great opportunity to build your portfolio and gain industry experience.',
        requirements: 'Design portfolio, basic knowledge of design tools',
        location: 'Mumbai',
        jobType: 'Internship',
        salaryRange: '₹20,000 - ₹30,000/month',
        status: 'approved',
        approvedAt: new Date()
      },
      {
        companyId: company3._id,
        title: 'Database Administrator',
        description: 'Manage and optimize our database systems for performance and reliability. You will handle backups, migrations, and troubleshooting.',
        requirements: 'Experience with PostgreSQL, MySQL, MongoDB, database optimization',
        location: 'Remote',
        jobType: 'Full-time',
        salaryRange: '₹12,00,000 - ₹18,00,000',
        status: 'approved',
        approvedAt: new Date()
      },
      {
        companyId: company1._id,
        title: 'Machine Learning Engineer',
        description: 'Build and deploy machine learning models to solve business problems. You will work with large datasets and cutting-edge ML technologies.',
        requirements: 'Strong Python skills, experience with TensorFlow or PyTorch, statistics background',
        location: 'Bangalore',
        jobType: 'Full-time',
        salaryRange: '₹22,00,000 - ₹35,00,000',
        status: 'approved',
        approvedAt: new Date()
      },
      {
        companyId: company2._id,
        title: 'Customer Support Specialist',
        description: 'Provide excellent support to our customers through various channels. You will resolve issues, gather feedback, and improve customer satisfaction.',
        requirements: 'Strong communication skills, patience, problem-solving abilities',
        location: 'Gurgaon',
        jobType: 'Part-time',
        salaryRange: '₹3,00,000 - ₹5,00,000',
        status: 'pending'
      },
      {
        companyId: company3._id,
        title: 'Business Analyst',
        description: 'Bridge the gap between business needs and technical solutions. You will gather requirements, analyze processes, and propose improvements.',
        requirements: 'Analytical skills, experience with business process modeling',
        location: 'Pune',
        jobType: 'Full-time',
        salaryRange: '₹9,00,000 - ₹14,00,000',
        status: 'pending'
      },
      {
        companyId: company1._id,
        title: 'Cloud Architect',
        description: 'Design and implement cloud solutions for our enterprise applications. You will work with multi-cloud environments and ensure scalability.',
        requirements: 'AWS/GCP/Azure certifications, experience with cloud architecture patterns',
        location: 'Hyderabad',
        jobType: 'Full-time',
        salaryRange: '₹25,00,000 - ₹40,00,000',
        status: 'approved',
        approvedAt: new Date()
      },
      {
        companyId: company2._id,
        title: 'Content Creator',
        description: 'Create engaging content for our blog, social media, and marketing campaigns. You will help tell our brand story and connect with our audience.',
        requirements: 'Creative writing skills, social media savvy, video editing is a plus',
        location: 'Remote',
        jobType: 'Freelance',
        salaryRange: '₹5,00,000 - ₹8,00,000',
        status: 'approved',
        approvedAt: new Date()
      },
      {
        companyId: company3._id,
        title: 'Systems Administrator',
        description: 'Maintain and support our IT infrastructure including servers, networks, and security systems. You will ensure system uptime and performance.',
        requirements: 'Linux administration, networking knowledge, scripting skills',
        location: 'Chennai',
        jobType: 'Full-time',
        salaryRange: '₹7,00,000 - ₹11,00,000',
        status: 'approved',
        approvedAt: new Date()
      },
      {
        companyId: company1._id,
        title: 'AI Research Intern',
        description: null,
        requirements: null,
        location: null,
        jobType: null,
        salaryRange: null,
        status: 'draft'
      },
      {
        companyId: company3._id,
        title: 'Full Stack Developer',
        description: 'Develop end-to-end web applications using modern JavaScript frameworks. You will work on both frontend and backend components of our platform.',
        requirements: 'Experience with React, Node.js, and relational databases',
        location: 'Remote',
        jobType: 'Full-time',
        salaryRange: '₹14,00,000 - ₹22,00,000',
        status: 'unpublished'
      }
    ];

    await JobPosting.insertMany(jobs);
    console.log('Created 22 job postings!');

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
    console.log('\nSubscription Plans (INR):');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Free:         ₹0/month (2 applications)');
    console.log('Pro:          ₹499/month (Unlimited)');
    console.log('Pro Yearly:   ₹4,999/year (17% off)');
    console.log('Lifetime:     ₹9,999 one-time');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    process.exit();
  } catch (error) {
    console.error('Seed error:', error);
    process.exit(1);
  }
};

connectDB().then(seedDatabase);
