import { Request, Response } from 'express';

import { getSupabaseClient } from '../lib/supabase/client';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { STUDENT_APPLICATION_STATUS_MAP } = require('../constants');
import { getApplicationLimit } from '../services/subscriptionService';
import { getSubscriptionUsage, incrementApplicationCount, decrementApplicationCount } from '../services/applicationService';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { uploadStudentResume } = require('../services/mediaService');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const emailService = require('../services/emailService');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const notificationService = require('../services/notificationService');
import { canAccessJob, getUnlockOptions, getQuotaUnlockOptions, getAccessibleZones } from '../services/zoneAccessService';

type AuthedRequest = Request & { user?: { userId: string; userType: string } };

const supabase = getSupabaseClient();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isValidUuid = (value: any): boolean => typeof value === 'string' && UUID_RE.test(value);

const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (c) => `\\${c}`);

const getStudentForUser = async (userId: string) => {
  const { data: student } = await supabase.from('students').select('*').eq('user_id', userId).maybeSingle();
  return student;
};

// Check if email is taken by another user (excluding current student)
const isEmailTakenByOther = async (email: string, currentStudentId: string): Promise<boolean> => {
  const normalizedEmail = email.toLowerCase().trim();

  const { data: otherStudent } = await supabase
    .from('students')
    .select('id')
    .eq('email', normalizedEmail)
    .neq('id', currentStudentId)
    .maybeSingle();
  if (otherStudent) return true;

  const { data: company } = await supabase.from('companies').select('id').eq('email', normalizedEmail).maybeSingle();
  if (company) return true;

  if (process.env.ADMIN_EMAIL?.toLowerCase() === normalizedEmail) return true;

  return false;
};

const isValidEmail = (email: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const isValidUrl = (value: any): boolean => {
  if (typeof value !== 'string' || value.trim() === '') return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
};

const sanitizeString = (value: any, maxLength: number): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
};

const normalizeYear = (value: any): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const year = Number(value);
  const maxYear = new Date().getFullYear() + 6;
  if (!Number.isInteger(year) || year < 1900 || year > maxYear) return null;
  return year;
};

const normalizeDate = (value: any): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

const buildProfileResponse = (student: any) => ({
  fullName: student.full_name,
  email: student.email,
  isDGShipping: student.is_dg_shipping || 'no',
  profileLink: student.profile_link || '',
  bio: student.bio || '',
  location: student.location || '',
  availableFrom: student.available_from,
  skills: student.skills || [],
  education: student.education || [],
  experience: student.experience || [],
  resumeUrl: student.resume_url || null,
  introVideoUrl: student.intro_video_url || '',
  isHired: student.is_hired
});

const formatInterviewDateTime = (value: any): string | null => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const formatted = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC'
  }).format(date);
  return `${formatted} UTC`;
};

const getStudentFacingStatusPayload = (application: any) => {
  if (application.status === 'rejected') {
    if (application.rejection_source === 'company') {
      const basePayload = STUDENT_APPLICATION_STATUS_MAP.rejected_company;
      const normalizedReason = typeof application.rejection_reason === 'string' ? application.rejection_reason.trim() : '';
      if (!normalizedReason) return basePayload;
      return { ...basePayload, statusMessage: `${basePayload.statusMessage} Reason: ${normalizedReason}` };
    }
    return STUDENT_APPLICATION_STATUS_MAP.rejected_admin;
  }

  if (application.status === 'interview_scheduled') {
    const basePayload = STUDENT_APPLICATION_STATUS_MAP.interview_scheduled || {
      studentFacingStatus: 'Interview Scheduled',
      statusMessage: 'Great news! Check your email for interview details.'
    };
    const formattedInterviewDate = formatInterviewDateTime(application.interview_date);
    if (!formattedInterviewDate) return basePayload;
    return { ...basePayload, statusMessage: `${basePayload.statusMessage} Interview time: ${formattedInterviewDate}.` };
  }

  return (
    STUDENT_APPLICATION_STATUS_MAP[application.status] || {
      studentFacingStatus: 'Under Review',
      statusMessage: "Your application is under review. We'll notify you of any updates."
    }
  );
};

