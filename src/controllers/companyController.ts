import { Request, Response } from 'express';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

import { getSupabaseClient } from '../lib/supabase/client';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createJobSchema, createDraftJobSchema, updateJobSchema, companyProfileSchema } = require('../utils/validation');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { JOB_STATUSES, JOB_TYPES } = require('../constants');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { uploadCompanyLogo, getPresignedUrl } = require('../services/mediaService');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const emailService = require('../services/emailService');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const notificationService = require('../services/notificationService');

import {
  applyCompanyProfileUpdates,
  buildCompanyProfileResponse,
  buildPublicCompanyProfile,
  getCachedPublicCompanyProfile,
  setCachedPublicCompanyProfile,
  invalidatePublicCompanyProfileCache
} from '../services/companyProfileService';

type AuthedRequest = Request & { user?: { userId: string; userType: string } };

const supabase = getSupabaseClient();

const COMPANY_REVERIFICATION_FIELDS = ['name', 'email', 'website', 'industry', 'size', 'founded_year'];
const VISIBLE_APPLICATION_STATUSES = ['reviewed', 'interview_scheduled', 'offer_extended', 'hired', 'rejected'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isValidUuid = (value: any): boolean => typeof value === 'string' && UUID_RE.test(value);

// Escapes Postgres ILIKE special characters (%, _, \) - equivalent to the old escapeRegex helper.
const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (c) => `\\${c}`);

// Check if email is taken by another user (excluding current company)
const isEmailTakenByOther = async (email: string, currentCompanyId: string): Promise<boolean> => {
  const normalizedEmail = email.toLowerCase().trim();

  const { data: student } = await supabase.from('students').select('id').eq('email', normalizedEmail).maybeSingle();
  if (student) return true;

  const { data: otherCompany } = await supabase
    .from('companies')
    .select('id')
    .eq('email', normalizedEmail)
    .neq('id', currentCompanyId)
    .maybeSingle();
  if (otherCompany) return true;

  if (process.env.ADMIN_EMAIL?.toLowerCase() === normalizedEmail) return true;

  return false;
};

const hasExplicitTimezoneInfo = (value: any): boolean => /(?:z|[+-]\d{2}:?\d{2})$/i.test(String(value || '').trim());

const isValidIanaTimezone = (value: any): boolean => {
  if (typeof value !== 'string' || !value.trim()) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value.trim() });
    return true;
  } catch {
    return false;
  }
};

const convertInterviewDateToUtc = ({
  interviewDateInput,
  interviewTimeZone
}: { interviewDateInput: any; interviewTimeZone: any }): { utcDate: Date | null; error: string | null } => {
  if (interviewDateInput === undefined || interviewDateInput === null || interviewDateInput === '') {
    return { utcDate: null, error: null };
  }

  if (typeof interviewDateInput !== 'string') {
    return { utcDate: null, error: 'interviewDate must be a string' };
  }

  const rawInterviewDate = interviewDateInput.trim();
  if (!rawInterviewDate) {
    return { utcDate: null, error: 'interviewDate must be a valid date-time value' };
  }

  let parsedDate;

  if (hasExplicitTimezoneInfo(rawInterviewDate)) {
    parsedDate = dayjs(rawInterviewDate);
  } else {
    if (!interviewTimeZone) {
      return { utcDate: null, error: 'interviewTimeZone is required when interviewDate has no timezone offset' };
    }
    if (!isValidIanaTimezone(interviewTimeZone)) {
      return { utcDate: null, error: 'interviewTimeZone must be a valid IANA timezone (e.g. Asia/Kolkata)' };
    }
    parsedDate = dayjs.tz(rawInterviewDate, interviewTimeZone.trim());
  }

  if (!parsedDate.isValid()) {
    return { utcDate: null, error: 'interviewDate must be a valid date-time value' };
  }

  return { utcDate: new Date(parsedDate.utc().toISOString()), error: null };
};

const getCompanyForUser = async (userId: string) => {
  const { data: company } = await supabase.from('companies').select('*').eq('user_id', userId).maybeSingle();
  return company;
};

