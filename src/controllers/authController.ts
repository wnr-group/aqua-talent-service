import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import crypto from 'crypto';

import { getSupabaseClient } from '../lib/supabase/client';

const {
  companyRegisterSchema,
  studentRegistrationSchema,
  forgotPasswordSchema,
  verifyResetTokenSchema,
  resetPasswordSchema
} = require('../utils/validation');
const { sendPasswordResetEmail } = require('../services/emailService');
const notificationService = require('../services/notificationService');

const supabase = getSupabaseClient();

const trimTrailingSlash = (value = ''): string => value.replace(/\/$/, '');
const getFrontendBaseUrl = (): string => {
  const configuredBase = process.env.FRONTEND_URL || process.env.FRONTEND_BASE_URL || process.env.APP_BASE_URL || 'http://localhost:3000';
  return trimTrailingSlash(String(configuredBase).trim());
};

// Helper to check if email is already taken across all user types
const isEmailTaken = async (email: string): Promise<boolean> => {
  const normalizedEmail = email.toLowerCase().trim();

  const [{ data: student }, { data: company }] = await Promise.all([
    supabase.from('students').select('id').eq('email', normalizedEmail).maybeSingle(),
    supabase.from('companies').select('id').eq('email', normalizedEmail).maybeSingle()
  ]);

  const isAdminEmail = process.env.ADMIN_EMAIL?.toLowerCase() === normalizedEmail;

  return Boolean(student) || Boolean(company) || isAdminEmail;
};

// Helper to find user by email across all user types
// Returns { user, userType, profileRecord } or null
const findUserByEmail = async (email: string) => {
  const normalizedEmail = email.toLowerCase().trim();

  // Check Student first
  const { data: student } = await supabase.from('students').select('*').eq('email', normalizedEmail).maybeSingle();
  if (student) {
    const { data: user } = await supabase.from('users').select('*').eq('id', student.user_id).maybeSingle();
    if (user) {
      return { user, userType: 'student' as const, profileRecord: student };
    }
  }

  // Check Company
  const { data: company } = await supabase.from('companies').select('*').eq('email', normalizedEmail).maybeSingle();
  if (company) {
    const { data: user } = await supabase.from('users').select('*').eq('id', company.user_id).maybeSingle();
    if (user) {
      return { user, userType: 'company' as const, profileRecord: company };
    }
  }

  // Check Admin (email stored in env, user in database)
  if (process.env.ADMIN_EMAIL?.toLowerCase() === normalizedEmail) {
    const { data: adminUser } = await supabase.from('users').select('*').eq('user_type', 'admin').maybeSingle();
    if (adminUser) {
      return { user: adminUser, userType: 'admin' as const, profileRecord: null };
    }
  }

  return null;
};

exports.login = async (req: Request, res: Response) => {
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
    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('username', username.toLowerCase())
      .eq('user_type', userType)
      .maybeSingle();

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // password check
    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been suspended. Please contact support@aquatalentz.com.'
      });
    }

    let company: any = null;
    let student: any = null;

    if (userType === 'company') {
      const { data } = await supabase.from('companies').select('*').eq('user_id', user.id).maybeSingle();
      company = data;

      if (company.status === 'pending') {
        return res.status(403).json({
          error: 'Your company account is pending approval'
        });
      }

      if (company.status === 'rejected') {
        return res.status(403).json({
          error: `Your company registration was rejected. Reason: ${company.rejection_reason}`
        });
      }
    }

    if (userType === 'student') {
      const { data } = await supabase.from('students').select('*').eq('user_id', user.id).maybeSingle();
      student = data;
    }

    const payload = {
      userId: user.id,
      userType: user.user_type
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET as string, {
      expiresIn: '24h'
    });

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        userType: user.user_type,

        company: company ? {
          id: company.id,
          name: company.name,
          email: company.email,
          status: company.status,
          createdAt: company.created_at,
          approvedAt: company.approved_at
        } : null,

        student: student ? {
          id: student.id,
          fullName: student.full_name,
          email: student.email,
          isDGShipping: student.is_dg_shipping,
          profileLink: student.profile_link,
          isHired: student.is_hired,
          currentSubscriptionId: student.current_subscription_id,
          subscriptionTier: student.subscription_tier,
          createdAt: student.created_at
        } : null
      }
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.logout = async (_req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
};