const buildCompleteness = (student: any) => {
  const sections = [
    { label: 'Bio', filled: Boolean(student.bio && student.bio.trim().length > 0) },
    { label: 'Location', filled: Boolean(student.location && student.location.trim().length > 0) },
    { label: 'Skills', filled: Array.isArray(student.skills) && student.skills.length > 0 },
    { label: 'Education', filled: Array.isArray(student.education) && student.education.length > 0 },
    { label: 'Experience', filled: Array.isArray(student.experience) && student.experience.length > 0 },
    { label: 'Resume', filled: Boolean(student.resume_url) },
    { label: 'Intro Video', filled: Boolean(student.intro_video_url) },
    { label: 'Available From', filled: Boolean(student.available_from) }
  ];

  const totalSections = 8;
  const completedSections = sections.filter((s) => s.filled).length;
  const percentage = Math.round((completedSections / totalSections) * 100);
  const missingItems = sections.filter((s) => !s.filled).map((s) => s.label);

  return { percentage, missingItems };
};

exports.getDashboard = async (req: AuthedRequest, res: Response) => {
  try {
    const student = await getStudentForUser(req.user!.userId);
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const { applicationsUsed } = await getSubscriptionUsage(student.id);

    const { count: pendingApplications } = await supabase
      .from('applications')
      .select('*', { count: 'exact', head: true })
      .eq('student_id', student.id)
      .eq('status', 'pending');

    const applicationLimit = await getApplicationLimit(student.id);
    const hasUnlimitedApplications = applicationLimit === Infinity;

    res.json({
      applicationsUsed,
      applicationLimit: hasUnlimitedApplications ? null : applicationLimit,
      hasUnlimitedApplications,
      subscriptionTier: student.subscription_tier,
      pendingApplications: pendingApplications ?? 0,
      isHired: student.is_hired
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getJobs = async (req: AuthedRequest, res: Response) => {
  try {
    const { search, location, jobType, page = 1, limit = 10 } = req.query as Record<string, any>;

    let query = supabase
      .from('job_postings')
      .select('id, title, description, requirements, location, job_type, salary_range, deadline, created_at, country_id, companies ( id, name, logo, industry, size, website ), zone_countries ( id, country_name, zone_id )', { count: 'exact' })
      .eq('status', 'approved');

    if (jobType) query = query.eq('job_type', jobType);
    if (location) query = query.ilike('location', `%${escapeLike(location)}%`);
    if (search) {
      const escaped = escapeLike(search);
      query = query.or(`title.ilike.%${escaped}%,description.ilike.%${escaped}%`);
    }

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));
    const from = (pageNum - 1) * limitNum;
    const to = from + limitNum - 1;

    const { data: jobs, count, error } = await query.order('created_at', { ascending: false }).range(from, to);
    if (error) throw error;

    const transformedJobs = (jobs || []).map((job: any) => ({
      id: job.id,
      title: job.title,
      description: job.description,
      requirements: job.requirements,
      location: job.location,
      jobType: job.job_type,
      salaryRange: job.salary_range,
      deadline: job.deadline,
      createdAt: job.created_at,
      countryId: job.zone_countries?.id || null,
      countryName: job.zone_countries?.country_name || null,
      zoneId: job.zone_countries?.zone_id || null,
      company: job.companies
        ? {
            id: job.companies.id,
            name: job.companies.name,
            logo: job.companies.logo,
            industry: job.companies.industry,
            size: job.companies.size,
            website: job.companies.website
          }
        : null
    }));

    let jobsWithZoneStatus = transformedJobs;

    if (req.user && req.user.userType === 'student') {
      try {
        const student = await getStudentForUser(req.user.userId);
        if (student) {
          const accessibleZones = await getAccessibleZones(student.id);

          const { data: purchases } = await supabase
            .from('pay_per_job_purchases')
            .select('job_posting_id')
            .eq('student_id', student.id)
            .eq('status', 'completed');
          const paidJobIdSet = new Set((purchases || []).map((p) => p.job_posting_id));

          const { data: applications } = await supabase.from('applications').select('job_posting_id, status').eq('student_id', student.id);
          const applicationMap = new Map((applications || []).map((a) => [a.job_posting_id, a.status]));

          const { data: allZones } = await supabase.from('zones').select('id, name');
          const zoneMap = new Map((allZones || []).map((z) => [z.id, z.name]));

          jobsWithZoneStatus = transformedJobs.map((job) => {
            const applicationStatus = applicationMap.get(job.id) || null;
            const hasApplied = applicationStatus !== null;

            if (hasApplied) {
              return { ...job, isZoneLocked: false, zoneLockReason: null, accessSource: 'applied', hasApplied: true, applicationStatus };
            }
            if (paidJobIdSet.has(job.id)) {
              return { ...job, isZoneLocked: false, zoneLockReason: null, accessSource: 'pay-per-job', hasApplied: false, applicationStatus: null };
            }
            if (!job.zoneId) {
              return { ...job, isZoneLocked: false, zoneLockReason: null, accessSource: 'no-zone-restriction', hasApplied: false, applicationStatus: null };
            }
            if (accessibleZones.allZones) {
              return { ...job, isZoneLocked: false, zoneLockReason: null, accessSource: 'all-zones', hasApplied: false, applicationStatus: null };
            }

            const hasAccess = accessibleZones.zoneIds.includes(job.zoneId);
            if (hasAccess) {
              return { ...job, isZoneLocked: false, zoneLockReason: null, accessSource: 'subscription', hasApplied: false, applicationStatus: null };
            }

            return {
              ...job,
              isZoneLocked: true,
              zoneLockReason: { zoneId: job.zoneId, zoneName: zoneMap.get(job.zoneId) || 'Unknown Zone' },
              accessSource: null,
              hasApplied: false,
              applicationStatus: null
            };
          });
        }
      } catch (zoneError) {
        console.error('Zone access check failed for job list:', zoneError);
      }
    }

    res.json({
      jobs: jobsWithZoneStatus,
      pagination: { page: pageNum, limit: limitNum, total: count ?? 0, totalPages: Math.ceil((count ?? 0) / limitNum) }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getJob = async (req: AuthedRequest, res: Response) => {
  try {
    const { jobId } = req.params as { jobId: string };
    if (!isValidUuid(jobId)) {
      return res.status(400).json({ error: 'Invalid job ID format' });
    }

    let hasApplied = false;
    let applicationStatus: string | null = null;
    let student: any = null;
    let isDescriptionLocked = false;
    let applicationsUsed = 0;
    let applicationLimit: number | null = null;

    if (req.user && req.user.userType === 'student') {
      student = await getStudentForUser(req.user.userId);
      if (student) {
        const [{ data: application }, totalApplicationLimit, usage] = await Promise.all([
          supabase.from('applications').select('*').eq('student_id', student.id).eq('job_posting_id', jobId).maybeSingle(),
          getApplicationLimit(student.id),
          getSubscriptionUsage(student.id)
        ]);

        applicationsUsed = usage.applicationsUsed;
        applicationLimit = totalApplicationLimit === Infinity ? null : totalApplicationLimit;
        const isLimitReached = typeof applicationLimit === 'number' && applicationsUsed >= applicationLimit;

        if (application) {
          hasApplied = true;
          applicationStatus = application.status;
        }

        if (isLimitReached && !hasApplied) {
          isDescriptionLocked = true;
        }
      }
    }

    let isZoneLocked = false;
    let zoneLockReason: any = null;
    let accessSource: string | null = null;
    let quotaLockReason: any = null;

    if (student && isDescriptionLocked) {
      try {
        const quotaUnlockOptions = await getQuotaUnlockOptions(student.id);
        quotaLockReason = { applicationsUsed, applicationLimit, unlockOptions: quotaUnlockOptions };
      } catch (quotaError) {
        console.error('Quota unlock options failed:', quotaError);
      }
    }

    if (student) {
      if (hasApplied) {
        accessSource = 'applied';
      } else {
        try {
          const zoneAccess = await canAccessJob(student.id, jobId);
          if (zoneAccess.canAccess) {
            accessSource = zoneAccess.source;
          } else {
            isZoneLocked = true;
            const unlockOptions = await getUnlockOptions(zoneAccess.requiredZoneId, student.id);
            zoneLockReason = { zone: { id: zoneAccess.requiredZoneId, name: zoneAccess.zoneName }, unlockOptions };
          }
        } catch (zoneError) {
          console.error('Zone access check failed:', zoneError);
        }
      }
    }

    const isLocked = isDescriptionLocked || isZoneLocked;

    let jobQuery = supabase.from('job_postings').select('*, companies ( id, name, logo, description, industry, size, website, social_linkedin, social_twitter, founded_year ), zone_countries ( id, country_name, zone_id )').eq('id', jobId);
    if (!hasApplied) {
      jobQuery = jobQuery.eq('status', 'approved');
    }

    const { data: job } = await jobQuery.maybeSingle();
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    let zoneName: string | null = null;
    if (job.zone_countries?.zone_id) {
      const { data: zone } = await supabase.from('zones').select('name').eq('id', job.zone_countries.zone_id).maybeSingle();
      zoneName = zone?.name || null;
    }

    const company = job.companies;

    res.json({
      id: job.id,
      title: job.title,
      description: isLocked ? null : job.description,
      requirements: isLocked ? null : job.requirements,
      location: job.location,
      jobType: job.job_type,
      salaryRange: job.salary_range,
      deadline: job.deadline,
      status: job.status,
      createdAt: job.created_at,
      countryId: job.zone_countries?.id || null,
      countryName: job.zone_countries?.country_name || null,
      zoneId: job.zone_countries?.zone_id || null,
      zoneName,
      company: company
        ? {
            id: company.id,
            name: company.name,
            logo: company.logo,
            description: company.description,
            industry: company.industry,
            size: company.size,
            website: company.website,
            socialLinks: { linkedin: company.social_linkedin || null, twitter: company.social_twitter || null },
            foundedYear: company.founded_year
          }
        : null,
      isDescriptionLocked: isLocked,
      isQuotaExhausted: isDescriptionLocked,
      quotaLockReason,
      isZoneLocked,
      zoneLockReason,
      accessSource,
      hasApplied,
      applicationStatus
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.applyToJob = async (req: AuthedRequest, res: Response) => {
  try {
    const { jobId } = req.params as { jobId: string };
    if (!isValidUuid(jobId)) {
      return res.status(400).json({ error: 'Invalid job ID format' });
    }

    const student = await getStudentForUser(req.user!.userId);
    if (!student) return res.status(404).json({ error: 'Student not found' });

    if (student.is_hired) {
      return res.status(403).json({ error: 'Hired students cannot apply to new jobs.' });
    }

    const [totalApplicationLimit, usage] = await Promise.all([getApplicationLimit(student.id), getSubscriptionUsage(student.id)]);
    const applicationLimit = totalApplicationLimit === Infinity ? null : totalApplicationLimit;

    let applicationsUsed: number;
    if (student.subscription_tier === 'free') {
      const { count } = await supabase.from('applications').select('*', { count: 'exact', head: true }).eq('student_id', student.id);
      applicationsUsed = count ?? 0;
    } else {
      applicationsUsed = usage.applicationsUsed;
    }

    console.log('[applyToJob]', {
      studentId: student.id,
      applicationsUsed,
      applicationLimit,
      currentSubscriptionId: student.current_subscription_id
    });

    const isLimitReached = typeof applicationLimit === 'number' && applicationsUsed >= applicationLimit;

    if (isLimitReached) {
      const quotaUnlockOptions = await getQuotaUnlockOptions(student.id);
      return res.status(403).json({
        error: 'Application limit reached. Please upgrade your plan to apply to more jobs.',
        isQuotaExhausted: true,
        applicationsUsed,
        applicationLimit,
        unlockOptions: quotaUnlockOptions
      });
    }

    try {
      const zoneAccess = await canAccessJob(student.id, jobId);
      if (!zoneAccess.canAccess) {
        const unlockOptions = await getUnlockOptions(zoneAccess.requiredZoneId, student.id);
        return res.status(403).json({
          error: 'This job is in a zone not included in your plan.',
          isZoneLocked: true,
          zoneLockReason: { zone: { id: zoneAccess.requiredZoneId, name: zoneAccess.zoneName }, unlockOptions }
        });
      }
    } catch (zoneError) {
      console.error('Zone access check failed in applyToJob:', zoneError);
    }

    const { data: existingApp } = await supabase
      .from('applications')
      .select('*')
      .eq('student_id', student.id)
      .eq('job_posting_id', jobId)
      .maybeSingle();

    if (existingApp && existingApp.status !== 'withdrawn') {
      return res.status(400).json({ error: 'You have already applied to this job' });
    }

    const { data: job } = await supabase.from('job_postings').select('id, title, company_id').eq('id', jobId).eq('status', 'approved').maybeSingle();
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    let application;
    if (existingApp && existingApp.status === 'withdrawn') {
      const { data: updated, error } = await supabase
        .from('applications')
        .update({ status: 'pending', rejection_reason: null, reviewed_at: null, created_at: new Date().toISOString() })
        .eq('id', existingApp.id)
        .select()
        .single();
      if (error) throw error;
      application = updated;
    } else {
      const { data: created, error } = await supabase
        .from('applications')
        .insert({ student_id: student.id, job_posting_id: jobId, status: 'pending' })
        .select()
        .single();
      if (error) throw error;
      application = created;
    }

    await incrementApplicationCount(student.id);

    const { data: company } = await supabase.from('companies').select('name, user_id').eq('id', job.company_id).maybeSingle();

    res.status(201).json({ ...application, jobPosting: { id: job.id, title: job.title, company } });

    const jobTitle = job.title;
    const companyName = company?.name;

    notificationService
      .notifyApplicationSubmitted(student.user_id, { jobTitle, companyName })
      .catch((err: unknown) => console.error('Notification error (submitted):', err));

    notificationService
      .notifyAdminsNewApplication({ studentName: student.full_name, jobTitle, applicationId: application.id })
      .catch((err: unknown) => console.error('Notification error (admin new application):', err));

    emailService
      .sendApplicationStatusEmail(
        student.email,
        { status: 'submitted', jobTitle, companyName, studentName: student.full_name },
        { userId: student.user_id }
      )
      .catch((error: unknown) => console.error('Failed to send application submission email', error));

    return;
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getApplications = async (req: AuthedRequest, res: Response) => {
  try {
    const student = await getStudentForUser(req.user!.userId);
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const { data: applications, error } = await supabase
      .from('applications')
      .select('*, job_postings ( title, location, job_type, companies ( name ) )')
      .eq('student_id', student.id)
      .order('created_at', { ascending: false });
    if (error) throw error;

    const shapedApplications = (applications || []).map((application: any) => {
      const { studentFacingStatus, statusMessage } = getStudentFacingStatusPayload(application);
      const jobPosting = application.job_postings;
      const responseApplication: any = {
        ...application,
        jobPostingId: jobPosting
          ? { id: application.job_posting_id, title: jobPosting.title, location: jobPosting.location, jobType: jobPosting.job_type, companyId: jobPosting.companies }
          : application.job_posting_id,
        studentFacingStatus,
        statusMessage
      };
      delete responseApplication.job_postings;

      if (application.status === 'rejected' && application.rejection_source !== 'company') {
        responseApplication.rejection_reason = null;
      }

      return responseApplication;
    });

    res.json({ applications: shapedApplications });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.withdrawApplication = async (req: AuthedRequest, res: Response) => {
  try {
    const { appId } = req.params as { appId: string };
    if (!isValidUuid(appId)) {
      return res.status(400).json({ error: 'Invalid application ID format' });
    }

    const student = await getStudentForUser(req.user!.userId);
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const { data: application } = await supabase.from('applications').select('*').eq('id', appId).maybeSingle();
    if (!application) return res.status(404).json({ error: 'Application not found' });

    if (application.student_id !== student.id) {
      return res.status(403).json({ error: 'You can only withdraw your own applications' });
    }

    if (application.status !== 'pending') {
      const messages: Record<string, string> = {
        reviewed: 'Cannot withdraw after admin has approved your application',
        hired: 'Cannot withdraw after being hired',
        withdrawn: 'Application already withdrawn',
        rejected: 'Cannot withdraw a rejected application'
      };
      const message = messages[application.status] || 'Application cannot be withdrawn at this stage';
      return res.status(400).json({ error: message });
    }

    const { data: updatedApplication } = await supabase
      .from('applications')
      .update({ status: 'withdrawn' })
      .eq('id', appId)
      .select()
      .single();

    await decrementApplicationCount(student.id);

    res.json(updatedApplication);

    const { data: job } = await supabase.from('job_postings').select('title').eq('id', application.job_posting_id).maybeSingle();

    notificationService
      .notifyAdminsApplicationWithdrawn({
        studentName: student.full_name,
        jobTitle: job?.title || 'Unknown Job',
        applicationId: application.id
      })
      .catch((err: unknown) => console.error('Notification error (application withdrawn):', err));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getProfile = async (req: AuthedRequest, res: Response) => {
  try {
    const student = await getStudentForUser(req.user!.userId);
    if (!student) return res.status(404).json({ error: 'Student not found' });

    res.json(buildProfileResponse(student));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.updateProfile = async (req: AuthedRequest, res: Response) => {
  try {
    const { fullName, email, isDGShipping, profileLink, bio, location, availableFrom, skills, education, experience } = req.body || {};

    const student = await getStudentForUser(req.user!.userId);
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const updates: Record<string, any> = {};

    if (fullName !== undefined) {
      if (typeof fullName !== 'string' || fullName.trim().length < 2 || fullName.trim().length > 100) {
        return res.status(400).json({ error: 'Full name must be 2-100 characters' });
      }
      updates.full_name = fullName.trim();
    }

    if (email !== undefined) {
      if (!isValidEmail(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
      }
      const emailTaken = await isEmailTakenByOther(email, student.id);
      if (emailTaken) {
        return res.status(409).json({ error: 'Email already registered' });
      }
      updates.email = email.toLowerCase();
    }

    if (isDGShipping !== undefined) {
      if (!['yes', 'no'].includes(isDGShipping)) {
        return res.status(400).json({ error: 'Invalid value for DG Shipping' });
      }
      updates.is_dg_shipping = isDGShipping;
    }

    if (profileLink !== undefined) {
      if (profileLink && profileLink.length > 500) {
        return res.status(400).json({ error: 'Profile link must be less than 500 characters' });
      }
      if (profileLink && !isValidUrl(profileLink)) {
        return res.status(400).json({ error: 'Profile link must be a valid URL' });
      }
      updates.profile_link = profileLink ? profileLink.trim() : null;
    }

    if (bio !== undefined) {
      if (bio && (typeof bio !== 'string' || bio.length > 2000)) {
        return res.status(400).json({ error: 'Bio must be a string up to 2000 characters' });
      }
      updates.bio = bio ? bio.trim() : null;
    }

    if (location !== undefined) {
      if (location && (typeof location !== 'string' || location.length > 200)) {
        return res.status(400).json({ error: 'Location must be a string up to 200 characters' });
      }
      updates.location = location ? location.trim() : null;
    }

    if (availableFrom !== undefined) {
      if (availableFrom === null || availableFrom === '') {
        updates.available_from = null;
      } else {
        const parsedDate = normalizeDate(availableFrom);
        if (!parsedDate) {
          return res.status(400).json({ error: 'availableFrom must be a valid date' });
        }
        updates.available_from = parsedDate.toISOString().slice(0, 10);
      }
    }

    if (skills !== undefined) {
      if (!Array.isArray(skills)) {
        return res.status(400).json({ error: 'Skills must be an array of strings' });
      }
      const normalizedSkills = Array.from(
        new Set(skills.map((skill: any) => (typeof skill === 'string' ? skill.trim() : '')).filter((skill: string) => skill))
      );
      if (normalizedSkills.length > 50) {
        return res.status(400).json({ error: 'Skills cannot exceed 50 entries' });
      }
      if (normalizedSkills.some((skill) => (skill as string).length > 50)) {
        return res.status(400).json({ error: 'Each skill must be 50 characters or fewer' });
      }
      updates.skills = normalizedSkills;
    }

    if (education !== undefined) {
      if (!Array.isArray(education)) {
        return res.status(400).json({ error: 'Education must be an array' });
      }

      const normalizedEducation = education
        .map((entry: any, idx: number) => {
          if (!entry || typeof entry !== 'object') {
            throw new Error(`Education entry ${idx + 1} is invalid`);
          }

          const normalizedEntry = {
            institution: sanitizeString(entry.institution, 200),
            degree: sanitizeString(entry.degree, 200),
            field: sanitizeString(entry.field, 200),
            startYear: normalizeYear(entry.startYear),
            endYear: normalizeYear(entry.endYear)
          };

          const providedStart = entry.startYear !== undefined && entry.startYear !== null && entry.startYear !== '';
          const providedEnd = entry.endYear !== undefined && entry.endYear !== null && entry.endYear !== '';

          if (providedStart && normalizedEntry.startYear === null) {
            throw new Error('Education start year must be between 1900 and the near future');
          }
          if (providedEnd && normalizedEntry.endYear === null) {
            throw new Error('Education end year must be between 1900 and the near future');
          }
          if (normalizedEntry.startYear && normalizedEntry.endYear && normalizedEntry.endYear < normalizedEntry.startYear) {
            throw new Error('Education end year cannot be before start year');
          }

          return normalizedEntry;
        })
        .filter((entry: any) => Object.values(entry).some((value) => value !== null));

      updates.education = normalizedEducation;
    }

    if (experience !== undefined) {
      if (!Array.isArray(experience)) {
        return res.status(400).json({ error: 'Experience must be an array' });
      }

      const normalizedExperience = experience
        .map((entry: any, idx: number) => {
          if (!entry || typeof entry !== 'object') {
            throw new Error(`Experience entry ${idx + 1} is invalid`);
          }

          const normalizedEntry = {
            company: sanitizeString(entry.company, 200),
            title: sanitizeString(entry.title, 200),
            startDate: normalizeDate(entry.startDate),
            endDate: normalizeDate(entry.endDate),
            description: entry?.description ? entry.description.toString().slice(0, 2000) : null
          };

          if (entry.startDate && !normalizedEntry.startDate) {
            throw new Error('Experience start date must be a valid date');
          }
          if (entry.endDate && !normalizedEntry.endDate) {
            throw new Error('Experience end date must be a valid date');
          }
          if (normalizedEntry.endDate && normalizedEntry.startDate && normalizedEntry.endDate < normalizedEntry.startDate) {
            throw new Error('Experience end date cannot be before start date');
          }

          return normalizedEntry;
        })
        .filter((entry: any) => Object.values(entry).some((value) => value !== null));

      updates.experience = normalizedExperience;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const { error } = await supabase.from('students').update(updates as any).eq('id', student.id);
    if (error) throw error;

    res.json({ success: true });
  } catch (error: any) {
    if (error.message && error.message.startsWith('Education')) {
      return res.status(400).json({ error: error.message });
    }
    if (error.message && error.message.startsWith('Experience')) {
      return res.status(400).json({ error: error.message });
    }
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.uploadResume = async (req: AuthedRequest & { file?: any }, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Resume file is required' });
    }

    const student = await getStudentForUser(req.user!.userId);
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const resumeUrl = await uploadStudentResume(req.file);

    await supabase.from('students').update({ resume_url: resumeUrl }).eq('id', student.id);

    res.json({ resumeUrl });
  } catch (error: any) {
    const clientErrorIndicators = ['resume', 'pdf', 'file buffer'];
    if (error.message && clientErrorIndicators.some((indicator: string) => error.message.toLowerCase().includes(indicator))) {
      return res.status(400).json({ error: error.message });
    }
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getProfileCompleteness = async (req: AuthedRequest, res: Response) => {
  try {
    const student = await getStudentForUser(req.user!.userId);
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const { percentage, missingItems } = buildCompleteness(student);
    res.json({ percentage, missingItems });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getSubscriptionZones = async (req: AuthedRequest, res: Response) => {
  try {
    const student = await getStudentForUser(req.user!.userId);
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const access = await getAccessibleZones(student.id);

    const { data: allZones } = await supabase.from('zones').select('id, name, description');
    const formatZone = (z: any) => ({ id: z.id, name: z.name, description: z.description });
    const zoneList = allZones || [];

    if (access.allZones) {
      return res.json({ allZonesIncluded: true, accessibleZones: zoneList.map(formatZone), lockedZones: [] });
    }

    const accessibleZoneIdSet = new Set(access.zoneIds);
    const accessibleZones = zoneList.filter((z) => accessibleZoneIdSet.has(z.id)).map(formatZone);
    const lockedZones = zoneList.filter((z) => !accessibleZoneIdSet.has(z.id)).map(formatZone);

    res.json({ allZonesIncluded: false, accessibleZones, lockedZones });
  } catch (error) {
    console.error('Get subscription zones error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getZoneAddons = async (_req: Request, res: Response) => {
  try {
    const { data: addons } = await supabase
      .from('addons')
      .select('id, name, price_inr, price_usd, zone_count, unlock_all_zones')
      .eq('type', 'zone')
      .order('price_inr', { ascending: true });

    const formattedAddons = (addons || []).map((a) => ({
      id: a.id,
      name: a.name,
      priceINR: a.price_inr,
      priceUSD: a.price_usd,
      zoneCount: a.zone_count,
      unlockAllZones: a.unlock_all_zones
    }));

    res.json({ addons: formattedAddons });
  } catch (error) {
    console.error('Get zone addons error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getJobsAddons = async (_req: Request, res: Response) => {
  try {
    const { data: addons } = await supabase
      .from('addons')
      .select('id, name, price_inr, price_usd, job_credit_count')
      .eq('type', 'jobs')
      .order('price_inr', { ascending: true });

    const formattedAddons = (addons || []).map((a) => ({
      id: a.id,
      name: a.name,
      priceINR: a.price_inr,
      priceUSD: a.price_usd,
      jobCredits: a.job_credit_count
    }));

    res.json({ addons: formattedAddons });
  } catch (error) {
    console.error('Get jobs addons error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};
