const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const User = require('../models/User');
const Company = require('../models/Company');
const Student = require('../models/Student');
const AvailableService = require('../models/AvailableService');
const ActiveSubscription = require('../models/ActiveSubscription');
const PasswordResetToken = require('../models/PasswordResetToken');
const {
  companyRegistrationSchema,
  studentRegistrationSchema,
  forgotPasswordSchema,
  verifyResetTokenSchema,
  resetPasswordSchema
} = require('../utils/validation');
const { sendPasswordResetEmail } = require('../services/emailService');

// Helper to check if email is already taken across all user types
const isEmailTaken = async (email) => {
  const normalizedEmail = email.toLowerCase().trim();

  const [studentExists, companyExists] = await Promise.all([
    Student.exists({ email: normalizedEmail }),
    Company.exists({ email: normalizedEmail })
  ]);

  const isAdminEmail = process.env.ADMIN_EMAIL?.toLowerCase() === normalizedEmail;

  return studentExists || companyExists || isAdminEmail;
};

// Helper to find user by email across all user types
// Returns { user, userType, profileRecord } or null
const findUserByEmail = async (email) => {
  const normalizedEmail = email.toLowerCase().trim();

  // Check Student first
  const student = await Student.findOne({ email: normalizedEmail }).populate('userId');
  if (student && student.userId) {
    return {
      user: student.userId,
      userType: 'student',
      profileRecord: student
    };
  }

  // Check Company
  const company = await Company.findOne({ email: normalizedEmail }).populate('userId');
  if (company && company.userId) {
    return {
      user: company.userId,
      userType: 'company',
      profileRecord: company
    };
  }

  // Check Admin (email stored in env, user in database)
  if (process.env.ADMIN_EMAIL?.toLowerCase() === normalizedEmail) {
    const adminUser = await User.findOne({ userType: 'admin' });
    if (adminUser) {
      return {
        user: adminUser,
        userType: 'admin',
        profileRecord: null
      };
    }
  }

  return null;
};

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

    // Check email uniqueness across all user types
    const emailTaken = await isEmailTaken(email);
    if (emailTaken) {
      return res.status(409).json({ error: 'Email already registered' });
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
  console.log("Register company error:", error);

  if (error.name === 'ZodError') {
    return res.status(400).json({
      error: error.issues?.[0]?.message || 'Invalid input'
    });
  }

  return res.status(500).json({
    error: 'Registration failed. Please try again.'
  });
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

    // Check email uniqueness across all user types
    const emailTaken = await isEmailTaken(email);
    if (emailTaken) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

 

    const user = await User.create({
      username,
      passwordHash,
      userType: 'student'
    });

    // Get or create the free plan
    const freePlan = await AvailableService.getFreePlan();

    // Create student first (without subscription)
    const student = await Student.create({
      userId: user._id,
      fullName,
      email,
      profileLink: profileLink || null,
      isHired: false,
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

    res.status(201).json({ success: true });

  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: error.issues?.[0]?.message || 'Invalid input' });
    }
    console.error('Student registration error:', error);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
};

exports.forgotPassword = async (req, res) => {
  try {
    // Validate input
    const parsed = forgotPasswordSchema.parse(req.body);
    const { email } = parsed;

    // Generic success response (prevents email enumeration)
    const genericResponse = {
      success: true,
      message: 'If an account exists with this email, you will receive a password reset link shortly.'
    };

    // Find user by email
    const userInfo = await findUserByEmail(email);

    // If no user found, return generic success (don't reveal email existence)
    if (!userInfo) {
      return res.json(genericResponse);
    }

    const { user, userType, profileRecord } = userInfo;

    // Generate secure token
    const token = crypto.randomBytes(32).toString('hex');

    // Calculate expiration (1 hour from now)
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    // Store token
    await PasswordResetToken.create({
      token,
      userId: user._id,
      userType,
      email: email.toLowerCase().trim(),
      expiresAt
    });

    // Build reset URL
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const resetUrl = `${frontendUrl}/reset-password?token=${token}`;

    // Get user's display name
    const recipientName = profileRecord?.fullName || profileRecord?.name || 'User';

    // Send email (don't await - fire and forget for faster response)
    sendPasswordResetEmail(email, { resetUrl, recipientName })
      .catch(err => console.error('Failed to send password reset email:', err));

    res.json(genericResponse);

  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: error.issues?.[0]?.message || 'Invalid email address' });
    }
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Helper to mask email for security (user@example.com -> u***@example.com)
const maskEmail = (email) => {
  if (!email || !email.includes('@')) return email;
  const [localPart, domain] = email.split('@');
  if (localPart.length <= 1) return `${localPart}***@${domain}`;
  return `${localPart[0]}***@${domain}`;
};

exports.verifyResetToken = async (req, res) => {
  try {
    // Validate input
    const parsed = verifyResetTokenSchema.parse(req.body);
    const { token } = parsed;

    // Find valid token (not used, not expired)
    const resetToken = await PasswordResetToken.findOne({
      token,
      usedAt: null,
      expiresAt: { $gt: new Date() }
    });

    if (!resetToken) {
      return res.status(400).json({
        valid: false,
        error: 'Invalid or expired token'
      });
    }

    res.json({
      valid: true,
      email: maskEmail(resetToken.email)
    });

  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({
        valid: false,
        error: error.issues?.[0]?.message || 'Invalid token format'
      });
    }
    console.error('Verify reset token error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    // Validate input
    const parsed = resetPasswordSchema.parse(req.body);
    const { token, password } = parsed;

    // Find valid token (not used, not expired)
    const resetToken = await PasswordResetToken.findOne({
      token,
      usedAt: null,
      expiresAt: { $gt: new Date() }
    });

    if (!resetToken) {
      return res.status(400).json({
        error: 'Invalid or expired token'
      });
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(password, 10);

    // Update user's password
    await User.findByIdAndUpdate(resetToken.userId, {
      passwordHash
    });

    // Mark token as used
    resetToken.usedAt = new Date();
    await resetToken.save();

    res.json({
      success: true,
      message: 'Password has been reset successfully. You can now log in with your new password.'
    });

  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({
        error: error.issues?.[0]?.message || 'Invalid input'
      });
    }
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};