exports.getMe = async (req: Request & { user?: { userId: string; userType: string } }, res: Response) => {
  try {
    const { userId } = req.user!;

    const { data: user } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();

    if (!user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    let company: any = null;
    let student: any = null;

    if (user.user_type === 'company') {
      const { data } = await supabase.from('companies').select('*').eq('user_id', user.id).maybeSingle();
      company = data;
    }

    if (user.user_type === 'student') {
      const { data } = await supabase.from('students').select('*').eq('user_id', user.id).maybeSingle();
      student = data;
    }

    res.json({
      id: user.id,
      username: user.username,
      userType: user.user_type,

      company: company ? {
        id: company.id,
        name: company.name,
        email: company.email,
        status: company.status,
        createdAt: company.created_at,
        approvedAt: company.approved_at
      } : null,

      student: student ? {
        id: student.id,
        fullName: student.full_name,
        email: student.email,
        isDGShipping: student.is_dg_shipping,
        profileLink: student.profile_link,
        isHired: student.is_hired,
        currentSubscriptionId: student.current_subscription_id,
        subscriptionTier: student.subscription_tier,
        createdAt: student.created_at
      } : null
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.registerCompany = async (req: Request, res: Response) => {
  try {
    const parsed = companyRegisterSchema.parse(req.body);

    const { companyName, username, email, password } = parsed;

    const { data: existingUser } = await supabase.from('users').select('id').eq('username', username).maybeSingle();
    if (existingUser) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    // Check email uniqueness across all user types
    const emailTaken = await isEmailTaken(email);
    if (emailTaken) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const { data: user, error: userError } = await supabase
      .from('users')
      .insert({ username, password_hash: passwordHash, user_type: 'company' })
      .select()
      .single();
    if (userError || !user) {
      throw userError || new Error('Failed to create user');
    }

    const { data: company, error: companyError } = await supabase
      .from('companies')
      .insert({ user_id: user.id, name: companyName, email, status: 'pending' })
      .select()
      .single();
    if (companyError || !company) {
      throw companyError || new Error('Failed to create company');
    }

    res.status(201).json({
      success: true,
      message:
        'Registration submitted for approval. You will be able to login once an administrator approves your account.'
    });

    if (company.status === 'pending') {
      notificationService
        .notifyAdminsNewCompanyPending({ companyId: company.id, companyName: company.name })
        .catch((error: unknown) => {
          console.error('Admin notification error (new company pending):', error);
        });
    }

  } catch (error: any) {
    console.log('Register company error:', error);

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

exports.registerStudent = async (req: Request, res: Response) => {
  try {
    const parsed = studentRegistrationSchema.parse(req.body);

    const { fullName, username, email, password, profileLink, isDGShipping, studentId } = parsed;

    const { data: existingUser } = await supabase.from('users').select('id').eq('username', username).maybeSingle();

    if (existingUser) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    // Check email uniqueness across all user types
    const emailTaken = await isEmailTaken(email);
    if (emailTaken) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const { data: user, error: userError } = await supabase
      .from('users')
      .insert({ username, password_hash: passwordHash, user_type: 'student' })
      .select()
      .single();
    if (userError || !user) {
      throw userError || new Error('Failed to create user');
    }

    // Get or create the free plan
    const freePlan = await getOrCreateFreePlan();

    // Create student first (without subscription)
    const { data: student, error: studentError } = await supabase
      .from('students')
      .insert({
        user_id: user.id,
        student_id: studentId,
        full_name: fullName,
        email,
        is_dg_shipping: isDGShipping || 'no',
        profile_link: profileLink || null,
        is_hired: false,
        subscription_tier: 'free'
      })
      .select()
      .single();
    if (studentError || !student) {
      throw studentError || new Error('Failed to create student');
    }

    // Create free subscription with student ID
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
    if (subError || !freeSubscription) {
      throw subError || new Error('Failed to create free subscription');
    }

    // Update student with subscription ID
    const { error: linkSubscriptionError } = await supabase.from('students').update({ current_subscription_id: freeSubscription.id }).eq('id', student.id);
    if (linkSubscriptionError) throw linkSubscriptionError;

    res.status(201).json({ success: true });

  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: error.issues?.[0]?.message || 'Invalid input' });
    }
    console.error('Student registration error:', error);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
};

// Mirrors AvailableService.getFreePlan() from the old Mongoose model -
// find-or-create the Free Tier plan, healing any drifted defaults.
const FREE_TIER_PLAN_NAME = 'Free Tier';
const FREE_TIER_MAX_APPLICATIONS = 2;

const getOrCreateFreePlan = async () => {
  const { data: existing } = await supabase
    .from('available_services')
    .select('*')
    .eq('tier', 'free')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  const defaults = {
    name: FREE_TIER_PLAN_NAME,
    tier: 'free',
    description: 'Basic access to job listings and limited applications',
    max_applications: FREE_TIER_MAX_APPLICATIONS,
    price: 0,
    price_inr: 0,
    price_usd: 0,
    currency: 'USD',
    billing_cycle: 'one-time',
    features: ['Basic job search', 'Limited applications', 'Profile creation'],
    is_active: true,
    all_zones_included: true,
    display_order: 0
  };

  if (!existing) {
    const { data: created, error } = await supabase.from('available_services').insert(defaults).select().single();
    if (error || !created) {
      throw error || new Error('Failed to create free plan');
    }
    return created;
  }

  const updates: Record<string, any> = {};
  if (existing.max_applications !== FREE_TIER_MAX_APPLICATIONS) updates.max_applications = FREE_TIER_MAX_APPLICATIONS;
  if (existing.price !== 0) updates.price = 0;
  if (existing.billing_cycle !== 'one-time') updates.billing_cycle = 'one-time';
  if (!existing.name || !existing.name.trim()) updates.name = defaults.name;
  if (!existing.description || !existing.description.trim()) updates.description = defaults.description;
  if (!Array.isArray(existing.features) || existing.features.length === 0) updates.features = defaults.features;
  if (!existing.is_active) updates.is_active = true;
  if (!existing.all_zones_included) updates.all_zones_included = true;

  if (Object.keys(updates).length === 0) {
    return existing;
  }

  const { data: updated, error: updateError } = await supabase
    .from('available_services')
    .update(updates as any)
    .eq('id', existing.id)
    .select()
    .single();
  if (updateError || !updated) {
    throw updateError || new Error('Failed to heal free plan');
  }
  return updated;
};

exports.forgotPassword = async (req: Request, res: Response) => {
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

    const { user, userType, profileRecord } = userInfo as any;

    // Generate secure token
    const token = crypto.randomBytes(32).toString('hex');

    // Calculate expiration (1 hour from now)
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    // Store token
    const { error: tokenInsertError } = await supabase.from('password_reset_tokens').insert({
      token,
      user_id: user.id,
      user_type: userType,
      email: email.toLowerCase().trim(),
      expires_at: expiresAt.toISOString()
    });
    if (tokenInsertError) throw tokenInsertError;

    // Build reset URL
    const frontendUrl = getFrontendBaseUrl();
    const resetUrl = `${frontendUrl}/reset-password?token=${token}`;

    // Get user's display name
    const recipientName = profileRecord?.full_name || profileRecord?.name || 'User';

    // Send email (don't await - fire and forget for faster response)
    sendPasswordResetEmail(email, { resetUrl, recipientName })
      .catch((err: unknown) => console.error('Failed to send password reset email:', err));

    res.json(genericResponse);

  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: error.issues?.[0]?.message || 'Invalid email address' });
    }
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Helper to mask email for security (user@example.com -> u***@example.com)
const maskEmail = (email: string): string => {
  if (!email || !email.includes('@')) return email;
  const [localPart, domain] = email.split('@');
  if (localPart.length <= 1) return `${localPart}***@${domain}`;
  return `${localPart[0]}***@${domain}`;
};

exports.verifyResetToken = async (req: Request, res: Response) => {
  try {
    // Validate input
    const parsed = verifyResetTokenSchema.parse(req.body);
    const { token } = parsed;

    // Find valid token (not used, not expired)
    const { data: resetToken } = await supabase
      .from('password_reset_tokens')
      .select('*')
      .eq('token', token)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

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

  } catch (error: any) {
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

exports.resetPassword = async (req: Request, res: Response) => {
  try {
    // Validate input
    const parsed = resetPasswordSchema.parse(req.body);
    const { token, password } = parsed;

    // Find valid token (not used, not expired)
    const { data: resetToken } = await supabase
      .from('password_reset_tokens')
      .select('*')
      .eq('token', token)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (!resetToken) {
      return res.status(400).json({
        error: 'Invalid or expired token'
      });
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(password, 10);

    // Update user's password
    const { error: passwordUpdateError } = await supabase.from('users').update({ password_hash: passwordHash }).eq('id', resetToken.user_id);
    if (passwordUpdateError) throw passwordUpdateError;

    // Mark token as used
    const { error: tokenUpdateError } = await supabase.from('password_reset_tokens').update({ used_at: new Date().toISOString() }).eq('id', resetToken.id);
    if (tokenUpdateError) throw tokenUpdateError;

    res.json({
      success: true,
      message: 'Password has been reset successfully. You can now log in with your new password.'
    });

  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({
        error: error.issues?.[0]?.message || 'Invalid input'
      });
    }
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};