exports.getDashboard = async (req: AuthedRequest, res: Response) => {
  try {
    const company = await getCompanyForUser(req.user!.userId);
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const { data: jobs } = await supabase.from('job_postings').select('id, status').eq('company_id', company.id);
    const jobList = jobs || [];
    const jobIds = jobList.map((j) => j.id);

    const jobStats = {
      totalJobs: jobList.length,
      activeJobs: jobList.filter((j) => j.status === 'approved').length,
      pendingJobs: jobList.filter((j) => j.status === 'pending').length,
      draftJobs: jobList.filter((j) => j.status === 'draft').length,
      unpublishedJobs: jobList.filter((j) => j.status === 'unpublished').length
    };

    let appStats = { totalApplications: 0, reviewedApplications: 0 };
    if (jobIds.length) {
      const { data: apps } = await supabase
        .from('applications')
        .select('status')
        .in('job_posting_id', jobIds)
        .in('status', VISIBLE_APPLICATION_STATUSES)
        .not('reviewed_at', 'is', null);

      const appList = apps || [];
      appStats = {
        totalApplications: appList.length,
        reviewedApplications: appList.filter((a) => a.status === 'reviewed').length
      };
    }

    res.json({ ...jobStats, ...appStats });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getJobs = async (req: AuthedRequest, res: Response) => {
  try {
    const { status, search, jobType, location, page = 1, limit = 10 } = req.query as Record<string, any>;

    const company = await getCompanyForUser(req.user!.userId);
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

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

    let query = supabase.from('job_postings').select('*', { count: 'exact' }).eq('company_id', company.id);
    if (status) query = query.eq('status', status);
    if (jobType) query = query.eq('job_type', jobType);
    if (location) query = query.ilike('location', `%${escapeLike(location)}%`);
    if (search) {
      const escaped = escapeLike(search);
      query = query.or(`title.ilike.%${escaped}%,description.ilike.%${escaped}%`);
    }

    const { data: jobs, count, error } = await query.order('created_at', { ascending: false }).range(from, to);
    if (error) throw error;

    res.json({
      jobs: jobs || [],
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: count ?? 0,
        totalPages: Math.ceil((count ?? 0) / limitNum)
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.createJob = async (req: AuthedRequest, res: Response) => {
  try {
    const body = req.body || {};
    const requestedStatus = body.status === 'draft' ? 'draft' : 'pending';

    const parsed = requestedStatus === 'draft' ? createDraftJobSchema.parse(body) : createJobSchema.parse(body);

    const company = await getCompanyForUser(req.user!.userId);
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const title = parsed.title || null;
    const description = parsed.description || null;
    const requirements = Array.isArray(parsed.requirements)
      ? (parsed.requirements.length > 0 ? parsed.requirements.join(', ') : null)
      : (parsed.requirements || null);
    const location = parsed.location || null;
    const jobType = parsed.jobType || null;
    const salaryRange = parsed.salaryRange || null;
    const deadline = parsed.deadline ? new Date(parsed.deadline).toISOString() : null;
    const countryId = parsed.countryId || null;

    if (countryId) {
      if (!isValidUuid(countryId)) {
        return res.status(400).json({ error: 'Invalid country ID format' });
      }
      const { data: country } = await supabase.from('zone_countries').select('id').eq('id', countryId).maybeSingle();
      if (!country) {
        return res.status(400).json({ error: 'Country not found' });
      }
    }

    const { data: job, error } = await supabase
      .from('job_postings')
      .insert({
        company_id: company.id,
        title,
        description,
        requirements,
        location,
        job_type: jobType,
        salary_range: salaryRange,
        deadline,
        country_id: countryId || null,
        status: requestedStatus
      })
      .select()
      .single();
    if (error || !job) throw error || new Error('Failed to create job');

    res.status(201).json(job);

    if (job.status === 'pending') {
      notificationService
        .notifyAdminsNewJobPending({ jobId: job.id, companyName: company.name })
        .catch((error: unknown) => console.error('Admin notification error (new job pending):', error));
    }
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: error.issues[0].message });
    }
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

    const company = await getCompanyForUser(req.user!.userId);
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const { data: job } = await supabase.from('job_postings').select('*').eq('id', jobId).maybeSingle();
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    if (job.company_id !== company.id) {
      return res.status(403).json({ error: 'You can only view your own job postings' });
    }

    res.json(job);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.updateJob = async (req: AuthedRequest, res: Response) => {
  try {
    const { jobId } = req.params as { jobId: string };
    if (!isValidUuid(jobId)) {
      return res.status(400).json({ error: 'Invalid job ID format' });
    }

    const company = await getCompanyForUser(req.user!.userId);
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const { data: job } = await supabase.from('job_postings').select('*').eq('id', jobId).maybeSingle();
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    if (job.company_id !== company.id) {
      return res.status(403).json({ error: 'You can only edit your own job postings' });
    }

    // Handle close request
    if (req.body.status === 'closed') {
      if (job.status === 'closed') return res.status(400).json({ error: 'Job is already closed' });
      if (job.status === 'draft') return res.status(400).json({ error: 'Draft jobs cannot be closed' });

      const { data: updatedJob } = await supabase.from('job_postings').update({ status: 'closed' }).eq('id', jobId).select().single();

      await supabase
        .from('applications')
        .update({ status: 'rejected', rejection_reason: 'Job posting has been closed' })
        .eq('job_posting_id', jobId)
        .in('status', ['pending', 'reviewed']);

      return res.json(updatedJob);
    }

    // Handle unpublish request
    if (req.body.status === 'unpublished') {
      if (job.status !== 'approved') {
        return res.status(400).json({ error: 'Only approved jobs can be unpublished' });
      }
      const { data: updatedJob } = await supabase.from('job_postings').update({ status: 'unpublished' }).eq('id', jobId).select().single();
      return res.json(updatedJob);
    }

    // Handle republish request
    if ((req.body.status === 'approved' || req.body.status === 'pending') && job.status === 'unpublished') {
      const { data: updatedJob } = await supabase
        .from('job_postings')
        .update({ status: 'approved', approved_at: new Date().toISOString() })
        .eq('id', jobId)
        .select()
        .single();
      return res.json(updatedJob);
    }

    if (job.status !== 'pending' && job.status !== 'draft') {
      return res.status(403).json({ error: 'Can only edit jobs that are in draft or pending approval' });
    }

    const wantsToSubmit = req.body.status === 'pending' && job.status === 'draft';

    const parsed = wantsToSubmit
      ? updateJobSchema.parse(req.body)
      : (job.status === 'draft' ? createDraftJobSchema.partial().parse(req.body) : updateJobSchema.parse(req.body));

    const updateFields: Record<string, any> = {};
    if (parsed.title !== undefined) updateFields.title = parsed.title;
    if (parsed.description !== undefined) updateFields.description = parsed.description;
    if (parsed.requirements !== undefined) updateFields.requirements = parsed.requirements;
    if (parsed.location !== undefined) updateFields.location = parsed.location;
    if (parsed.jobType !== undefined) updateFields.job_type = parsed.jobType;
    if (parsed.salaryRange !== undefined) updateFields.salary_range = parsed.salaryRange;
    if (parsed.deadline !== undefined) updateFields.deadline = parsed.deadline ? new Date(parsed.deadline).toISOString() : null;

    if (parsed.countryId !== undefined) {
      if (parsed.countryId === null) {
        updateFields.country_id = null;
      } else {
        if (!isValidUuid(parsed.countryId)) {
          return res.status(400).json({ error: 'Invalid country ID format' });
        }
        const { data: country } = await supabase.from('zone_countries').select('id').eq('id', parsed.countryId).maybeSingle();
        if (!country) {
          return res.status(400).json({ error: 'Country not found' });
        }
        updateFields.country_id = parsed.countryId;
      }
    }

    if (wantsToSubmit) {
      const merged = {
        title: updateFields.title ?? job.title,
        description: updateFields.description ?? job.description,
        requirements: updateFields.requirements ?? job.requirements,
        location: updateFields.location ?? job.location,
        jobType: updateFields.job_type ?? job.job_type,
        salaryRange: updateFields.salary_range ?? job.salary_range,
        deadline: updateFields.deadline ?? job.deadline
      };

      if (!merged.title || merged.title.length < 5) {
        return res.status(400).json({ error: 'Title must be at least 5 characters to submit for review' });
      }
      if (!merged.description || merged.description.length < 50) {
        return res.status(400).json({ error: 'Description must be at least 50 characters to submit for review' });
      }
      if (!merged.requirements) {
        return res.status(400).json({ error: 'Requirements are required to submit for review' });
      }
      if (!merged.location || merged.location.length < 2) {
        return res.status(400).json({ error: 'Location is required to submit for review' });
      }
      if (!merged.jobType) {
        return res.status(400).json({ error: 'Job type is required to submit for review' });
      }
      if (!merged.salaryRange) {
        return res.status(400).json({ error: 'Salary range is required to submit for review' });
      }
      if (!merged.deadline) {
        return res.status(400).json({ error: 'Application deadline is required to submit for review' });
      }
      if (new Date(merged.deadline) <= new Date()) {
        return res.status(400).json({ error: 'Deadline must be in the future' });
      }

      updateFields.status = 'pending';
    }

    const { data: updatedJob, error } = await supabase.from('job_postings').update(updateFields as any).eq('id', jobId).select().single();
    if (error) throw error;

    res.json(updatedJob);

    if (wantsToSubmit && updatedJob.status === 'pending') {
      notificationService
        .notifyAdminsNewJobPending({ jobId: updatedJob.id, companyName: company.name })
        .catch((error: unknown) => console.error('Admin notification error (draft submitted for review):', error));
    }
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: error.issues[0].message });
    }
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.unpublishJob = async (req: AuthedRequest, res: Response) => {
  try {
    const { jobId } = req.params as { jobId: string };
    if (!isValidUuid(jobId)) {
      return res.status(400).json({ error: 'Invalid job ID format' });
    }

    const company = await getCompanyForUser(req.user!.userId);
    if (!company) return res.status(404).json({ error: 'Company not found' });

    const { data: job } = await supabase.from('job_postings').select('*').eq('id', jobId).maybeSingle();
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.company_id !== company.id) {
      return res.status(403).json({ error: 'You can only manage your own job postings' });
    }
    if (job.status !== 'approved') {
      return res.status(400).json({ error: 'Only approved jobs can be unpublished' });
    }

    const { data: updatedJob } = await supabase.from('job_postings').update({ status: 'unpublished' }).eq('id', jobId).select().single();
    res.json(updatedJob);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.republishJob = async (req: AuthedRequest, res: Response) => {
  try {
    const { jobId } = req.params as { jobId: string };
    if (!isValidUuid(jobId)) {
      return res.status(400).json({ error: 'Invalid job ID format' });
    }

    const company = await getCompanyForUser(req.user!.userId);
    if (!company) return res.status(404).json({ error: 'Company not found' });

    const { data: job } = await supabase.from('job_postings').select('*').eq('id', jobId).maybeSingle();
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.company_id !== company.id) {
      return res.status(403).json({ error: 'You can only manage your own job postings' });
    }
    if (job.status !== 'unpublished') {
      return res.status(400).json({ error: 'Only unpublished jobs can be republished' });
    }

    const { data: updatedJob } = await supabase
      .from('job_postings')
      .update({ status: 'approved', approved_at: new Date().toISOString() })
      .eq('id', jobId)
      .select()
      .single();
    res.json(updatedJob);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.closeJob = async (req: AuthedRequest, res: Response) => {
  try {
    const { jobId } = req.params as { jobId: string };
    if (!isValidUuid(jobId)) {
      return res.status(400).json({ error: 'Invalid job ID format' });
    }

    const company = await getCompanyForUser(req.user!.userId);
    if (!company) return res.status(404).json({ error: 'Company not found' });

    const { data: job } = await supabase.from('job_postings').select('*').eq('id', jobId).maybeSingle();
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.company_id !== company.id) {
      return res.status(403).json({ error: 'You can only manage your own job postings' });
    }
    if (job.status === 'closed') return res.status(400).json({ error: 'Job is already closed' });
    if (job.status === 'draft') {
      return res.status(400).json({ error: 'Draft jobs cannot be closed. Delete them instead.' });
    }

    const { data: updatedJob } = await supabase.from('job_postings').update({ status: 'closed' }).eq('id', jobId).select().single();

    await supabase
      .from('applications')
      .update({ status: 'rejected', rejection_reason: 'Job posting has been closed' })
      .eq('job_posting_id', jobId)
      .in('status', ['pending', 'reviewed']);

    res.json(updatedJob);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Fetches applications matching the base DB-level filters, then joins in
// student/job data and applies any cross-table search/filter in JS. Simpler
// and safer than hand-rolling cross-table ILIKE via RPC for this data volume.
const fetchApplicationsWithJoins = async ({
  jobPostingIds,
  status,
  search,
  jobType,
  location,
  skills
}: {
  jobPostingIds: string[];
  status?: string;
  search?: string;
  jobType?: string;
  location?: string;
  skills?: string;
}) => {
  if (!jobPostingIds.length) {
    return [];
  }

  let query = supabase
    .from('applications')
    .select('*')
    .in('job_posting_id', jobPostingIds)
    .not('reviewed_at', 'is', null);

  if (status) {
    query = query.eq('status', status);
  } else {
    query = query.in('status', VISIBLE_APPLICATION_STATUSES);
  }

  const { data: applications, error } = await query;
  if (error) throw error;
  if (!applications || !applications.length) return [];

  const studentIds = [...new Set(applications.map((a) => a.student_id))];
  const jobIds = [...new Set(applications.map((a) => a.job_posting_id))];

  const [{ data: students }, { data: jobs }] = await Promise.all([
    supabase.from('students').select('*').in('id', studentIds),
    supabase.from('job_postings').select('*').in('id', jobIds)
  ]);

  const studentMap = new Map((students || []).map((s) => [s.id, s]));
  const jobMap = new Map((jobs || []).map((j) => [j.id, j]));

  let joined = applications.map((app) => ({
    ...app,
    student: studentMap.get(app.student_id) || null,
    jobPosting: jobMap.get(app.job_posting_id) || null
  }));

  if (jobType) {
    joined = joined.filter((a) => a.jobPosting?.job_type === jobType);
  }

  if (skills) {
    const skillList = skills.split(',').map((s) => s.trim().toLowerCase());
    joined = joined.filter((a) => (a.student?.skills || []).some((sk: string) => skillList.includes(sk.toLowerCase())));
  }

  if (location) {
    const loc = location.toLowerCase();
    joined = joined.filter((a) => (a.jobPosting?.location || '').toLowerCase().includes(loc));
  }

  if (search) {
    const term = search.toLowerCase();
    joined = joined.filter(
      (a) =>
        (a.student?.full_name || '').toLowerCase().includes(term) ||
        (a.student?.email || '').toLowerCase().includes(term) ||
        (a.jobPosting?.title || '').toLowerCase().includes(term)
    );
  }

  joined.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return joined;
};

exports.getJobApplications = async (req: AuthedRequest, res: Response) => {
  try {
    const { jobId } = req.params as { jobId: string };
    const { status, search, page = 1, limit = 10 } = req.query as Record<string, any>;

    if (!isValidUuid(jobId)) {
      return res.status(400).json({ error: 'Invalid job ID format' });
    }

    const company = await getCompanyForUser(req.user!.userId);
    if (!company) return res.status(404).json({ error: 'Company not found' });

    const { data: job } = await supabase.from('job_postings').select('*').eq('id', jobId).maybeSingle();
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.company_id !== company.id) {
      return res.status(403).json({ error: 'You can only view applications for your own jobs' });
    }

    if (status && !VISIBLE_APPLICATION_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Status must be reviewed, interview_scheduled, offer_extended, hired, or rejected' });
    }

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));

    const applications = await fetchApplicationsWithJoins({ jobPostingIds: [jobId], status, search });
    const total = applications.length;
    const paged = applications.slice((pageNum - 1) * limitNum, (pageNum - 1) * limitNum + limitNum);

    res.json({
      applications: paged,
      pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getAllApplications = async (req: AuthedRequest, res: Response) => {
  try {
    const { status, search, jobType, location, skills, page = 1, limit = 10 } = req.query as Record<string, any>;

    const company = await getCompanyForUser(req.user!.userId);
    if (!company) return res.status(404).json({ error: 'Company not found' });

    if (status && !VISIBLE_APPLICATION_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Status must be reviewed, interview_scheduled, offer_extended, hired, or rejected' });
    }
    if (jobType && !JOB_TYPES.includes(jobType)) {
      return res.status(400).json({ error: `Job type must be one of: ${JOB_TYPES.join(', ')}` });
    }

    const { data: companyJobs } = await supabase.from('job_postings').select('id').eq('company_id', company.id);
    const jobIds = (companyJobs || []).map((j) => j.id);

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));

    const applications = await fetchApplicationsWithJoins({ jobPostingIds: jobIds, status, search, jobType, location, skills });
    const total = applications.length;
    const paged = applications.slice((pageNum - 1) * limitNum, (pageNum - 1) * limitNum + limitNum);

    res.json({
      applications: paged,
      pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getProfile = async (req: AuthedRequest, res: Response) => {
  try {
    const company = await getCompanyForUser(req.user!.userId);
    if (!company) return res.status(404).json({ error: 'Company not found' });

    res.json({ profile: buildCompanyProfileResponse(company) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.updateProfile = async (req: AuthedRequest, res: Response) => {
  try {
    const parsed = companyProfileSchema.parse(req.body);
    const company = await getCompanyForUser(req.user!.userId);
    if (!company) return res.status(404).json({ error: 'Company not found' });

    const previousVerificationValues: Record<string, any> = {};
    for (const field of COMPANY_REVERIFICATION_FIELDS) {
      previousVerificationValues[field] = (company as any)[field] ?? null;
    }

    if (parsed.email !== undefined) {
      const emailTaken = await isEmailTakenByOther(parsed.email, company.id);
      if (emailTaken) {
        return res.status(409).json({ error: 'Email already registered' });
      }
      parsed.email = parsed.email.toLowerCase().trim();
    }

    let updates: Record<string, any>;
    let nextCompany: any;
    try {
      const result = applyCompanyProfileUpdates(company, parsed, { allowNameEdit: false });
      updates = result.updates;
      nextCompany = result.company;
    } catch (error: any) {
      if (error.message === 'APPROVED_COMPANY_NAME_READONLY') {
        return res.status(400).json({ error: 'Company name cannot be edited after approval' });
      }
      throw error;
    }

    if (parsed.email !== undefined) {
      updates.email = parsed.email;
      nextCompany.email = parsed.email;
    }

    if (Object.keys(updates).length > 0) {
      const { error } = await supabase.from('companies').update(updates as any).eq('id', company.id);
      if (error) throw error;
    }

    invalidatePublicCompanyProfileCache(company.id);
    res.json({ profile: buildCompanyProfileResponse(nextCompany) });

    const verificationFieldChanged = COMPANY_REVERIFICATION_FIELDS.some((field) => {
      const previousValue = previousVerificationValues[field];
      const nextValue = nextCompany[field] ?? null;
      return String(previousValue) !== String(nextValue);
    });

    if (verificationFieldChanged && company.status === 'pending') {
      notificationService
        .notifyAdminsCompanyReverifyRequired({ companyId: company.id, companyName: nextCompany.name })
        .catch((error: unknown) => console.error('Admin notification error (company reverify required):', error));
    }
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: error.issues[0].message });
    }
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.uploadLogo = async (req: AuthedRequest & { file?: any }, res: Response) => {
  try {
    const company = await getCompanyForUser(req.user!.userId);
    if (!company) return res.status(404).json({ error: 'Company not found' });

    if (!req.file) {
      return res.status(400).json({ error: 'Logo file is required' });
    }

    try {
      const logoUrl = await uploadCompanyLogo(req.file);
      await supabase.from('companies').update({ logo: logoUrl }).eq('id', company.id);
      invalidatePublicCompanyProfileCache(company.id);
      return res.json({ logo: logoUrl });
    } catch (uploadError) {
      console.error(uploadError);
      return res.status(500).json({ error: 'Failed to upload logo' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getPublicProfile = async (req: Request, res: Response) => {
  try {
    const { companyId } = req.params as { companyId: string };
    if (!isValidUuid(companyId)) {
      return res.status(400).json({ error: 'Invalid company ID format' });
    }

    const cached = getCachedPublicCompanyProfile(companyId);
    if (cached) {
      return res.json({ profile: cached });
    }

    const { data: company } = await supabase.from('companies').select('*').eq('id', companyId).eq('status', 'approved').maybeSingle();
    if (!company) {
      return res.status(404).json({ error: 'Company profile not found' });
    }

    const profile = buildPublicCompanyProfile(company);
    setCachedPublicCompanyProfile(companyId, profile);

    res.json({ profile });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.updateApplication = async (req: AuthedRequest, res: Response) => {
  try {
    const { appId } = req.params as { appId: string };
    const { status, rejectionReason, interviewDate, interviewTimeZone, interviewNotes, offerDetails } = req.body;

    if (!['interview_scheduled', 'offer_extended', 'hired', 'rejected'].includes(status)) {
      return res.status(400).json({ error: "Status must be 'interview_scheduled', 'offer_extended', 'hired', or 'rejected'" });
    }

    const normalizeOptionalText = (value: any): string | null => {
      if (value === undefined || value === null || typeof value !== 'string') return null;
      const trimmed = value.trim();
      return trimmed.length ? trimmed : null;
    };

    const normalizedInterviewNotes = normalizeOptionalText(interviewNotes);
    const normalizedOfferDetails = normalizeOptionalText(offerDetails);

    if (interviewNotes !== undefined && typeof interviewNotes !== 'string') {
      return res.status(400).json({ error: 'interviewNotes must be a string' });
    }
    if (offerDetails !== undefined && typeof offerDetails !== 'string') {
      return res.status(400).json({ error: 'offerDetails must be a string' });
    }
    if (interviewTimeZone !== undefined && interviewTimeZone !== null && typeof interviewTimeZone !== 'string') {
      return res.status(400).json({ error: 'interviewTimeZone must be a string' });
    }

    const { utcDate: normalizedInterviewDate, error: interviewDateError } = convertInterviewDateToUtc({
      interviewDateInput: interviewDate,
      interviewTimeZone
    });
    if (interviewDateError) {
      return res.status(400).json({ error: interviewDateError });
    }

    if (!isValidUuid(appId)) {
      return res.status(400).json({ error: 'Invalid application ID format' });
    }

    const company = await getCompanyForUser(req.user!.userId);
    if (!company) return res.status(404).json({ error: 'Company not found' });

    const { data: application } = await supabase.from('applications').select('*').eq('id', appId).maybeSingle();
    if (!application) return res.status(404).json({ error: 'Application not found' });

    const { data: jobPosting } = await supabase.from('job_postings').select('*').eq('id', application.job_posting_id).maybeSingle();
    if (!jobPosting || jobPosting.company_id !== company.id) {
      return res.status(403).json({ error: 'You can only manage applications for your own jobs' });
    }

    const allowedTransitions: Record<string, string[]> = {
      reviewed: ['interview_scheduled', 'rejected'],
      interview_scheduled: ['offer_extended', 'rejected'],
      offer_extended: ['hired', 'rejected']
    };

    const allowedNextStatuses = allowedTransitions[application.status] || [];
    if (!allowedNextStatuses.includes(status)) {
      if (application.status === 'pending') {
        return res.status(400).json({ error: 'Can only hire/reject applications that have been reviewed by admin' });
      }
      if (['hired', 'rejected'].includes(application.status)) {
        return res.status(400).json({ error: 'This application has already been processed' });
      }
      if (application.status === 'withdrawn') {
        return res.status(400).json({ error: 'Cannot process withdrawn applications' });
      }
      return res.status(400).json({ error: `Invalid transition from ${application.status} to ${status}` });
    }

    const update: Record<string, any> = { status, reviewed_at: new Date().toISOString() };

    if (status === 'interview_scheduled') {
      update.interview_date = normalizedInterviewDate ? normalizedInterviewDate.toISOString() : null;
      update.interview_notes = normalizedInterviewNotes;
      update.offer_details = null;
      update.rejection_reason = null;
      update.rejection_source = null;
    } else if (status === 'offer_extended') {
      update.offer_details = normalizedOfferDetails;
      update.rejection_reason = null;
      update.rejection_source = null;
    } else if (status === 'rejected') {
      update.rejection_reason = typeof rejectionReason === 'string' && rejectionReason.trim().length > 0 ? rejectionReason.trim() : null;
      update.rejection_source = 'company';
    } else {
      update.rejection_reason = null;
      update.rejection_source = null;
    }

    await supabase.from('applications').update(update as any).eq('id', appId);

    if (status === 'hired') {
      await supabase.from('students').update({ is_hired: true }).eq('id', application.student_id);
    }

    const [{ data: updatedApp }, { data: student }, { data: job }] = await Promise.all([
      supabase.from('applications').select('*').eq('id', appId).single(),
      supabase.from('students').select('full_name, email, profile_link, is_hired, user_id').eq('id', application.student_id).maybeSingle(),
      supabase.from('job_postings').select('title').eq('id', application.job_posting_id).maybeSingle()
    ]);

    res.json({ ...updatedApp, student, jobPosting: job });

    if (!student || !job) {
      return;
    }

    if (status === 'interview_scheduled') {
      notificationService
        .notifyApplicationInterviewScheduled(student.user_id, {
          jobTitle: job.title,
          companyName: company.name,
          interviewDate: update.interview_date
        })
        .catch((err: unknown) => console.error('Notification error (interview scheduled):', err));
    }

    if (status === 'offer_extended') {
      notificationService
        .notifyApplicationOfferExtended(student.user_id, { jobTitle: job.title, companyName: company.name })
        .catch((err: unknown) => console.error('Notification error (offer extended):', err));
    }

    if (status === 'rejected') {
      notificationService
        .notifyApplicationRejected(student.user_id, { jobTitle: job.title, companyName: company.name })
        .catch((err: unknown) => console.error('Notification error (company rejected):', err));
    }

    if (status === 'hired') {
      emailService
        .sendApplicationStatusEmail(
          student.email,
          { status: 'hired', jobTitle: job.title, companyName: company.name, studentName: student.full_name },
          { userId: student.user_id }
        )
        .catch((error: unknown) => console.error('Failed to send application hired email', error));

      notificationService
        .notifyApplicationHired(student.user_id, { jobTitle: job.title, companyName: company.name })
        .catch((err: unknown) => console.error('Notification error (hired):', err));
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getStudentProfile = async (req: AuthedRequest, res: Response) => {
  try {
    const { studentId } = req.params as { studentId: string };
    if (!isValidUuid(studentId)) {
      return res.status(400).json({ error: 'Invalid student ID format' });
    }

    const company = await getCompanyForUser(req.user!.userId);
    if (!company) return res.status(404).json({ error: 'Company not found' });

    const { data: companyJobs } = await supabase.from('job_postings').select('id').eq('company_id', company.id);
    const companyJobIds = (companyJobs || []).map((j) => j.id);

    let hasApprovedApplication = false;
    if (companyJobIds.length) {
      const { count } = await supabase
        .from('applications')
        .select('*', { count: 'exact', head: true })
        .eq('student_id', studentId)
        .in('job_posting_id', companyJobIds)
        .in('status', ['reviewed', 'hired']);
      hasApprovedApplication = (count ?? 0) > 0;
    }

    if (!hasApprovedApplication) {
      return res.status(403).json({ error: 'You can only view profiles of students with approved applications to your jobs' });
    }

    const { data: student } = await supabase
      .from('students')
      .select('full_name, email, profile_link, bio, location, available_from, skills, education, experience, resume_url, intro_video_url, is_hired')
      .eq('id', studentId)
      .maybeSingle();

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const [resumeUrl, introVideoUrl] = await Promise.all([
      student.resume_url ? getPresignedUrl(student.resume_url) : null,
      student.intro_video_url ? getPresignedUrl(student.intro_video_url) : null
    ]);

    res.json({
      id: studentId,
      fullName: student.full_name,
      email: student.email,
      profileLink: student.profile_link || null,
      bio: student.bio || null,
      location: student.location || null,
      availableFrom: student.available_from || null,
      skills: student.skills || [],
      education: student.education || [],
      experience: student.experience || [],
      resumeUrl,
      introVideoUrl,
      isHired: student.is_hired
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getCountries = async (_req: Request, res: Response) => {
  try {
    const { data: countries, error } = await supabase
      .from('zone_countries')
      .select('id, country_name, zone_id, zones ( id, name )')
      .order('country_name', { ascending: true });
    if (error) throw error;

    const formattedCountries = (countries || []).map((c: any) => ({
      id: c.id,
      name: c.country_name,
      zone: c.zones ? { id: c.zones.id, name: c.zones.name } : null
    }));

    res.json({ countries: formattedCountries });
  } catch (error) {
    console.error('Get countries error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};
