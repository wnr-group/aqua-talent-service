const mongoose = require('mongoose');

const Company = require('../models/Company');
const JobPosting = require('../models/JobPosting');
const Application = require('../models/Application');
const Student = require('../models/Student');
const { createJobSchema, createDraftJobSchema, updateJobSchema, companyProfileSchema } = require('../utils/validation');
const { JOB_STATUSES, JOB_TYPES, APPLICATION_STATUSES } = require('../constants');
const { uploadCompanyLogo } = require('../services/mediaService');
const emailService = require('../services/emailService');
const notificationService = require('../services/notificationService');
const {
  applyCompanyProfileUpdates,
  buildCompanyProfileResponse,
  buildPublicCompanyProfile,
  getCachedPublicCompanyProfile,
  setCachedPublicCompanyProfile,
  invalidatePublicCompanyProfileCache
} = require('../services/companyProfileService');

const VISIBLE_APPLICATION_STATUSES = ['reviewed', 'hired', 'rejected'];

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

exports.getDashboard = async (req, res) => {
  try {
    const company = await Company.findOne({ userId: req.user.userId });

    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    // Job stats using aggregation
    const jobStats = await JobPosting.aggregate([
      { $match: { companyId: company._id } },
      {
        $group: {
          _id: null,
          totalJobs: { $sum: 1 },
          activeJobs: { $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] } },
          pendingJobs: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
          draftJobs: { $sum: { $cond: [{ $eq: ['$status', 'draft'] }, 1, 0] } },
          unpublishedJobs: { $sum: { $cond: [{ $eq: ['$status', 'unpublished'] }, 1, 0] } }
        }
      }
    ]);

    // Get job IDs for application count
    const jobIds = await JobPosting.find({ companyId: company._id }).distinct('_id');

    // Application stats - only count applications visible to company (admin-approved)
    const appStats = await Application.aggregate([
      {
        $match: {
          jobPostingId: { $in: jobIds },
          status: { $in: VISIBLE_APPLICATION_STATUSES },
          reviewedAt: { $ne: null }
        }
      },
      {
        $group: {
          _id: null,
          totalApplications: { $sum: 1 },
          reviewedApplications: { $sum: { $cond: [{ $eq: ['$status', 'reviewed'] }, 1, 0] } }
        }
      }
    ]);

    res.json({
      totalJobs: jobStats[0]?.totalJobs || 0,
      activeJobs: jobStats[0]?.activeJobs || 0,
      pendingJobs: jobStats[0]?.pendingJobs || 0,
      draftJobs: jobStats[0]?.draftJobs || 0,
      unpublishedJobs: jobStats[0]?.unpublishedJobs || 0,
      totalApplications: appStats[0]?.totalApplications || 0,
      reviewedApplications: appStats[0]?.reviewedApplications || 0
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getJobs = async (req, res) => {
  try {
    const { status, search, location, jobType, page = 1, limit = 10 } = req.query;

    const company = await Company.findOne({ userId: req.user.userId });

    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    if (status && !JOB_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${JOB_STATUSES.join(', ')}` });
    }

    if (jobType && !JOB_TYPES.includes(jobType)) {
      return res.status(400).json({ error: `Job type must be one of: ${JOB_TYPES.join(', ')}` });
    }

    const query = { companyId: company._id };

    if (status) {
      query.status = status;
    }

    if (search) {
      const escapedSearch = escapeRegex(search);
      query.$or = [
        { title: { $regex: escapedSearch, $options: 'i' } },
        { description: { $regex: escapedSearch, $options: 'i' } }
      ];
    }

    if (location) {
      const escapedLocation = escapeRegex(location);
      query.location = { $regex: escapedLocation, $options: 'i' };
    }

    if (jobType) {
      query.jobType = jobType;
    }

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));
    const skip = (pageNum - 1) * limitNum;

    const [jobs, total] = await Promise.all([
      JobPosting.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      JobPosting.countDocuments(query)
    ]);

    res.json({
      jobs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.createJob = async (req, res) => {
  try {
    const body = req.body || {};
    const requestedStatus = body.status === 'draft' ? 'draft' : 'pending';

    // Use relaxed validation for drafts, strict for pending
    const parsed = requestedStatus === 'draft'
      ? createDraftJobSchema.parse(body)
      : createJobSchema.parse(body);

    const company = await Company.findOne({ userId: req.user.userId });

    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    // Safely handle all optional fields — default to null when missing
    const title = parsed.title || null;
    const description = parsed.description || null;
    const requirements = Array.isArray(parsed.requirements)
      ? (parsed.requirements.length > 0 ? parsed.requirements.join(', ') : null)
      : (parsed.requirements || null);
    const location = parsed.location || null;
    const jobType = parsed.jobType || null;
    const salaryRange = parsed.salaryRange || null;
    const deadline = parsed.deadline ? new Date(parsed.deadline) : null;

    // Safe access for any uploaded files
    const file = req.files?.[0] || null;

    const job = await JobPosting.create({
      companyId: company._id,
      title,
      description,
      requirements,
      location,
      jobType,
      salaryRange,
      deadline,
      status: requestedStatus
    });

    res.status(201).json(job);
  } catch (error) {
    if (error.name === 'ZodError') {
      const message = error.errors?.[0]?.message || 'Validation error';
      return res.status(400).json({ error: message });
    }

    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getJob = async (req, res) => {
  try {
    const { jobId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(jobId)) {
      return res.status(400).json({ error: 'Invalid job ID format' });
    }

    const company = await Company.findOne({ userId: req.user.userId });

    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const job = await JobPosting.findById(jobId);

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    if (!job.companyId.equals(company._id)) {
      return res.status(403).json({ error: 'You can only view your own job postings' });
    }

    res.json(job);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.updateJob = async (req, res) => {
  try {
    const { jobId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(jobId)) {
      return res.status(400).json({ error: 'Invalid job ID format' });
    }

    const company = await Company.findOne({ userId: req.user.userId });

    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const job = await JobPosting.findById(jobId);

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    if (!job.companyId.equals(company._id)) {
      return res.status(403).json({ error: 'You can only edit your own job postings' });
    }

    // Handle close request — company can close approved/unpublished/pending jobs
    if (req.body.status === 'closed') {
      if (job.status === 'closed') {
        return res.status(400).json({ error: 'Job is already closed' });
      }
      if (job.status === 'draft') {
        return res.status(400).json({ error: 'Draft jobs cannot be closed' });
      }

      const updatedJob = await JobPosting.findByIdAndUpdate(
        jobId,
        { $set: { status: 'closed' } },
        { returnDocument: 'after' }
      );

      // Reject all pending/reviewed applications for this job
      await Application.updateMany(
        {
          jobPostingId: jobId,
          status: { $in: ['pending', 'reviewed'] }
        },
        {
          $set: {
            status: 'rejected',
            rejectionReason: 'Job posting has been closed'
          }
        }
      );

      return res.json(updatedJob);
    }

    // Handle unpublish request via generic update endpoint
    if (req.body.status === 'unpublished') {
      if (job.status !== 'approved') {
        return res.status(400).json({ error: 'Only approved jobs can be unpublished' });
      }

      const updatedJob = await JobPosting.findByIdAndUpdate(
        jobId,
        { $set: { status: 'unpublished' } },
        { returnDocument: 'after' }
      );

      return res.json(updatedJob);
    }

    // Handle republish request via generic update endpoint
    if (req.body.status === 'pending' && job.status === 'unpublished') {
      const updatedJob = await JobPosting.findByIdAndUpdate(
        jobId,
        {
          $set: {
            status: 'pending',
            approvedAt: null,
            rejectionReason: null
          }
        },
        { returnDocument: 'after' }
      );

      return res.json(updatedJob);
    }

    if (job.status !== 'pending' && job.status !== 'draft') {
      return res.status(403).json({ error: 'Can only edit jobs that are in draft or pending approval' });
    }

    // Determine if the company wants to submit a draft for review
    const wantsToSubmit = req.body.status === 'pending' && job.status === 'draft';

    // Use strict validation when submitting for review, relaxed for draft edits
    const parsed = wantsToSubmit
      ? updateJobSchema.parse(req.body)
      : (job.status === 'draft' ? createDraftJobSchema.partial().parse(req.body) : updateJobSchema.parse(req.body));

    // Build update fields
    const updateFields = {};
    if (parsed.title !== undefined) updateFields.title = parsed.title;
    if (parsed.description !== undefined) updateFields.description = parsed.description;
    if (parsed.requirements !== undefined) updateFields.requirements = parsed.requirements;
    if (parsed.location !== undefined) updateFields.location = parsed.location;
    if (parsed.jobType !== undefined) updateFields.jobType = parsed.jobType;
    if (parsed.salaryRange !== undefined) updateFields.salaryRange = parsed.salaryRange;
    if (parsed.deadline !== undefined) updateFields.deadline = parsed.deadline ? new Date(parsed.deadline) : null;

    // If submitting a draft, validate that required fields are present (either in update or existing doc)
    if (wantsToSubmit) {
      const merged = {
        title: updateFields.title ?? job.title,
        description: updateFields.description ?? job.description,
        requirements: updateFields.requirements ?? job.requirements,
        location: updateFields.location ?? job.location,
        jobType: updateFields.jobType ?? job.jobType,
        salaryRange: updateFields.salaryRange ?? job.salaryRange,
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

    const updatedJob = await JobPosting.findByIdAndUpdate(
      jobId,
      { $set: updateFields },
      { returnDocument: 'after', runValidators: true }
    );

    res.json(updatedJob);
  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: error.errors[0].message });
    }

    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.unpublishJob = async (req, res) => {
  try {
    const { jobId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(jobId)) {
      return res.status(400).json({ error: 'Invalid job ID format' });
    }

    const company = await Company.findOne({ userId: req.user.userId });

    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const job = await JobPosting.findById(jobId);

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    if (!job.companyId.equals(company._id)) {
      return res.status(403).json({ error: 'You can only manage your own job postings' });
    }

    if (job.status !== 'approved') {
      return res.status(400).json({ error: 'Only approved jobs can be unpublished' });
    }

    const updatedJob = await JobPosting.findByIdAndUpdate(
      jobId,
      { $set: { status: 'unpublished' } },
      { returnDocument: 'after' }
    );

    res.json(updatedJob);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.republishJob = async (req, res) => {
  try {
    const { jobId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(jobId)) {
      return res.status(400).json({ error: 'Invalid job ID format' });
    }

    const company = await Company.findOne({ userId: req.user.userId });

    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const job = await JobPosting.findById(jobId);

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    if (!job.companyId.equals(company._id)) {
      return res.status(403).json({ error: 'You can only manage your own job postings' });
    }

    if (job.status !== 'unpublished') {
      return res.status(400).json({ error: 'Only unpublished jobs can be republished' });
    }

    const updatedJob = await JobPosting.findByIdAndUpdate(
      jobId,
      {
        $set: {
          status: 'pending',
          approvedAt: null,
          rejectionReason: null
        }
      },
      { returnDocument: 'after' }
    );

    res.json(updatedJob);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.closeJob = async (req, res) => {
  try {
    const { jobId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(jobId)) {
      return res.status(400).json({ error: 'Invalid job ID format' });
    }

    const company = await Company.findOne({ userId: req.user.userId });

    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const job = await JobPosting.findById(jobId);

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    if (!job.companyId.equals(company._id)) {
      return res.status(403).json({ error: 'You can only manage your own job postings' });
    }

    if (job.status === 'closed') {
      return res.status(400).json({ error: 'Job is already closed' });
    }

    if (job.status === 'draft') {
      return res.status(400).json({ error: 'Draft jobs cannot be closed. Delete them instead.' });
    }

    // Close the job
    const updatedJob = await JobPosting.findByIdAndUpdate(
      jobId,
      { $set: { status: 'closed' } },
      { returnDocument: 'after' }
    );

    // Reject all pending/reviewed applications for this job
    await Application.updateMany(
      {
        jobPostingId: jobId,
        status: { $in: ['pending', 'reviewed'] }
      },
      {
        $set: {
          status: 'rejected',
          rejectionReason: 'Job posting has been closed'
        }
      }
    );

    res.json(updatedJob);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getJobApplications = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { status, search, page = 1, limit = 10 } = req.query;

    if (!mongoose.Types.ObjectId.isValid(jobId)) {
      return res.status(400).json({ error: 'Invalid job ID format' });
    }

    const company = await Company.findOne({ userId: req.user.userId });

    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const job = await JobPosting.findById(jobId);

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    if (!job.companyId.equals(company._id)) {
      return res.status(403).json({ error: 'You can only view applications for your own jobs' });
    }

    if (status && !VISIBLE_APPLICATION_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Status must be reviewed, hired, or rejected' });
    }

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));
    const skip = (pageNum - 1) * limitNum;

    // Build aggregation pipeline for search on student fields
    const pipeline = [
      {
        $match: {
          jobPostingId: job._id,
          status: status ? status : { $in: VISIBLE_APPLICATION_STATUSES },
          reviewedAt: { $ne: null }
        }
      },
      {
        $lookup: {
          from: 'students',
          localField: 'studentId',
          foreignField: '_id',
          as: 'student'
        }
      },
      { $unwind: '$student' },
      {
        $lookup: {
          from: 'jobpostings',
          localField: 'jobPostingId',
          foreignField: '_id',
          as: 'jobPosting'
        }
      },
      { $unwind: '$jobPosting' }
    ];

    if (search) {
      const escapedSearch = escapeRegex(search);
      pipeline.push({
        $match: {
          $or: [
            { 'student.fullName': { $regex: escapedSearch, $options: 'i' } },
            { 'student.email': { $regex: escapedSearch, $options: 'i' } }
          ]
        }
      });
    }

    // Count total
    const countPipeline = [...pipeline, { $count: 'total' }];
    const countResult = await Application.aggregate(countPipeline);
    const total = countResult[0]?.total || 0;

    // Add sorting and pagination
    pipeline.push(
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limitNum }
    );

    const applications = await Application.aggregate(pipeline);

    res.json({
      applications,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getAllApplications = async (req, res) => {
  try {
    const { status, search, jobType, location, page = 1, limit = 10 } = req.query;

    const company = await Company.findOne({ userId: req.user.userId });

    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    if (status && !VISIBLE_APPLICATION_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Status must be reviewed, hired, or rejected' });
    }

    if (jobType && !JOB_TYPES.includes(jobType)) {
      return res.status(400).json({ error: `Job type must be one of: ${JOB_TYPES.join(', ')}` });
    }

    const jobIds = await JobPosting.find({ companyId: company._id }).distinct('_id');

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));
    const skip = (pageNum - 1) * limitNum;

    // Build aggregation pipeline
    const pipeline = [
      {
        $match: {
          jobPostingId: { $in: jobIds },
          status: status ? status : { $in: VISIBLE_APPLICATION_STATUSES },
          reviewedAt: { $ne: null }
        }
      },
      {
        $lookup: {
          from: 'students',
          localField: 'studentId',
          foreignField: '_id',
          as: 'student'
        }
      },
      { $unwind: '$student' },
      {
        $lookup: {
          from: 'jobpostings',
          localField: 'jobPostingId',
          foreignField: '_id',
          as: 'jobPosting'
        }
      },
      { $unwind: '$jobPosting' }
    ];

    // Additional match conditions
    const additionalMatch = {};

    if (jobType) {
      additionalMatch['jobPosting.jobType'] = jobType;
    }

    if (location) {
      const escapedLocation = escapeRegex(location);
      additionalMatch['jobPosting.location'] = { $regex: escapedLocation, $options: 'i' };
    }

    if (search) {
      const escapedSearch = escapeRegex(search);
      additionalMatch.$or = [
        { 'student.fullName': { $regex: escapedSearch, $options: 'i' } },
        { 'student.email': { $regex: escapedSearch, $options: 'i' } },
        { 'jobPosting.title': { $regex: escapedSearch, $options: 'i' } }
      ];
    }

    if (Object.keys(additionalMatch).length > 0) {
      pipeline.push({ $match: additionalMatch });
    }

    // Count total
    const countPipeline = [...pipeline, { $count: 'total' }];
    const countResult = await Application.aggregate(countPipeline);
    const total = countResult[0]?.total || 0;

    // Add sorting and pagination
    pipeline.push(
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limitNum }
    );

    const applications = await Application.aggregate(pipeline);

    res.json({
      applications,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getProfile = async (req, res) => {
  try {
    const company = await Company.findOne({ userId: req.user.userId });

    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    res.json({ profile: buildCompanyProfileResponse(company) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const parsed = companyProfileSchema.parse(req.body);
    const company = await Company.findOne({ userId: req.user.userId });

    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    try {
      applyCompanyProfileUpdates(company, parsed, { allowNameEdit: false });
    } catch (error) {
      if (error.message === 'APPROVED_COMPANY_NAME_READONLY') {
        return res.status(400).json({ error: 'Company name cannot be edited after approval' });
      }
      throw error;
    }

    await company.save();
    invalidatePublicCompanyProfileCache(company._id);

    res.json({ profile: buildCompanyProfileResponse(company) });
  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: error.errors[0].message });
    }

    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.uploadLogo = async (req, res) => {
  try {
    const company = await Company.findOne({ userId: req.user.userId });

    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Logo file is required' });
    }

    try {
      const logoUrl = await uploadCompanyLogo(req.file);
      company.logo = logoUrl;
      await company.save();
      invalidatePublicCompanyProfileCache(company._id);

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

exports.getPublicProfile = async (req, res) => {
  try {
    const { companyId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(companyId)) {
      return res.status(400).json({ error: 'Invalid company ID format' });
    }

    const cached = getCachedPublicCompanyProfile(companyId);
    if (cached) {
      return res.json({ profile: cached });
    }

    const company = await Company.findOne({ _id: companyId, status: 'approved' });

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

exports.updateApplication = async (req, res) => {
  try {
    const { appId } = req.params;
    const { status } = req.body;

    if (!['hired', 'rejected'].includes(status)) {
      return res.status(400).json({ error: "Status must be 'hired' or 'rejected'" });
    }

    if (!mongoose.Types.ObjectId.isValid(appId)) {
      return res.status(400).json({ error: 'Invalid application ID format' });
    }

    const company = await Company.findOne({ userId: req.user.userId });

    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const application = await Application.findById(appId).populate('jobPostingId');

    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }

    if (!application.jobPostingId.companyId.equals(company._id)) {
      return res.status(403).json({ error: 'You can only manage applications for your own jobs' });
    }

    if (application.status !== 'reviewed') {
      if (application.status === 'pending') {
        return res.status(400).json({ error: 'Can only hire/reject applications that have been reviewed by admin' });
      }
      if (['hired', 'rejected'].includes(application.status)) {
        return res.status(400).json({ error: 'This application has already been processed' });
      }
      if (application.status === 'withdrawn') {
        return res.status(400).json({ error: 'Cannot process withdrawn applications' });
      }
    }

    // Update application status
    application.status = status;
    application.reviewedAt = new Date();
    await application.save();

    // If hired, update student's isHired flag
    if (status === 'hired') {
      await Student.findByIdAndUpdate(
        application.studentId,
        { isHired: true }
      );
    }

    const updatedApp = await Application.findById(appId)
      .populate('studentId', 'fullName email profileLink isHired userId')
      .populate('jobPostingId', 'title');

    res.json(updatedApp);

    if (status === 'hired') {
      emailService
        .sendApplicationStatusEmail(
          updatedApp.studentId.email,
          {
            status: 'hired',
            jobTitle: updatedApp.jobPostingId.title,
            companyName: company.name,
            studentName: updatedApp.studentId.fullName
          },
          { userId: updatedApp.studentId.userId }
        )
        .catch((error) => console.error('Failed to send application hired email', error));

      notificationService
        .notifyApplicationHired(updatedApp.studentId.userId, {
          jobTitle: updatedApp.jobPostingId.title,
          companyName: company.name
        })
        .catch((err) => console.error('Notification error (hired):', err));
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};
