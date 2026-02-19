require('dotenv').config();

const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const connectDB = require('../src/db');

const User = require('../src/models/User');
const Company = require('../src/models/Company');
const Student = require('../src/models/Student');
const JobPosting = require('../src/models/JobPosting');
const Application = require('../src/models/Application');



//  DEFINE FUNCTION FIRST
const seedDatabase = async () => {
  try {

      //  Clear old data first
    await User.deleteMany({});
    await Company.deleteMany({});
    await Student.deleteMany({});
    await JobPosting.deleteMany({});
    await Application.deleteMany({});
    // Admin user

    const passwordHash = await bcrypt.hash('password123', 10);

    const adminUser = await User.create({
      username: 'admin',
      passwordHash,
      userType: 'admin'
    });

    // Company users
    const companyUser1 = await User.create({
      username: 'acme',
      passwordHash,
      userType: 'company'
    });

    const company1 = await Company.create({
      userId: companyUser1._id,
      name: 'Acme Corporation',
      email: 'hr@acme.com',
      status: 'approved',
      approvedAt: new Date()
    });

    const companyUser2 = await User.create({
      username: 'techstart',
      passwordHash,
      userType: 'company'
    });

    const company2 = await Company.create({
      userId: companyUser2._id,
      name: 'TechStart Inc',
      email: 'jobs@techstart.com',
      status: 'approved',
      approvedAt: new Date()
    });

    const companyUser3 = await User.create({
      username: 'globalsoft',
      passwordHash,
      userType: 'company'
    });

    const company3 = await Company.create({
      userId: companyUser3._id,
      name: 'GlobalSoft Solutions',
      email: 'careers@globalsoft.com',
      status: 'approved',
      approvedAt: new Date()
    });

    // Student user
    const studentUser = await User.create({
      username: 'john',
      passwordHash,
      userType: 'student'
    });

    await Student.create({
      userId: studentUser._id,
      fullName: 'John Doe',
      email: 'john@example.com',
      profileLink: 'https://linkedin.com/in/johndoe'
    });

    // Create 20 jobs
    const jobs = [
      {
        companyId: company1._id,
        title: 'Senior Software Engineer',
        description: 'We are looking for a senior software engineer to join our team. You will be responsible for designing and implementing scalable backend systems using modern technologies.',
        requirements: '5+ years of experience in software development, proficiency in Node.js and Python',
        location: 'Singapore',
        jobType: 'Full-time',
        salaryRange: '$8000-$12000',
        status: 'approved',
        approvedAt: new Date()
      },
      {
        companyId: company1._id,
        title: 'Frontend Developer',
        description: 'Join our frontend team to build beautiful and responsive user interfaces. You will work closely with designers and backend developers to deliver exceptional user experiences.',
        requirements: '3+ years experience with React, TypeScript, and modern CSS',
        location: 'Singapore',
        jobType: 'Full-time',
        salaryRange: '$5000-$7000',
        status: 'approved',
        approvedAt: new Date()
      },
      {
        companyId: company1._id,
        title: 'DevOps Engineer',
        description: 'We need a DevOps engineer to help us build and maintain our cloud infrastructure. Experience with AWS, Docker, and Kubernetes is essential.',
        requirements: 'Experience with CI/CD pipelines, cloud platforms, and containerization',
        location: 'Remote',
        jobType: 'Full-time',
        salaryRange: '$7000-$10000',
        status: 'approved',
        approvedAt: new Date()
      },
      {
        companyId: company2._id,
        title: 'Product Designer',
        description: 'We are seeking a talented product designer to create intuitive and visually appealing designs for our mobile and web applications.',
        requirements: 'Strong portfolio, proficiency in Figma, experience with design systems',
        location: 'Singapore',
        jobType: 'Full-time',
        salaryRange: '$5000-$8000',
        status: 'approved',
        approvedAt: new Date()
      },
      {
        companyId: company2._id,
        title: 'Data Analyst Intern',
        description: 'Great opportunity for students to gain hands-on experience in data analysis. You will work with real datasets and help derive insights for business decisions.',
        requirements: 'Currently pursuing a degree in Statistics, Mathematics, or related field',
        location: 'Singapore',
        jobType: 'Internship',
        salaryRange: '$1500-$2000',
        status: 'approved',
        approvedAt: new Date()
      },
      {
        companyId: company2._id,
        title: 'Marketing Coordinator',
        description: 'Help us grow our brand presence through digital marketing campaigns. You will manage social media, create content, and analyze campaign performance.',
        requirements: 'Experience with social media marketing, content creation, and analytics tools',
        location: 'Singapore',
        jobType: 'Part-time',
        salaryRange: '$2500-$3500',
        status: 'approved',
        approvedAt: new Date()
      },
      {
        companyId: company3._id,
        title: 'Backend Developer',
        description: 'Build robust and scalable APIs for our enterprise clients. You will work with microservices architecture and handle high-traffic systems.',
        requirements: '3+ years experience with Java or Go, knowledge of databases and caching',
        location: 'Kuala Lumpur',
        jobType: 'Full-time',
        salaryRange: '$4000-$6000',
        status: 'approved',
        approvedAt: new Date()
      },
      {
        companyId: company3._id,
        title: 'QA Engineer',
        description: 'Ensure the quality of our software products through comprehensive testing strategies. You will design test plans, automate tests, and work with development teams.',
        requirements: 'Experience with automated testing frameworks, attention to detail',
        location: 'Kuala Lumpur',
        jobType: 'Full-time',
        salaryRange: '$3500-$5000',
        status: 'approved',
        approvedAt: new Date()
      },
      {
        companyId: company1._id,
        title: 'Mobile Developer',
        description: 'Develop cross-platform mobile applications using React Native. You will be responsible for the entire mobile development lifecycle.',
        requirements: 'Experience with React Native, iOS and Android development',
        location: 'Singapore',
        jobType: 'Full-time',
        salaryRange: '$6000-$9000',
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
        salaryRange: '$4000-$5500',
        status: 'approved',
        approvedAt: new Date()
      },
      {
        companyId: company3._id,
        title: 'Project Manager',
        description: 'Lead software development projects from inception to delivery. You will coordinate with stakeholders, manage timelines, and ensure project success.',
        requirements: 'PMP certification preferred, experience with Agile methodologies',
        location: 'Jakarta',
        jobType: 'Full-time',
        salaryRange: '$5000-$7500',
        status: 'approved',
        approvedAt: new Date()
      },
      {
        companyId: company1._id,
        title: 'Security Engineer',
        description: 'Protect our systems and data from security threats. You will conduct security assessments, implement security measures, and respond to incidents.',
        requirements: 'Experience with security tools, knowledge of OWASP, security certifications',
        location: 'Singapore',
        jobType: 'Full-time',
        salaryRange: '$8000-$11000',
        status: 'approved',
        approvedAt: new Date()
      },
      {
        companyId: company2._id,
        title: 'UI/UX Design Intern',
        description: 'Learn and grow as a designer while working on real projects. Great opportunity to build your portfolio and gain industry experience.',
        requirements: 'Design portfolio, basic knowledge of design tools',
        location: 'Singapore',
        jobType: 'Internship',
        salaryRange: '$1200-$1800',
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
        salaryRange: '$5500-$7500',
        status: 'approved',
        approvedAt: new Date()
      },
      {
        companyId: company1._id,
        title: 'Machine Learning Engineer',
        description: 'Build and deploy machine learning models to solve business problems. You will work with large datasets and cutting-edge ML technologies.',
        requirements: 'Strong Python skills, experience with TensorFlow or PyTorch, statistics background',
        location: 'Singapore',
        jobType: 'Full-time',
        salaryRange: '$9000-$14000',
        status: 'approved',
        approvedAt: new Date()
      },
      {
        companyId: company2._id,
        title: 'Customer Support Specialist',
        description: 'Provide excellent support to our customers through various channels. You will resolve issues, gather feedback, and improve customer satisfaction.',
        requirements: 'Strong communication skills, patience, problem-solving abilities',
        location: 'Singapore',
        jobType: 'Part-time',
        salaryRange: '$2000-$3000',
        status: 'pending'
      },
      {
        companyId: company3._id,
        title: 'Business Analyst',
        description: 'Bridge the gap between business needs and technical solutions. You will gather requirements, analyze processes, and propose improvements.',
        requirements: 'Analytical skills, experience with business process modeling',
        location: 'Kuala Lumpur',
        jobType: 'Full-time',
        salaryRange: '$4500-$6500',
        status: 'pending'
      },
      {
        companyId: company1._id,
        title: 'Cloud Architect',
        description: 'Design and implement cloud solutions for our enterprise applications. You will work with multi-cloud environments and ensure scalability.',
        requirements: 'AWS/GCP/Azure certifications, experience with cloud architecture patterns',
        location: 'Singapore',
        jobType: 'Full-time',
        salaryRange: '$10000-$15000',
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
        salaryRange: '$3000-$4500',
        status: 'approved',
        approvedAt: new Date()
      },
      {
        companyId: company3._id,
        title: 'Systems Administrator',
        description: 'Maintain and support our IT infrastructure including servers, networks, and security systems. You will ensure system uptime and performance.',
        requirements: 'Linux administration, networking knowledge, scripting skills',
        location: 'Jakarta',
        jobType: 'Full-time',
        salaryRange: '$4000-$5500',
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
        salaryRange: '$6000-$9000',
        status: 'unpublished'
      }
    ];

    await JobPosting.insertMany(jobs);
    console.log('Created 22 job postings!');

    console.log('Database seeded!');
    console.log('\nTest accounts:');
    console.log('Admin: admin / password123');
    console.log('Company: acme / password123');
    console.log('Company: techstart / password123');
    console.log('Company: globalsoft / password123');
    console.log('Student: john / password123');
    process.exit();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
};


//  CALL FUNCTION AFTER DEFINITION
connectDB().then(seedDatabase);

