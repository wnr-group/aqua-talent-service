import { Request, Response } from 'express';

import { getSupabaseClient } from '../lib/supabase/client';
const emailService = require('../services/emailService');
const notificationService = require('../services/notificationService');
const { updateCompanyStatusSchema, updateJobStatusSchema, adminUpdateApplicationSchema } = require('../utils/validation');
const { COMPANY_STATUSES, JOB_STATUSES, APPLICATION_STATUSES, JOB_TYPES, CONFIG_KEYS, CURRENCIES } = require('../constants');
const { getPresignedUrl } = require('../services/mediaService');
import { invalidatePublicCompanyProfileCache } from '../services/companyProfileService';

type AuthedRequest = Request & { user?: { userId: string; userType: string } };

const supabase = getSupabaseClient();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isValidUuid = (value: any): boolean => typeof value === 'string' && UUID_RE.test(value);

const buildSubscriptionPlanResponse = (plan: any) => ({
  id: plan.id,
  name: plan.name,
  description: plan.description,
  maxApplications: plan.max_applications,
  price: plan.price,
  priceINR: plan.price_inr,
  priceUSD: plan.price_usd,
  currency: plan.currency,
  billingCycle: 'one-time',
  discount: plan.discount,
  features: plan.features,
  badge: plan.badge,
  displayOrder: plan.display_order,
  resumeDownloads: plan.resume_downloads,
  videoViews: plan.video_views,
  prioritySupport: plan.priority_support,
  profileBoost: plan.profile_boost,
  applicationHighlight: plan.application_highlight,
  allZonesIncluded: plan.all_zones_included,
  isActive: plan.is_active,
  createdAt: plan.created_at,
  updatedAt: plan.updated_at
});

// Minimal replacement for the old SystemConfig.getValue/setValue Mongoose statics.
const getConfigValue = async (key: string, defaultValue: any = null) => {
  const { data } = await supabase.from('system_config').select('value').eq('key', key).maybeSingle();
  return data ? data.value : defaultValue;
};

const setConfigValue = async (key: string, value: any, description: string, updatedBy: string) => {
  const { data: existing } = await supabase.from('system_config').select('id').eq('key', key).maybeSingle();
  const { error } = existing
    ? await supabase.from('system_config').update({ value, description, updated_by: updatedBy }).eq('id', existing.id)
    : await supabase.from('system_config').insert({ key, value, description, updated_by: updatedBy });
  if (error) throw error;
};

// ─── Dashboard ──────────────────────────────────────────────────────────────

