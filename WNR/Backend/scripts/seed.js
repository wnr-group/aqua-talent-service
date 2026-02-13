require('dotenv').config();

const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const connectDB = require('../src/db');

const User = require('../src/models/User');
const Company = require('../src/models/Company');
const Student = require('../src/models/Student');



//  DEFINE FUNCTION FIRST
const seedDatabase = async () => {
  try {

      //  Clear old data first
    await User.deleteMany({});
    await Company.deleteMany({});
    await Student.deleteMany({});
    // Admin user

    const passwordHash = await bcrypt.hash('password123', 10);

    const adminUser = await User.create({
      username: 'admin',
      passwordHash,
      userType: 'admin'
    });

    // Company user
    const companyUser = await User.create({
      username: 'acme',
      passwordHash,
      userType: 'company'
    });

    await Company.create({
      userId: companyUser._id,
      name: 'Acme Corporation',
      email: 'hr@acme.com',
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

    console.log('Database seeded!');
    process.exit();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
};


//  CALL FUNCTION AFTER DEFINITION
connectDB().then(seedDatabase);

