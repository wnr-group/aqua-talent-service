const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const User = require('../models/User');
const Company = require('../models/Company');
const Student = require('../models/Student');
const { companyRegistrationSchema } = require('../utils/validation');
const { studentRegistrationSchema } = require('../utils/validation');



exports.login = async (req, res) => {
  try {
    const { username, password, userType } = req.body;

    // validation
    if (!username || !password || !userType) {
      return res.status(400).json({
        error: 'Username, password, and userType are required'
      });
    }

    if (username.length < 3 || username.length > 30) {
      return res.status(400).json({
        error: 'Username must be 3-30 characters'
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        error: 'Password must be at least 8 characters'
      });
    }

    if (!['admin', 'company', 'student'].includes(userType)) {
      return res.status(400).json({
        error: 'userType must be admin, company, or student'
      });
    }

    // find user
    const user = await User.findOne({
      username: username.toLowerCase(),
      userType
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

   

    // password check
    const isMatch = await bcrypt.compare(password, user.passwordHash);
    
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    let company = null;
    let student = null;

    if (userType === 'company') {
      company = await Company.findOne({ userId: user._id });

      if (company.status === 'pending') {
        return res.status(403).json({
          error: 'Your company account is pending approval'
        });
      }

      if (company.status === 'rejected') {
        return res.status(403).json({
          error: `Your company registration was rejected. Reason: ${company.rejectionReason}`
        });
      }
    }

    if (userType === 'student') {
      student = await Student.findOne({ userId: user._id });
    }

    const payload = {
      userId: user._id.toString(),
      userType: user.userType
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: '24h'
    });

   res.json({
  token,
  user: {
    id: user._id.toString(),
    username: user.username,
    userType: user.userType,

    company: company ? {
      id: company._id.toString(),
      name: company.name,
      email: company.email,
      status: company.status,
      createdAt: company.createdAt,
      approvedAt: company.approvedAt
    } : null,

    student: student ? {
      id: student._id.toString(),
      fullName: student.fullName,
      email: student.email,
      profileLink: student.profileLink,
      isHired: student.isHired,
      currentSubscriptionId: student.currentSubscriptionId,
      subscriptionTier: student.subscriptionTier,
      createdAt: student.createdAt
    } : null
  }
});

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.logout = async (req, res) => {
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
};

exports.getMe = async (req, res) => {
  try {
   
    const { userId } = req.user;

    const user = await User.findById(userId);

    if (!user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    let company = null;
    let student = null;

    if (user.userType === 'company') {
      company = await Company.findOne({ userId: user._id });
    }

    if (user.userType === 'student') {
      student = await Student.findOne({ userId: user._id });
    }

    res.json({
     id: user._id.toString(),
     username: user.username,
     userType: user.userType,

     company: company ? {
        id: company._id.toString(),
         name: company.name,
         email: company.email,
         status: company.status,
         createdAt: company.createdAt,
         approvedAt: company.approvedAt
       } : null,

       student: student ? {
         id: student._id.toString(),
         fullName: student.fullName,
         email: student.email,
         profileLink: student.profileLink,
         isHired: student.isHired,
         currentSubscriptionId: student.currentSubscriptionId,
         subscriptionTier: student.subscriptionTier,
         createdAt: student.createdAt
  } : null
});

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.registerCompany = async (req, res) => {
  try {
    const parsed = companyRegistrationSchema.parse(req.body);

    const { companyName, username, email, password } = parsed;

    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await User.create({
      username,
      passwordHash,
      userType: 'company'
    });

    await Company.create({
      userId: user._id,  
      name: companyName,
      email,
      status: 'pending'
    });

    res.status(201).json({
      success: true,
      message:
        'Registration submitted for approval. You will be able to login once an administrator approves your account.'
    });

  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: error.errors[0].message });
    }

    console.error(error);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
};


exports.registerStudent = async (req, res) => {
  try {
    const parsed = studentRegistrationSchema.parse(req.body);

    const { fullName, username, email, password, profileLink } = parsed;

    const existingUser = await User.findOne({ username });

    if (existingUser) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

 

    try {
      const user = await User.create({
        username,
        passwordHash,
        userType: 'student'
      });

      await Student.create({
        userId: user._id,
        fullName,
        email,
        profileLink: profileLink || null,
        isHired: false
      });

     

      res.status(201).json({ success: true });

    } catch (error) {
    
      throw error;
    } finally {
      
    }

  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: error.errors.message });
    }
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
};