exports.getDashboard = async (_req: Request, res: Response) => {
  try {
    const [
      { count: totalCompanies },
      { count: pendingCompanies },
      { count: totalJobs },
      { count: pendingJobs },
      { count: activeJobs },
      { count: totalStudents },
      { count: totalApplications },
      { count: totalHires }
    ] = await Promise.all([
      supabase.from('companies').select('*', { count: 'exact', head: true }),
      supabase.from('companies').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('job_postings').select('*', { count: 'exact', head: true }),
      supabase.from('job_postings').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('job_postings').select('*', { count: 'exact', head: true }).eq('status', 'approved'),
      supabase.from('students').select('*', { count: 'exact', head: true }),
      supabase.from('applications').select('*', { count: 'exact', head: true }),
      supabase.from('applications').select('*', { count: 'exact', head: true }).eq('status', 'hired')
    ]);

    res.json({
      pendingCompanies: pendingCompanies ?? 0,
      totalCompanies: totalCompanies ?? 0,
      pendingJobs: pendingJobs ?? 0,
      activeJobs: activeJobs ?? 0,
      totalJobs: totalJobs ?? 0,
      totalStudents: totalStudents ?? 0,
      totalApplications: totalApplications ?? 0,
      totalHires: totalHires ?? 0
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

// ─── Company Management ────────────────────────────────────────────────────

exports.getCompanies = async (req: Request, res: Response) => {
  try {
    const { status, search, page = 1, limit = 20 } = req.query as Record<string, any>;

    if (status && !COMPANY_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Status must be pending, approved, or rejected' });
    }

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));

    let query = supabase.from('companies').select('*, users ( username, is_active )');
    if (status) query = query.eq('status', status);

    const { data: companies, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;

    let filtered = companies || [];
    if (search) {
      const term = String(search).toLowerCase();
      filtered = filtered.filter(
        (c: any) =>
          (c.name || '').toLowerCase().includes(term) ||
          (c.email || '').toLowerCase().includes(term) ||
          (c.users?.username || '').toLowerCase().includes(term)
      );
    }

    const total = filtered.length;
    const paged = filtered.slice((pageNum - 1) * limitNum, (pageNum - 1) * limitNum + limitNum);

    const result = paged.map((c: any) => ({
      id: c.id,
      username: c.users?.username,
      isActive: c.users?.is_active !== false,
      name: c.name,
      email: c.email,
      status: c.status,
      rejectionReason: c.rejection_reason,
      createdAt: c.created_at,
      approvedAt: c.approved_at
    }));

    res.json({ companies: result, pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.updateCompany = async (req: AuthedRequest, res: Response) => {
  try {
    const { companyId } = req.params as { companyId: string };
    if (!isValidUuid(companyId)) {
      return res.status(400).json({ error: 'Invalid company ID format' });
    }

    const parsed = updateCompanyStatusSchema.parse(req.body);

    const { data: company } = await supabase.from('companies').select('*').eq('id', companyId).maybeSingle();
    if (!company) return res.status(404).json({ error: 'Company not found' });

    const previousStatus = company.status;
    const updateFields: Record<string, any> = { status: parsed.status };

    if (parsed.status === 'approved') {
      updateFields.approved_at = new Date().toISOString();
      updateFields.rejection_reason = null;
    } else if (parsed.status === 'rejected') {
      updateFields.rejection_reason = parsed.rejectionReason;
      updateFields.approved_at = null;
    } else if (parsed.status === 'pending') {
      updateFields.approved_at = null;
    }

    const { data: updatedCompany, error } = await supabase
      .from('companies')
      .update(updateFields as any)
      .eq('id', companyId)
      .select()
      .single();
    if (error) throw error;

    const { data: user } = await supabase.from('users').select('username').eq('id', updatedCompany.user_id).maybeSingle();

    res.json({
      id: updatedCompany.id,
      username: user?.username,
      name: updatedCompany.name,
      email: updatedCompany.email,
      status: updatedCompany.status,
      rejectionReason: updatedCompany.rejection_reason,
      createdAt: updatedCompany.created_at,
      approvedAt: updatedCompany.approved_at
    });

    const statusChanged = previousStatus !== updatedCompany.status;
    const companyUserId = updatedCompany.user_id;

    if (statusChanged && parsed.status === 'approved') {
      emailService
        .sendCompanyApprovedEmail(
          updatedCompany.email,
          { companyName: updatedCompany.name, recipientName: updatedCompany.name },
          { userId: companyUserId }
        )
        .catch((error: unknown) => console.error('Failed to send company approval email', error));

      notificationService
        .notifyCompanyApproved(companyUserId, { companyName: updatedCompany.name })
        .catch((err: unknown) => console.error('Notification error (company approved):', err));
    } else if (statusChanged && parsed.status === 'rejected') {
      emailService
        .sendCompanyRejectedEmail(
          updatedCompany.email,
          {
            companyName: updatedCompany.name,
            recipientName: updatedCompany.name,
            reason: parsed.rejectionReason || updatedCompany.rejection_reason
          },
          { userId: companyUserId }
        )
        .catch((error: unknown) => console.error('Failed to send company rejection email', error));

      notificationService
        .notifyCompanyRejected(companyUserId, {
          companyName: updatedCompany.name,
          rejectionReason: parsed.rejectionReason || updatedCompany.rejection_reason
        })
        .catch((err: unknown) => console.error('Notification error (company rejected):', err));
    }
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: error.issues[0].message });
    }
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getCompanyProfileAdmin = async (req: Request, res: Response) => {
  try {
    const { companyId } = req.params as { companyId: string };

    const { data: company } = await supabase.from('companies').select('*, users ( is_active )').eq('id', companyId).maybeSingle();
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const { users, ...companyObj } = company as any;
    (companyObj as any).isActive = users?.is_active !== false;

    return res.json(companyObj);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Server error' });
  }
};

exports.updateCompanyProfileAdmin = async (req: Request, res: Response) => {
  try {
    const { companyId } = req.params as { companyId: string };
    const { description, website, industry, size, foundedYear, socialLinks } = req.body || {};

    if (!isValidUuid(companyId)) {
      return res.status(400).json({ error: 'Invalid company ID format' });
    }

    const isValidUrl = (value: any) => {
      if (!value) return true;
      try {
        new URL(value);
        return true;
      } catch {
        return false;
      }
    };

    if (!isValidUrl(website)) return res.status(400).json({ error: 'Invalid website URL' });
    if (!isValidUrl(socialLinks?.linkedin)) return res.status(400).json({ error: 'Invalid LinkedIn URL' });
    if (!isValidUrl(socialLinks?.twitter)) return res.status(400).json({ error: 'Invalid Twitter URL' });

    const { data: company } = await supabase.from('companies').select('*').eq('id', companyId).maybeSingle();
    if (!company) return res.status(404).json({ error: 'Company not found' });

    const updates: Record<string, any> = {};
    if (description !== undefined) updates.description = description;
    if (website !== undefined) updates.website = website;
    if (industry !== undefined) updates.industry = industry;
    if (size !== undefined) updates.size = size;
    if (foundedYear !== undefined) updates.founded_year = foundedYear;

    if (socialLinks !== undefined) {
      updates.social_linkedin = socialLinks?.linkedin ?? company.social_linkedin ?? null;
      updates.social_twitter = socialLinks?.twitter ?? company.social_twitter ?? null;
    }

    const { data: updated, error } = await supabase.from('companies').update(updates as any).eq('id', companyId).select().single();
    if (error) throw error;

    invalidatePublicCompanyProfileCache(companyId);

    return res.status(200).json(updated);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Server error' });
  }
};

exports.setCompanyActiveStatus = async (req: Request, res: Response) => {
  try {
    const { companyId } = req.params as { companyId: string };
    const { isActive } = req.body;

    const { data: company } = await supabase.from('companies').select('user_id').eq('id', companyId).maybeSingle();
    if (!company) return res.status(404).json({ error: 'Company not found' });

    const { error: statusUpdateError } = await supabase.from('users').update({ is_active: isActive }).eq('id', company.user_id);
    if (statusUpdateError) throw statusUpdateError;
    res.json({ success: true, isActive });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

// ─── Job Management ─────────────────────────────────────────────────────────

const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (c) => `\\${c}`);

exports.getJobs = async (req: Request, res: Response) => {
  try {
    const { status, search, location, jobType, page = 1, limit = 10 } = req.query as Record<string, any>;

    if (status && !JOB_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${JOB_STATUSES.join(', ')}` });
    }
    if (jobType && !JOB_TYPES.includes(jobType)) {
      return res.status(400).json({ error: `Job type must be one of: ${JOB_TYPES.join(', ')}` });
    }

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));
    const from = (pageNum - 1) * limitNum;
    const to = from + limitNum - 1;

    let query = supabase.from('job_postings').select('*, companies ( id, name )', { count: 'exact' });
    if (status) query = query.eq('status', status);
    if (jobType) query = query.eq('job_type', jobType);
    if (location) query = query.ilike('location', `%${escapeLike(location)}%`);
    if (search) {
      const escaped = escapeLike(search);
      query = query.or(`title.ilike.%${escaped}%,description.ilike.%${escaped}%`);
    }

    const { data: jobs, count, error } = await query.order('created_at', { ascending: false }).range(from, to);
    if (error) throw error;

    const result = (jobs || []).map((job: any) => ({
      id: job.id,
      companyId: job.companies?.id,
      title: job.title,
      description: job.description,
      requirements: job.requirements,
      location: job.location,
      jobType: job.job_type,
      salaryRange: job.salary_range,
      deadline: job.deadline,
      status: job.status,
      rejectionReason: job.rejection_reason,
      createdAt: job.created_at,
      approvedAt: job.approved_at,
      company: job.companies ? { id: job.companies.id, name: job.companies.name } : null
    }));

    res.json({ jobs: result, pagination: { page: pageNum, limit: limitNum, total: count ?? 0, totalPages: Math.ceil((count ?? 0) / limitNum) } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getJob = async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params as { jobId: string };
    if (!isValidUuid(jobId)) {
      return res.status(400).json({ error: 'Invalid job ID format' });
    }

    const { data: job } = await supabase.from('job_postings').select('*, companies ( id, name, email )').eq('id', jobId).maybeSingle();
    if (!job) return res.status(404).json({ error: 'Job not found' });

    res.json({
      id: job.id,
      companyId: job.companies?.id,
      title: job.title,
      description: job.description,
      requirements: job.requirements,
      location: job.location,
      jobType: job.job_type,
      salaryRange: job.salary_range,
      deadline: job.deadline,
      status: job.status,
      rejectionReason: job.rejection_reason,
      createdAt: job.created_at,
      approvedAt: job.approved_at,
      company: job.companies ? { id: job.companies.id, name: job.companies.name, email: job.companies.email } : null
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.updateJob = async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params as { jobId: string };
    if (!isValidUuid(jobId)) {
      return res.status(400).json({ error: 'Invalid job ID format' });
    }

    const parsed = updateJobStatusSchema.parse(req.body);

    const { data: job } = await supabase.from('job_postings').select('*').eq('id', jobId).maybeSingle();
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const previousStatus = job.status;
    const updateFields: Record<string, any> = { status: parsed.status };

    if (parsed.status === 'approved') {
      updateFields.approved_at = new Date().toISOString();
      updateFields.rejection_reason = null;
    } else if (parsed.status === 'rejected') {
      updateFields.rejection_reason = parsed.rejectionReason || null;
      updateFields.approved_at = null;
    } else if (parsed.status === 'pending') {
      updateFields.approved_at = null;
    }
    // For 'closed', keep existing approved_at and rejection_reason

    const { data: updatedJob, error } = await supabase
      .from('job_postings')
      .update(updateFields as any)
      .eq('id', jobId)
      .select('*, companies ( id, name, user_id )')
      .single();
    if (error) throw error;

    if (parsed.status === 'closed') {
      const { error: rejectAppsError } = await supabase
        .from('applications')
        .update({ status: 'rejected', rejection_reason: 'Job posting has been closed' })
        .eq('job_posting_id', jobId)
        .in('status', ['pending', 'reviewed']);
      if (rejectAppsError) throw rejectAppsError;
    }

    res.json({
      id: updatedJob.id,
      companyId: updatedJob.companies?.id,
      title: updatedJob.title,
      description: updatedJob.description,
      requirements: updatedJob.requirements,
      location: updatedJob.location,
      jobType: updatedJob.job_type,
      salaryRange: updatedJob.salary_range,
      deadline: updatedJob.deadline,
      status: updatedJob.status,
      rejectionReason: updatedJob.rejection_reason,
      createdAt: updatedJob.created_at,
      approvedAt: updatedJob.approved_at,
      company: updatedJob.companies ? { id: updatedJob.companies.id, name: updatedJob.companies.name } : null
    });

    const statusChanged = previousStatus !== updatedJob.status;

    if (statusChanged && parsed.status === 'approved') {
      const companyUserId = updatedJob.companies?.user_id;
      notificationService
        .notifyJobApproved(companyUserId, { jobTitle: updatedJob.title || 'Job Posting' })
        .catch((error: unknown) => console.error('Notification error (job approved):', error));
    }
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: error.issues[0].message });
    }
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

// ─── Application Management ────────────────────────────────────────────────

exports.getApplications = async (req: Request, res: Response) => {
  try {
    const { status, search, jobType, location, page = 1, limit = 10 } = req.query as Record<string, any>;

    if (status && !APPLICATION_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${APPLICATION_STATUSES.join(', ')}` });
    }
    if (jobType && !JOB_TYPES.includes(jobType)) {
      return res.status(400).json({ error: `Job type must be one of: ${JOB_TYPES.join(', ')}` });
    }

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));

    let query = supabase.from('applications').select(
      '*, students ( id, full_name, email, profile_link, is_hired ), job_postings ( id, title, location, job_type, companies ( id, name ) )'
    );
    if (status) query = query.eq('status', status);

    const { data: applications, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;

    let filtered = applications || [];

    if (jobType) {
      filtered = filtered.filter((a: any) => a.job_postings?.job_type === jobType);
    }
    if (location) {
      const loc = String(location).toLowerCase();
      filtered = filtered.filter((a: any) => (a.job_postings?.location || '').toLowerCase().includes(loc));
    }
    if (search) {
      const term = String(search).toLowerCase();
      filtered = filtered.filter(
        (a: any) =>
          (a.students?.full_name || '').toLowerCase().includes(term) ||
          (a.students?.email || '').toLowerCase().includes(term) ||
          (a.job_postings?.title || '').toLowerCase().includes(term)
      );
    }

    const total = filtered.length;
    const paged = filtered.slice((pageNum - 1) * limitNum, (pageNum - 1) * limitNum + limitNum);

    const result = paged.map((app: any) => ({
      id: app.id,
      studentId: app.student_id,
      jobPostingId: app.job_posting_id,
      status: app.status,
      createdAt: app.created_at,
      reviewedAt: app.reviewed_at,
      rejectionReason: app.rejection_reason,
      student: app.students
        ? {
            id: app.students.id,
            fullName: app.students.full_name,
            email: app.students.email,
            profileLink: app.students.profile_link,
            isHired: app.students.is_hired
          }
        : null,
      jobPosting: app.job_postings
        ? {
            id: app.job_postings.id,
            title: app.job_postings.title,
            location: app.job_postings.location,
            jobType: app.job_postings.job_type,
            company: app.job_postings.companies ? { id: app.job_postings.companies.id, name: app.job_postings.companies.name } : null
          }
        : null
    }));

    res.json({ applications: result, pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.updateApplication = async (req: Request, res: Response) => {
  try {
    const { appId } = req.params as { appId: string };
    if (!isValidUuid(appId)) {
      return res.status(400).json({ error: 'Invalid application ID format' });
    }

    const parsed = adminUpdateApplicationSchema.parse(req.body);

    const { data: application } = await supabase.from('applications').select('*').eq('id', appId).maybeSingle();
    if (!application) return res.status(404).json({ error: 'Application not found' });

    if (application.status === 'withdrawn') {
      return res.status(400).json({ error: 'Cannot process withdrawn applications' });
    }
    if (application.status === 'hired') {
      return res.status(400).json({ error: 'Cannot modify applications that have been hired' });
    }

    const updateFields: Record<string, any> = { status: parsed.status };

    if (parsed.status === 'reviewed') {
      updateFields.reviewed_at = new Date().toISOString();
      updateFields.rejection_reason = null;
      updateFields.rejection_source = null;
    } else if (parsed.status === 'rejected') {
      // Don't set reviewed_at when admin rejects - keeps it hidden from companies
      updateFields.rejection_reason = parsed.rejectionReason || null;
      updateFields.rejection_source = 'admin';
    }

    const { data: updatedApp, error } = await supabase
      .from('applications')
      .update(updateFields as any)
      .eq('id', appId)
      .select('*, students ( id, full_name, email, profile_link, is_hired, user_id ), job_postings ( id, title, companies ( id, name, user_id ) )')
      .single();
    if (error) throw error;

    const student = updatedApp.students;
    const job = updatedApp.job_postings;
    const company = job?.companies;

    res.json({
      id: updatedApp.id,
      studentId: student?.id,
      jobPostingId: job?.id,
      status: updatedApp.status,
      createdAt: updatedApp.created_at,
      reviewedAt: updatedApp.reviewed_at,
      rejectionReason: updatedApp.rejection_reason,
      student: student ? { id: student.id, fullName: student.full_name, email: student.email, profileLink: student.profile_link, isHired: student.is_hired } : null,
      jobPosting: job ? { id: job.id, title: job.title, company: company ? { id: company.id, name: company.name } : null } : null
    });

    if (!student || !job || !company) return;

    if (parsed.status === 'reviewed') {
      emailService
        .sendApplicationStatusEmail(
          student.email,
          { status: 'approved', jobTitle: job.title, companyName: company.name, studentName: student.full_name },
          { userId: student.user_id }
        )
        .catch((error: unknown) => console.error('Failed to send application approval email', error));

      notificationService
        .notifyApplicationApproved(student.user_id, { jobTitle: job.title, companyName: company.name })
        .catch((err: unknown) => console.error('Notification error (app approved):', err));

      if (company.user_id) {
        notificationService
          .notifyApplicationReceived(company.user_id, { jobTitle: job.title, studentName: student.full_name })
          .catch((err: unknown) => console.error('Notification error (app received by company):', err));
      }
    } else if (parsed.status === 'rejected') {
      emailService
        .sendApplicationStatusEmail(
          student.email,
          {
            status: 'rejected',
            jobTitle: job.title,
            companyName: company.name,
            studentName: student.full_name,
            reason: updatedApp.rejection_reason
          },
          { userId: student.user_id }
        )
        .catch((error: unknown) => console.error('Failed to send application rejection email', error));

      notificationService
        .notifyApplicationRejected(student.user_id, { jobTitle: job.title, companyName: company.name, reason: updatedApp.rejection_reason })
        .catch((err: unknown) => console.error('Notification error (app rejected):', err));
    }
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: error.issues[0].message });
    }
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

// ─── Student Management ────────────────────────────────────────────────────

exports.getStudents = async (req: Request, res: Response) => {
  try {
    const { subscriptionTier, hasActiveApplications, isHired, hasResume, hasVideo, search, page = 1, limit = 20 } = req.query as Record<string, any>;

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));

    let query = supabase.from('students').select('*, users ( is_active )');

    if (subscriptionTier && ['free', 'paid'].includes(subscriptionTier)) {
      query = query.eq('subscription_tier', subscriptionTier);
    }
    if (isHired !== undefined) {
      query = query.eq('is_hired', isHired === 'true');
    }
    if (hasResume !== undefined) {
      query = hasResume === 'true' ? query.not('resume_url', 'is', null) : query.is('resume_url', null);
    }
    if (hasVideo !== undefined) {
      query = hasVideo === 'true' ? query.not('intro_video_url', 'is', null) : query.is('intro_video_url', null);
    }
    if (search) {
      const escaped = escapeLike(search);
      query = query.or(`full_name.ilike.%${escaped}%,email.ilike.%${escaped}%,student_id.ilike.%${escaped}%`);
    }

    const { data: students, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;

    const studentList = students || [];
    const studentIds = studentList.map((s) => s.id);

    const { data: applications } = studentIds.length
      ? await supabase.from('applications').select('student_id, status').in('student_id', studentIds)
      : { data: [] as any[] };

    const appCountsByStudent = new Map<string, { total: number; active: number }>();
    for (const app of applications || []) {
      const entry = appCountsByStudent.get(app.student_id) || { total: 0, active: 0 };
      entry.total += 1;
      if (['pending', 'reviewed'].includes(app.status)) entry.active += 1;
      appCountsByStudent.set(app.student_id, entry);
    }

    let shaped = studentList.map((s: any) => {
      const counts = appCountsByStudent.get(s.id) || { total: 0, active: 0 };
      return {
        id: s.id,
        studentId: s.student_id || null,
        fullName: s.full_name,
        email: s.email,
        subscriptionTier: s.subscription_tier,
        isHired: s.is_hired,
        isActive: s.users?.is_active !== false,
        hasResume: Boolean(s.resume_url),
        hasVideo: Boolean(s.intro_video_url),
        totalApplications: counts.total,
        activeApplications: counts.active,
        createdAt: s.created_at
      };
    });

    if (hasActiveApplications !== undefined) {
      shaped = hasActiveApplications === 'true' ? shaped.filter((s) => s.activeApplications > 0) : shaped.filter((s) => s.activeApplications === 0);
    }

    const total = shaped.length;
    const paged = shaped.slice((pageNum - 1) * limitNum, (pageNum - 1) * limitNum + limitNum);

    res.json({ students: paged, pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getStudentProfile = async (req: Request, res: Response) => {
  try {
    const { studentId } = req.params as { studentId: string };
    if (!isValidUuid(studentId)) {
      return res.status(400).json({ error: 'Invalid student ID format' });
    }

    const { data: student } = await supabase.from('students').select('*, users ( is_active )').eq('id', studentId).maybeSingle();
    if (!student) return res.status(404).json({ error: 'Student not found' });

    let currentSubscription: any = null;
    if (student.current_subscription_id) {
      const { data: sub } = await supabase
        .from('active_subscriptions')
        .select('*, available_services ( id, name, description, price, billing_cycle, features )')
        .eq('id', student.current_subscription_id)
        .maybeSingle();
      currentSubscription = sub;
    }

    const [resumeUrl, introVideoUrl] = await Promise.all([
      student.resume_url ? getPresignedUrl(student.resume_url) : null,
      student.intro_video_url ? getPresignedUrl(student.intro_video_url) : null
    ]);

    const { data: payments } = await supabase
      .from('payment_records')
      .select('*, active_subscriptions ( id, available_services ( id, name, price ) ), available_services ( id, name, price )')
      .eq('student_id', student.id)
      .order('payment_date', { ascending: false });

    const paymentList = payments || [];

    const { data: payPerJobPurchases } = await supabase
      .from('pay_per_job_purchases')
      .select('*, job_postings ( id, title )')
      .eq('student_id', student.id);
    const payPerJobByOrderId = new Map((payPerJobPurchases || []).filter((p) => p.razorpay_order_id).map((p) => [p.razorpay_order_id, p]));

    const paymentIds = paymentList.map((p) => p.id);
    const { data: subscriptionAddons } = paymentIds.length
      ? await supabase.from('subscription_addons').select('*, addons ( id, name, type )').in('payment_record_id', paymentIds)
      : { data: [] as any[] };
    const addonByPaymentId = new Map((subscriptionAddons || []).map((sa) => [sa.payment_record_id, sa]));

    const { data: applications } = await supabase
      .from('applications')
      .select('*, job_postings ( id, title, location, job_type, salary_range, status, companies ( id, name ) )')
      .eq('student_id', student.id)
      .order('created_at', { ascending: false });

    res.json({
      id: student.id,
      studentId: student.student_id || null,
      fullName: student.full_name,
      email: student.email,
      isActive: (student as any).users?.is_active !== false,
      isDGShipping: student.is_dg_shipping || 'no',
      profileLink: student.profile_link || null,
      bio: student.bio || null,
      location: student.location || null,
      availableFrom: student.available_from || null,
      skills: student.skills || [],
      education: student.education || [],
      experience: student.experience || [],
      resumeUrl,
      introVideoUrl,
      isHired: student.is_hired,
      createdAt: student.created_at,
      subscription: {
        tier: student.subscription_tier,
        current: currentSubscription
          ? {
              id: currentSubscription.id,
              status: currentSubscription.status,
              startDate: currentSubscription.start_date,
              endDate: currentSubscription.end_date,
              autoRenew: currentSubscription.auto_renew,
              plan: currentSubscription.available_services
                ? {
                    id: currentSubscription.available_services.id,
                    name: currentSubscription.available_services.name,
                    description: currentSubscription.available_services.description,
                    price: currentSubscription.available_services.price,
                    billingCycle: currentSubscription.available_services.billing_cycle,
                    features: currentSubscription.available_services.features
                  }
                : null
            }
          : null
      },
      payments: paymentList.map((p: any) => {
        let paymentType = 'unknown';
        let typeLabel = 'Unknown';
        let details: any = null;

        const gatewayType = p.gateway_response?.type;
        const orderId = p.razorpay_order_id || p.gateway_response?.orderId;

        if (gatewayType === 'pay_per_job') {
          paymentType = 'pay-per-job';
          typeLabel = 'Pay Per Job';
          const purchase = payPerJobByOrderId.get(orderId);
          if (purchase?.job_postings) {
            details = { jobId: purchase.job_postings.id, jobTitle: purchase.job_postings.title };
          }
        } else if (gatewayType === 'zone_addon') {
          paymentType = 'zone-addon';
          typeLabel = 'Zone Addon';
          const addon = addonByPaymentId.get(p.id);
          if (addon?.addons) {
            details = { addonId: addon.addons.id, addonName: addon.addons.name };
          }
        } else if (p.active_subscriptions?.available_services) {
          paymentType = 'plan';
          typeLabel = 'Plan Purchase';
          details = {
            planId: p.active_subscriptions.available_services.id,
            planName: p.active_subscriptions.available_services.name,
            planPrice: p.active_subscriptions.available_services.price
          };
        } else if (p.available_services) {
          paymentType = 'plan';
          typeLabel = 'Plan Purchase';
          details = { planId: p.available_services.id, planName: p.available_services.name, planPrice: p.available_services.price };
        }

        return {
          id: p.id,
          type: paymentType,
          typeLabel,
          amount: p.amount,
          currency: p.currency,
          status: p.status,
          paymentDate: p.payment_date,
          paymentMethod: p.payment_method,
          razorpayOrderId: orderId || null,
          razorpayPaymentId: p.razorpay_payment_id || null,
          transactionId: p.razorpay_payment_id || p.transaction_id,
          details
        };
      }),
      applications: (applications || []).map((app: any) => ({
        id: app.id,
        status: app.status,
        createdAt: app.created_at,
        reviewedAt: app.reviewed_at,
        rejectionReason: app.rejection_reason,
        job: app.job_postings
          ? {
              id: app.job_postings.id,
              title: app.job_postings.title,
              location: app.job_postings.location,
              jobType: app.job_postings.job_type,
              salaryRange: app.job_postings.salary_range,
              status: app.job_postings.status,
              company: app.job_postings.companies ? { id: app.job_postings.companies.id, name: app.job_postings.companies.name } : null
            }
          : null
      }))
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.assignStudentSubscription = async (req: Request, res: Response) => {
  try {
    const { studentId } = req.params as { studentId: string };
    const { serviceId } = req.body;

    if (!isValidUuid(studentId)) {
      return res.status(400).json({ error: 'Invalid student ID format' });
    }
    if (!serviceId || !isValidUuid(serviceId)) {
      return res.status(400).json({ error: 'Valid service ID is required' });
    }

    const { data: student } = await supabase.from('students').select('*').eq('id', studentId).maybeSingle();
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const { data: service } = await supabase.from('available_services').select('*').eq('id', serviceId).maybeSingle();
    if (!service) return res.status(404).json({ error: 'Subscription plan not found' });

    // Mark current subscription as exhausted if exists and is not free
    if (student.current_subscription_id) {
      const { data: currentSub } = await supabase
        .from('active_subscriptions')
        .select('id, service_id')
        .eq('id', student.current_subscription_id)
        .maybeSingle();

      if (currentSub) {
        const { data: currentService } = await supabase.from('available_services').select('tier').eq('id', currentSub.service_id).maybeSingle();
        if (currentService?.tier !== 'free') {
          const { error: exhaustError } = await supabase.from('active_subscriptions').update({ status: 'exhausted', auto_renew: false }).eq('id', currentSub.id);
          if (exhaustError) {
            // Not fatal to this request - the student's current_subscription_id
            // gets repointed to the new subscription below either way, this
            // only affects housekeeping on the old row - but must be logged.
            console.error('[assignStudentSubscription] Failed to mark previous subscription exhausted', { subscriptionId: currentSub.id, error: exhaustError });
          }
        }
      }
    }

    const { data: subscription, error } = await supabase
      .from('active_subscriptions')
      .insert({
        student_id: student.id,
        service_id: service.id,
        start_date: new Date().toISOString(),
        end_date: null,
        status: 'active',
        auto_renew: false,
        applications_used: 0
      })
      .select()
      .single();
    if (error) throw error;

    const { error: linkError } = await supabase.from('students').update({ current_subscription_id: subscription.id, subscription_tier: service.tier }).eq('id', student.id);
    if (linkError) throw linkError;

    res.json({
      success: true,
      message: `Student assigned to ${service.name} plan`,
      subscription: {
        id: subscription.id,
        status: subscription.status,
        startDate: subscription.start_date,
        endDate: subscription.end_date,
        autoRenew: subscription.auto_renew,
        plan: {
          id: service.id,
          name: service.name,
          description: service.description,
          price: service.price,
          billingCycle: service.billing_cycle,
          tier: service.tier
        }
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.setStudentActiveStatus = async (req: Request, res: Response) => {
  try {
    const { studentId } = req.params as { studentId: string };
    const { isActive } = req.body;

    const { data: student } = await supabase.from('students').select('user_id').eq('id', studentId).maybeSingle();
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const { error: statusUpdateError } = await supabase.from('users').update({ is_active: isActive }).eq('id', student.user_id);
    if (statusUpdateError) throw statusUpdateError;
    res.json({ success: true, isActive });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

// ─── Subscription Plan Management ──────────────────────────────────────────

exports.getSubscriptionPlans = async (req: Request, res: Response) => {
  try {
    const { includeInactive = 'true' } = req.query as Record<string, any>;

    let query = supabase.from('available_services').select('*');
    if (includeInactive !== 'true') query = query.eq('is_active', true);

    const { data: plans, error } = await query.order('display_order', { ascending: true }).order('created_at', { ascending: false });
    if (error) throw error;

    res.json({ plans: (plans || []).map(buildSubscriptionPlanResponse) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getSubscriptionPlan = async (req: Request, res: Response) => {
  try {
    const { planId } = req.params as { planId: string };
    if (!isValidUuid(planId)) {
      return res.status(400).json({ error: 'Invalid plan ID format' });
    }

    const { data: plan } = await supabase.from('available_services').select('*').eq('id', planId).maybeSingle();
    if (!plan) return res.status(404).json({ error: 'Subscription plan not found' });

    res.json(buildSubscriptionPlanResponse(plan));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.createSubscriptionPlan = async (req: Request, res: Response) => {
  try {
    const {
      name,
      description,
      maxApplications,
      price,
      priceINR,
      priceUSD,
      currency,
      discount,
      features,
      badge,
      displayOrder,
      resumeDownloads,
      videoViews,
      prioritySupport,
      profileBoost,
      applicationHighlight,
      allZonesIncluded,
      isActive
    } = req.body;

    if (!name || name.trim().length < 2) {
      return res.status(400).json({ error: 'Name must be at least 2 characters' });
    }
    if (!description || description.trim().length < 10) {
      return res.status(400).json({ error: 'Description must be at least 10 characters' });
    }

    const inrPrice = priceINR ?? price;
    if (inrPrice === undefined || inrPrice < 0) {
      return res.status(400).json({ error: 'Price (INR) must be a non-negative number' });
    }
    if (priceUSD !== undefined && priceUSD !== null && priceUSD < 0) {
      return res.status(400).json({ error: 'Price (USD) must be a non-negative number' });
    }
    if (currency && !CURRENCIES.includes(currency)) {
      return res.status(400).json({ error: `Currency must be one of: ${CURRENCIES.join(', ')}` });
    }

    const normalizedMaxApplications = maxApplications === '' || maxApplications === undefined ? null : maxApplications;
    if (normalizedMaxApplications !== null && normalizedMaxApplications < 1) {
      return res.status(400).json({ error: 'maxApplications must be at least 1, or omit it for unlimited' });
    }

    const { data: plan, error } = await supabase
      .from('available_services')
      .insert({
        name: name.trim(),
        description: description.trim(),
        max_applications: normalizedMaxApplications,
        price: inrPrice,
        price_inr: inrPrice,
        price_usd: priceUSD ?? 0,
        currency: currency || 'INR',
        billing_cycle: 'one-time',
        discount: discount || 0,
        features: features || [],
        badge: badge?.trim() || null,
        display_order: displayOrder || 0,
        resume_downloads: resumeDownloads || null,
        video_views: videoViews || null,
        priority_support: prioritySupport || false,
        profile_boost: profileBoost || false,
        application_highlight: applicationHighlight || false,
        all_zones_included: allZonesIncluded || false,
        is_active: isActive !== false
      })
      .select()
      .single();
    if (error) throw error;

    res.status(201).json(buildSubscriptionPlanResponse(plan));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.updateSubscriptionPlan = async (req: Request, res: Response) => {
  try {
    const { planId } = req.params as { planId: string };
    if (!isValidUuid(planId)) {
      return res.status(400).json({ error: 'Invalid plan ID format' });
    }

    const { data: plan } = await supabase.from('available_services').select('*').eq('id', planId).maybeSingle();
    if (!plan) return res.status(404).json({ error: 'Subscription plan not found' });

    const {
      name,
      description,
      maxApplications,
      price,
      priceINR,
      priceUSD,
      currency,
      discount,
      features,
      badge,
      displayOrder,
      resumeDownloads,
      videoViews,
      prioritySupport,
      profileBoost,
      applicationHighlight,
      allZonesIncluded,
      isActive
    } = req.body;

    const updates: Record<string, any> = {};

    if (name !== undefined) {
      if (name.trim().length < 2) return res.status(400).json({ error: 'Name must be at least 2 characters' });
      updates.name = name.trim();
    }

    if (description !== undefined) {
      if (description.trim().length < 10) return res.status(400).json({ error: 'Description must be at least 10 characters' });
      updates.description = description.trim();
    }

    if (price !== undefined || priceINR !== undefined) {
      const newPrice = priceINR ?? price;
      if (newPrice < 0) return res.status(400).json({ error: 'Price (INR) must be a non-negative number' });
      updates.price = newPrice;
      updates.price_inr = newPrice;
    }

    if (priceUSD !== undefined) {
      if (priceUSD !== null && priceUSD < 0) return res.status(400).json({ error: 'Price (USD) must be a non-negative number' });
      updates.price_usd = priceUSD;
    }

    if (currency !== undefined) {
      if (!CURRENCIES.includes(currency)) return res.status(400).json({ error: `Currency must be one of: ${CURRENCIES.join(', ')}` });
      updates.currency = currency;
    }

    if (maxApplications !== undefined) {
      if (plan.tier === 'free') {
        updates.max_applications = 2;
      } else {
        const normalizedMax = maxApplications === '' ? null : maxApplications;
        if (normalizedMax !== null && normalizedMax < 1) {
          return res.status(400).json({ error: 'maxApplications must be at least 1, or null for unlimited' });
        }
        updates.max_applications = normalizedMax;
      }
    }

    if (discount !== undefined) updates.discount = discount;
    if (features !== undefined) updates.features = features;
    if (badge !== undefined) updates.badge = badge?.trim() || null;
    if (displayOrder !== undefined) updates.display_order = displayOrder;
    if (resumeDownloads !== undefined) updates.resume_downloads = resumeDownloads || null;
    if (videoViews !== undefined) updates.video_views = videoViews || null;
    if (prioritySupport !== undefined) updates.priority_support = prioritySupport;
    if (profileBoost !== undefined) updates.profile_boost = profileBoost;
    if (applicationHighlight !== undefined) updates.application_highlight = applicationHighlight;
    if (allZonesIncluded !== undefined) updates.all_zones_included = allZonesIncluded;
    if (isActive !== undefined) updates.is_active = isActive;

    const { data: updated, error } = await supabase.from('available_services').update(updates as any).eq('id', planId).select().single();
    if (error) throw error;

    res.json(buildSubscriptionPlanResponse(updated));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.deleteSubscriptionPlan = async (req: Request, res: Response) => {
  try {
    const { planId } = req.params as { planId: string };
    if (!isValidUuid(planId)) {
      return res.status(400).json({ error: 'Invalid plan ID format' });
    }

    const { data: plan } = await supabase.from('available_services').select('id').eq('id', planId).maybeSingle();
    if (!plan) return res.status(404).json({ error: 'Subscription plan not found' });

    // Soft delete by setting is_active to false
    const { error: deactivateError } = await supabase.from('available_services').update({ is_active: false }).eq('id', planId);
    if (deactivateError) throw deactivateError;

    res.json({ success: true, message: 'Subscription plan deactivated' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

// ─── Free Tier Configuration ────────────────────────────────────────────────

exports.getFreeTierConfig = async (_req: Request, res: Response) => {
  try {
    const [features, resumeDownloads, videoViews] = await Promise.all([
      getConfigValue(CONFIG_KEYS.FREE_TIER_FEATURES, []),
      getConfigValue(CONFIG_KEYS.FREE_TIER_RESUME_DOWNLOADS, null),
      getConfigValue(CONFIG_KEYS.FREE_TIER_VIDEO_VIEWS, null)
    ]);

    res.json({ maxApplications: 2, features, resumeDownloadsPerMonth: resumeDownloads, videoViewsPerMonth: videoViews });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.updateFreeTierConfig = async (req: AuthedRequest, res: Response) => {
  try {
    const { maxApplications, features, resumeDownloadsPerMonth, videoViewsPerMonth } = req.body;
    const updates: Promise<any>[] = [];

    if (maxApplications !== undefined) {
      if (maxApplications !== 2) {
        return res.status(400).json({ error: 'Free tier max applications is fixed at 2' });
      }
      updates.push(
        setConfigValue(CONFIG_KEYS.FREE_TIER_MAX_APPLICATIONS, 2, 'Maximum applications allowed for free tier', req.user!.userId)
      );
    }

    if (features !== undefined) {
      if (!Array.isArray(features)) {
        return res.status(400).json({ error: 'Features must be an array' });
      }
      updates.push(setConfigValue(CONFIG_KEYS.FREE_TIER_FEATURES, features, 'Features available for free tier', req.user!.userId));
    }

    if (resumeDownloadsPerMonth !== undefined) {
      updates.push(
        setConfigValue(CONFIG_KEYS.FREE_TIER_RESUME_DOWNLOADS, resumeDownloadsPerMonth, 'Resume downloads per month for free tier', req.user!.userId)
      );
    }

    if (videoViewsPerMonth !== undefined) {
      updates.push(
        setConfigValue(CONFIG_KEYS.FREE_TIER_VIDEO_VIEWS, videoViewsPerMonth, 'Video views per month for free tier', req.user!.userId)
      );
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    await Promise.all(updates);

    const [updatedFeatures, updatedResumeDownloads, updatedVideoViews] = await Promise.all([
      getConfigValue(CONFIG_KEYS.FREE_TIER_FEATURES, []),
      getConfigValue(CONFIG_KEYS.FREE_TIER_RESUME_DOWNLOADS, null),
      getConfigValue(CONFIG_KEYS.FREE_TIER_VIDEO_VIEWS, null)
    ]);

    res.json({
      maxApplications: 2,
      features: updatedFeatures,
      resumeDownloadsPerMonth: updatedResumeDownloads,
      videoViewsPerMonth: updatedVideoViews
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

// ─── Zone Management ────────────────────────────────────────────────────────

exports.getZones = async (_req: Request, res: Response) => {
  try {
    const { data: zones } = await supabase.from('zones').select('*').order('name', { ascending: true });

    const zonesWithCountries = await Promise.all(
      (zones || []).map(async (zone) => {
        const { data: countries } = await supabase
          .from('zone_countries')
          .select('id, country_name')
          .eq('zone_id', zone.id)
          .order('country_name', { ascending: true });

        return {
          id: zone.id,
          name: zone.name,
          description: zone.description,
          countries: (countries || []).map((c) => ({ id: c.id, name: c.country_name })),
          countryCount: (countries || []).length
        };
      })
    );

    res.json({ zones: zonesWithCountries });
  } catch (error) {
    console.error('Get zones error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.createZone = async (req: Request, res: Response) => {
  try {
    const { name, description } = req.body;
    if (!name || !description) {
      return res.status(400).json({ error: 'Name and description are required' });
    }

    const { data: existingZone } = await supabase.from('zones').select('id').eq('name', name.trim()).maybeSingle();
    if (existingZone) {
      return res.status(409).json({ error: 'Zone with this name already exists' });
    }

    const { data: zone, error } = await supabase.from('zones').insert({ name: name.trim(), description: description.trim() }).select().single();
    if (error) throw error;

    res.status(201).json({ id: zone.id, name: zone.name, description: zone.description, countries: [], countryCount: 0 });
  } catch (error) {
    console.error('Create zone error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.updateZone = async (req: Request, res: Response) => {
  try {
    const { zoneId } = req.params as { zoneId: string };
    const { name, description } = req.body;

    if (!isValidUuid(zoneId)) {
      return res.status(400).json({ error: 'Invalid zone ID' });
    }

    const { data: zone } = await supabase.from('zones').select('*').eq('id', zoneId).maybeSingle();
    if (!zone) return res.status(404).json({ error: 'Zone not found' });

    const updates: Record<string, any> = {};

    if (name !== undefined) {
      const { data: existingZone } = await supabase.from('zones').select('id').eq('name', name.trim()).neq('id', zoneId).maybeSingle();
      if (existingZone) {
        return res.status(409).json({ error: 'Zone with this name already exists' });
      }
      updates.name = name.trim();
    }

    if (description !== undefined) {
      updates.description = description.trim();
    }

    const { data: updated, error } = await supabase.from('zones').update(updates as any).eq('id', zoneId).select().single();
    if (error) throw error;

    res.json({ id: updated.id, name: updated.name, description: updated.description });
  } catch (error) {
    console.error('Update zone error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.deleteZone = async (req: Request, res: Response) => {
  try {
    const { zoneId } = req.params as { zoneId: string };
    if (!isValidUuid(zoneId)) {
      return res.status(400).json({ error: 'Invalid zone ID' });
    }

    const { count: planCount } = await supabase.from('plan_zones').select('*', { count: 'exact', head: true }).eq('zone_id', zoneId);
    if ((planCount ?? 0) > 0) {
      return res.status(400).json({ error: 'Cannot delete zone that is assigned to plans', planCount });
    }

    const { data: countries } = await supabase.from('zone_countries').select('id').eq('zone_id', zoneId);
    const countryIds = (countries || []).map((c) => c.id);

    let jobCount = 0;
    if (countryIds.length) {
      const { count } = await supabase.from('job_postings').select('*', { count: 'exact', head: true }).in('country_id', countryIds);
      jobCount = count ?? 0;
    }
    if (jobCount > 0) {
      return res.status(400).json({ error: 'Cannot delete zone with countries that have jobs assigned', jobCount });
    }

    const { error: deleteCountriesError } = await supabase.from('zone_countries').delete().eq('zone_id', zoneId);
    if (deleteCountriesError) throw deleteCountriesError;
    const { error: deleteZoneError } = await supabase.from('zones').delete().eq('id', zoneId);
    if (deleteZoneError) throw deleteZoneError;

    res.json({ success: true });
  } catch (error) {
    console.error('Delete zone error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.addCountryToZone = async (req: Request, res: Response) => {
  try {
    const { zoneId } = req.params as { zoneId: string };
    const { countryName } = req.body;

    if (!isValidUuid(zoneId)) {
      return res.status(400).json({ error: 'Invalid zone ID' });
    }
    if (!countryName || typeof countryName !== 'string') {
      return res.status(400).json({ error: 'Country name is required' });
    }

    const { data: zone } = await supabase.from('zones').select('id').eq('id', zoneId).maybeSingle();
    if (!zone) return res.status(404).json({ error: 'Zone not found' });

    const { data: existingCountry } = await supabase.from('zone_countries').select('zone_id').eq('country_name', countryName.trim()).maybeSingle();
    if (existingCountry) {
      return res.status(409).json({ error: 'Country already exists', existingZoneId: existingCountry.zone_id });
    }

    const { data: country, error } = await supabase
      .from('zone_countries')
      .insert({ zone_id: zoneId, country_name: countryName.trim() })
      .select()
      .single();
    if (error) throw error;

    res.status(201).json({ id: country.id, name: country.country_name, zoneId: country.zone_id });
  } catch (error) {
    console.error('Add country to zone error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.removeCountryFromZone = async (req: Request, res: Response) => {
  try {
    const { zoneId, countryId } = req.params as { zoneId: string; countryId: string };

    if (!isValidUuid(zoneId) || !isValidUuid(countryId)) {
      return res.status(400).json({ error: 'Invalid zone or country ID' });
    }

    const { data: country } = await supabase.from('zone_countries').select('id').eq('id', countryId).eq('zone_id', zoneId).maybeSingle();
    if (!country) return res.status(404).json({ error: 'Country not found in this zone' });

    const { count: jobCount } = await supabase.from('job_postings').select('*', { count: 'exact', head: true }).eq('country_id', countryId);
    if ((jobCount ?? 0) > 0) {
      return res.status(400).json({ error: 'Cannot remove country that has jobs assigned', jobCount });
    }

    const { error: deleteCountryError } = await supabase.from('zone_countries').delete().eq('id', countryId);
    if (deleteCountryError) throw deleteCountryError;

    res.json({ success: true });
  } catch (error) {
    console.error('Remove country from zone error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getPlanZones = async (req: Request, res: Response) => {
  try {
    const { planId } = req.params as { planId: string };
    if (!isValidUuid(planId)) {
      return res.status(400).json({ error: 'Invalid plan ID' });
    }

    const { data: plan } = await supabase.from('available_services').select('id, name, all_zones_included').eq('id', planId).maybeSingle();
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    const { data: planZones } = await supabase.from('plan_zones').select('zones ( id, name, description )').eq('plan_id', planId);

    const zones = (planZones || []).filter((pz: any) => pz.zones).map((pz: any) => ({ id: pz.zones.id, name: pz.zones.name, description: pz.zones.description }));

    res.json({ planId, planName: plan.name, allZonesIncluded: plan.all_zones_included, zones });
  } catch (error) {
    console.error('Get plan zones error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.setPlanZones = async (req: Request, res: Response) => {
  try {
    const { planId } = req.params as { planId: string };
    const { zoneIds, allZonesIncluded } = req.body;

    if (!isValidUuid(planId)) {
      return res.status(400).json({ error: 'Invalid plan ID' });
    }

    const { data: plan } = await supabase.from('available_services').select('*').eq('id', planId).maybeSingle();
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    let allZonesFlag = plan.all_zones_included;
    if (typeof allZonesIncluded === 'boolean') {
      const { error: flagUpdateError } = await supabase.from('available_services').update({ all_zones_included: allZonesIncluded }).eq('id', planId);
      if (flagUpdateError) throw flagUpdateError;
      allZonesFlag = allZonesIncluded;
    }

    if (allZonesFlag) {
      const { error: clearZonesError } = await supabase.from('plan_zones').delete().eq('plan_id', planId);
      if (clearZonesError) throw clearZonesError;
      return res.json({ planId, planName: plan.name, allZonesIncluded: true, zones: [] });
    }

    if (!Array.isArray(zoneIds)) {
      return res.status(400).json({ error: 'zoneIds must be an array' });
    }

    const validZoneIds = zoneIds.filter((id: any) => isValidUuid(id));
    const { data: zones } = validZoneIds.length
      ? await supabase.from('zones').select('*').in('id', validZoneIds)
      : { data: [] as any[] };

    if ((zones || []).length !== validZoneIds.length) {
      return res.status(400).json({ error: 'Some zone IDs are invalid' });
    }

    const { error: replaceZonesError } = await supabase.from('plan_zones').delete().eq('plan_id', planId);
    if (replaceZonesError) throw replaceZonesError;

    if (validZoneIds.length > 0) {
      const rows = validZoneIds.map((zoneId: string) => ({ plan_id: planId, zone_id: zoneId }));
      const { error: insertZonesError } = await supabase.from('plan_zones').insert(rows);
      if (insertZonesError) throw insertZonesError;
    }

    res.json({
      planId,
      planName: plan.name,
      allZonesIncluded: allZonesFlag,
      zones: (zones || []).map((z) => ({ id: z.id, name: z.name, description: z.description }))
    });
  } catch (error) {
    console.error('Set plan zones error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// ─── Addon Management ───────────────────────────────────────────────────────

exports.getAddons = async (_req: Request, res: Response) => {
  try {
    const { data: addons, error } = await supabase.from('addons').select('*').order('type', { ascending: true }).order('name', { ascending: true });
    if (error) throw error;

    const formattedAddons = (addons || []).map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      priceINR: a.price_inr,
      priceUSD: a.price_usd,
      zoneCount: a.zone_count,
      jobCreditCount: a.job_credit_count,
      unlockAllZones: a.unlock_all_zones,
      createdAt: a.created_at
    }));

    res.json({ addons: formattedAddons });
  } catch (error) {
    console.error('Get addons error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.createAddon = async (req: Request, res: Response) => {
  try {
    const { name, type, priceINR, priceUSD, zoneCount, jobCreditCount, unlockAllZones } = req.body;

    if (!name || !type) {
      return res.status(400).json({ error: 'Name and type are required' });
    }
    if (!['zone', 'jobs'].includes(type)) {
      return res.status(400).json({ error: 'Type must be zone or jobs' });
    }

    const { data: existingAddon } = await supabase.from('addons').select('id').eq('name', name.trim()).maybeSingle();
    if (existingAddon) {
      return res.status(409).json({ error: 'Addon with this name already exists' });
    }

    const addonData: Record<string, any> = {
      name: name.trim(),
      type,
      price_inr: priceINR || null,
      price_usd: priceUSD || null
    };

    if (type === 'zone') {
      addonData.unlock_all_zones = unlockAllZones || false;
      if (!unlockAllZones) {
        addonData.zone_count = zoneCount;
      }
    } else if (type === 'jobs') {
      addonData.job_credit_count = jobCreditCount;
    }

    const { data: addon, error } = await supabase.from('addons').insert(addonData).select().single();
    if (error) {
      if (error.code === '23514') {
        // Postgres CHECK constraint violation
        return res.status(400).json({ error: error.message });
      }
      throw error;
    }

    res.status(201).json({
      id: addon.id,
      name: addon.name,
      type: addon.type,
      priceINR: addon.price_inr,
      priceUSD: addon.price_usd,
      zoneCount: addon.zone_count,
      jobCreditCount: addon.job_credit_count,
      unlockAllZones: addon.unlock_all_zones
    });
  } catch (error: any) {
    console.error('Create addon error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.updateAddon = async (req: Request, res: Response) => {
  try {
    const { addonId } = req.params as { addonId: string };
    const { name, priceINR, priceUSD, zoneCount, jobCreditCount, unlockAllZones } = req.body;

    if (!isValidUuid(addonId)) {
      return res.status(400).json({ error: 'Invalid addon ID' });
    }

    const { data: addon } = await supabase.from('addons').select('*').eq('id', addonId).maybeSingle();
    if (!addon) return res.status(404).json({ error: 'Addon not found' });

    const updates: Record<string, any> = {};

    if (name !== undefined) {
      const { data: existingAddon } = await supabase.from('addons').select('id').eq('name', name.trim()).neq('id', addonId).maybeSingle();
      if (existingAddon) {
        return res.status(409).json({ error: 'Addon with this name already exists' });
      }
      updates.name = name.trim();
    }

    if (priceINR !== undefined) updates.price_inr = priceINR;
    if (priceUSD !== undefined) updates.price_usd = priceUSD;

    if (addon.type === 'zone') {
      if (unlockAllZones !== undefined) updates.unlock_all_zones = unlockAllZones;
      const effectiveUnlockAll = unlockAllZones !== undefined ? unlockAllZones : addon.unlock_all_zones;
      if (zoneCount !== undefined && !effectiveUnlockAll) updates.zone_count = zoneCount;
    } else if (addon.type === 'jobs') {
      if (jobCreditCount !== undefined) updates.job_credit_count = jobCreditCount;
    }

    const { data: updated, error } = await supabase.from('addons').update(updates as any).eq('id', addonId).select().single();
    if (error) {
      if (error.code === '23514') {
        return res.status(400).json({ error: error.message });
      }
      throw error;
    }

    res.json({
      id: updated.id,
      name: updated.name,
      type: updated.type,
      priceINR: updated.price_inr,
      priceUSD: updated.price_usd,
      zoneCount: updated.zone_count,
      jobCreditCount: updated.job_credit_count,
      unlockAllZones: updated.unlock_all_zones
    });
  } catch (error: any) {
    console.error('Update addon error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.deleteAddon = async (req: Request, res: Response) => {
  try {
    const { addonId } = req.params as { addonId: string };
    if (!isValidUuid(addonId)) {
      return res.status(400).json({ error: 'Invalid addon ID' });
    }

    const { count: purchaseCount } = await supabase.from('subscription_addons').select('*', { count: 'exact', head: true }).eq('addon_id', addonId);
    if ((purchaseCount ?? 0) > 0) {
      return res.status(400).json({ error: 'Cannot delete addon that has been purchased', purchaseCount });
    }

    const { error: deleteAddonError } = await supabase.from('addons').delete().eq('id', addonId);
    if (deleteAddonError) throw deleteAddonError;

    res.json({ success: true });
  } catch (error) {
    console.error('Delete addon error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};
