const mongoose = require('mongoose');

const Company = require('../models/Company');
const JobPosting = require('../models/JobPosting');
const Student = require('../models/Student');
const Application = require('../models/Application');
const AvailableService = require('../models/AvailableService');
const ActiveSubscription = require('../models/ActiveSubscription');
const PaymentRecord = require('../models/PaymentRecord');
const SystemConfig = require('../models/SystemConfig');
const emailService = require('../services/emailService');
const notificationService = require('../services/notificationService');
const {
  updateCompanyStatusSchema,
  updateJobStatusSchema,
  adminUpdateApplicationSchema,
  companyProfileSchema
} = require('../utils/validation');
const { COMPANY_STATUSES, JOB_STATUSES, APPLICATION_STATUSES, JOB_TYPES, CONFIG_KEYS, CURRENCIES, BILLING_CYCLES } = require('../constants');
const { getPresignedUrl } = require('../services/mediaService');
const {
  applyCompanyProfileUpdates,
  buildCompanyProfileResponse,
  invalidatePublicCompanyProfileCache
} = require('../services/companyProfileService');

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

exports.getDashboard = async (req, res) => {
  try {
    const companyStats = await Company.aggregate([
      {
        $group: {
          _id: null,
          totalCompanies: { $sum: 1 },
          pendingCompanies: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
          }
        }
      }
    ]);

    const jobStats = await JobPosting.aggregate([
      {
        $group: {
          _id: null,
          totalJobs: { $sum: 1 },
          pendingJobs: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
          },
          activeJobs: {
            $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] }
          }
        }
      }
    ]);

    const totalStudents = await Student.countDocuments();

    const applicationStats = await Application.aggregate([
      {
        $group: {
          _id: null,
          totalApplications: { $sum: 1 },
          totalHires: {
            $sum: { $cond: [{ $eq: ['$status', 'hired'] }, 1, 0] }
          }
        }
      }
    ]);

    res.json({
      pendingCompanies: companyStats[0]?.pendingCompanies || 0,
      totalCompanies: companyStats[0]?.totalCompanies || 0,
      pendingJobs: jobStats[0]?.pendingJobs || 0,
      activeJobs: jobStats[0]?.activeJobs || 0,
      totalJobs: jobStats[0]?.totalJobs || 0,
      totalStudents,
      totalApplications: applicationStats[0]?.totalApplications || 0,
      totalHires: applicationStats[0]?.totalHires || 0
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getCompanies = async (req, res) => {
  try {
    const { status, search, page = 1, limit = 20 } = req.query;

    if (status && !COMPANY_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Status must be pending, approved, or rejected' });
    }

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const skip = (pageNum - 1) * limitNum;

    const matchConditions = {};
    if (status) {
      matchConditions.status = status;
    }

    const pipeline = [
      { $match: matchConditions },
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'user'
        }
      },
      { $unwind: '$user' }
    ];

    // Add search filter after lookup
    if (search) {
      const escapedSearch = escapeRegex(search);
      pipeline.push({
        $match: {
          $or: [
            { name: { $regex: escapedSearch, $options: 'i' } },
            { email: { $regex: escapedSearch, $options: 'i' } },
            { 'user.username': { $regex: escapedSearch, $options: 'i' } }
          ]
        }
      });
    }

    // Count total before pagination
    const countPipeline = [...pipeline, { $count: 'total' }];
    const countResult = await Company.aggregate(countPipeline);
    const total = countResult[0]?.total || 0;

    // Add sorting and pagination
    pipeline.push(
      {
        $project: {
          _id: 1,
          username: '$user.username',
          name: 1,
          email: 1,
          status: 1,
          rejectionReason: 1,
          createdAt: 1,
          approvedAt: 1
        }
      },
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limitNum }
    );

    const companies = await Company.aggregate(pipeline);

    const result = companies.map(c => ({
      id: c._id.toString(),
      username: c.username,
      name: c.name,
      email: c.email,
      status: c.status,
      rejectionReason: c.rejectionReason,
      createdAt: c.createdAt,
      approvedAt: c.approvedAt
    }));

    res.json({
      companies: result,
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

exports.updateCompany = async (req, res) => {
  try {
    const { companyId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(companyId)) {
      return res.status(400).json({ error: 'Invalid company ID format' });
    }

    const parsed = updateCompanyStatusSchema.parse(req.body);

    const company = await Company.findById(companyId);

    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const previousStatus = company.status;

    const updateFields = { status: parsed.status };

    if (parsed.status === 'approved') {
      updateFields.approvedAt = new Date();
      updateFields.rejectionReason = null;
    } else if (parsed.status === 'rejected') {
      updateFields.rejectionReason = parsed.rejectionReason;
      updateFields.approvedAt = null;
    } else if (parsed.status === 'pending') {
      updateFields.approvedAt = null;
    }

    const updatedCompany = await Company.findByIdAndUpdate(
      companyId,
      { $set: updateFields },
      { returnDocument: 'after' }
    ).populate('userId', 'username');

    res.json({
      id: updatedCompany._id.toString(),
      username: updatedCompany.userId.username,
      name: updatedCompany.name,
      email: updatedCompany.email,
      status: updatedCompany.status,
      rejectionReason: updatedCompany.rejectionReason,
      createdAt: updatedCompany.createdAt,
      approvedAt: updatedCompany.approvedAt
    });

    const statusChanged = previousStatus !== updatedCompany.status;
    const companyUserId = updatedCompany.userId?._id || updatedCompany.userId;

    if (statusChanged && parsed.status === 'approved') {
      emailService
        .sendCompanyApprovedEmail(
          updatedCompany.email,
          {
            companyName: updatedCompany.name,
            recipientName: updatedCompany.name
          },
          { userId: companyUserId }
        )
        .catch((error) => console.error('Failed to send company approval email', error));

      notificationService
        .notifyCompanyApproved(companyUserId, { companyName: updatedCompany.name })
        .catch((err) => console.error('Notification error (company approved):', err));
    } else if (statusChanged && parsed.status === 'rejected') {
      emailService
        .sendCompanyRejectedEmail(
          updatedCompany.email,
          {
            companyName: updatedCompany.name,
            recipientName: updatedCompany.name,
            reason: parsed.rejectionReason || updatedCompany.rejectionReason
          },
          { userId: companyUserId }
        )
        .catch((error) => console.error('Failed to send company rejection email', error));

      notificationService
        .notifyCompanyRejected(companyUserId, {
          companyName: updatedCompany.name,
          rejectionReason: parsed.rejectionReason || updatedCompany.rejectionReason
        })
        .catch((err) => console.error('Notification error (company rejected):', err));
    }
  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: error.issues[0].message });
    }

    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getJobs = async (req, res) => {
  try {
    const { status, search, location, jobType, page = 1, limit = 10 } = req.query;

    if (status && !JOB_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${JOB_STATUSES.join(', ')}` });
    }

    if (jobType && !JOB_TYPES.includes(jobType)) {
      return res.status(400).json({ error: `Job type must be one of: ${JOB_TYPES.join(', ')}` });
    }

    const query = {};

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
        .populate('companyId', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      JobPosting.countDocuments(query)
    ]);

    const result = jobs.map(job => ({
      id: job._id.toString(),
      companyId: job.companyId._id.toString(),
      title: job.title,
      description: job.description,
      requirements: job.requirements,
      location: job.location,
      jobType: job.jobType,
      salaryRange: job.salaryRange,
      deadline: job.deadline,
      status: job.status,
      rejectionReason: job.rejectionReason,
      createdAt: job.createdAt,
      approvedAt: job.approvedAt,
      company: {
        id: job.companyId._id.toString(),
        name: job.companyId.name
      }
    }));

    res.json({
      jobs: result,
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

exports.getJob = async (req, res) => {
  try {
    const { jobId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(jobId)) {
      return res.status(400).json({ error: 'Invalid job ID format' });
    }

    const job = await JobPosting.findById(jobId)
      .populate('companyId', 'name email');

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json({
      id: job._id.toString(),
      companyId: job.companyId._id.toString(),
      title: job.title,
      description: job.description,
      requirements: job.requirements,
      location: job.location,
      jobType: job.jobType,
      salaryRange: job.salaryRange,
      deadline: job.deadline,
      status: job.status,
      rejectionReason: job.rejectionReason,
      createdAt: job.createdAt,
      approvedAt: job.approvedAt,
      company: {
        id: job.companyId._id.toString(),
        name: job.companyId.name,
        email: job.companyId.email
      }
    });
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

    const parsed = updateJobStatusSchema.parse(req.body);

    const job = await JobPosting.findById(jobId);

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const previousStatus = job.status;

    const updateFields = { status: parsed.status };

    if (parsed.status === 'approved') {
      updateFields.approvedAt = new Date();
      updateFields.rejectionReason = null;
    } else if (parsed.status === 'rejected') {
      updateFields.rejectionReason = parsed.rejectionReason || null;
      updateFields.approvedAt = null;
    } else if (parsed.status === 'pending') {
      updateFields.approvedAt = null;
    }
    // For 'closed', keep existing approvedAt and rejectionReason

    const updatedJob = await JobPosting.findByIdAndUpdate(
      jobId,
      { $set: updateFields },
      { returnDocument: 'after' }
    ).populate('companyId', 'name userId');

    // If job is closed, reject all pending/reviewed applications
    if (parsed.status === 'closed') {
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
    }

    res.json({
      id: updatedJob._id.toString(),
      companyId: updatedJob.companyId._id.toString(),
      title: updatedJob.title,
      description: updatedJob.description,
      requirements: updatedJob.requirements,
      location: updatedJob.location,
      jobType: updatedJob.jobType,
      salaryRange: updatedJob.salaryRange,
      deadline: updatedJob.deadline,
      status: updatedJob.status,
      rejectionReason: updatedJob.rejectionReason,
      createdAt: updatedJob.createdAt,
      approvedAt: updatedJob.approvedAt,
      company: {
        id: updatedJob.companyId._id.toString(),
        name: updatedJob.companyId.name
      }
    });

    const statusChanged = previousStatus !== updatedJob.status;

    if (statusChanged && parsed.status === 'approved') {
      const companyUserId = updatedJob.companyId?.userId;

      notificationService
        .notifyJobApproved(companyUserId, { jobTitle: updatedJob.title || 'Job Posting' })
        .catch((error) => {
          console.error('Notification error (job approved):', error);
        });
    }
  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: error.issues[0].message });
    }

    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getApplications = async (req, res) => {
  try {
    const { status, search, jobType, location, page = 1, limit = 10 } = req.query;

    if (status && !APPLICATION_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${APPLICATION_STATUSES.join(', ')}` });
    }

    if (jobType && !JOB_TYPES.includes(jobType)) {
      return res.status(400).json({ error: `Job type must be one of: ${JOB_TYPES.join(', ')}` });
    }

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 10));
    const skip = (pageNum - 1) * limitNum;

    // Build aggregation pipeline
    const pipeline = [
      // Lookup student
      {
        $lookup: {
          from: 'students',
          localField: 'studentId',
          foreignField: '_id',
          as: 'student'
        }
      },
      { $unwind: '$student' },
      // Lookup job posting
      {
        $lookup: {
          from: 'jobpostings',
          localField: 'jobPostingId',
          foreignField: '_id',
          as: 'jobPosting'
        }
      },
      { $unwind: '$jobPosting' },
      // Lookup company
      {
        $lookup: {
          from: 'companies',
          localField: 'jobPosting.companyId',
          foreignField: '_id',
          as: 'company'
        }
      },
      { $unwind: '$company' }
    ];

    // Build match conditions
    const matchConditions = {};

    if (status) {
      matchConditions.status = status;
    }

    if (jobType) {
      matchConditions['jobPosting.jobType'] = jobType;
    }

    if (location) {
      const escapedLocation = escapeRegex(location);
      matchConditions['jobPosting.location'] = { $regex: escapedLocation, $options: 'i' };
    }

    if (search) {
      const escapedSearch = escapeRegex(search);
      matchConditions.$or = [
        { 'student.fullName': { $regex: escapedSearch, $options: 'i' } },
        { 'student.email': { $regex: escapedSearch, $options: 'i' } },
        { 'jobPosting.title': { $regex: escapedSearch, $options: 'i' } }
      ];
    }

    if (Object.keys(matchConditions).length > 0) {
      pipeline.push({ $match: matchConditions });
    }

    // Count total before pagination
    const countPipeline = [...pipeline, { $count: 'total' }];
    const countResult = await Application.aggregate(countPipeline);
    const total = countResult[0]?.total || 0;

    // Add sorting and pagination
    pipeline.push(
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limitNum },
      {
        $project: {
          _id: 1,
          studentId: 1,
          jobPostingId: 1,
          status: 1,
          createdAt: 1,
          reviewedAt: 1,
          rejectionReason: 1,
          'student._id': 1,
          'student.fullName': 1,
          'student.email': 1,
          'student.profileLink': 1,
          'student.isHired': 1,
          'jobPosting._id': 1,
          'jobPosting.title': 1,
          'jobPosting.location': 1,
          'jobPosting.jobType': 1,
          'company._id': 1,
          'company.name': 1
        }
      }
    );

    const applications = await Application.aggregate(pipeline);

    const result = applications.map(app => ({
      id: app._id.toString(),
      studentId: app.studentId.toString(),
      jobPostingId: app.jobPostingId.toString(),
      status: app.status,
      createdAt: app.createdAt,
      reviewedAt: app.reviewedAt,
      rejectionReason: app.rejectionReason,
      student: {
        id: app.student._id.toString(),
        fullName: app.student.fullName,
        email: app.student.email,
        profileLink: app.student.profileLink,
        isHired: app.student.isHired
      },
      jobPosting: {
        id: app.jobPosting._id.toString(),
        title: app.jobPosting.title,
        location: app.jobPosting.location,
        jobType: app.jobPosting.jobType,
        company: {
          id: app.company._id.toString(),
          name: app.company.name
        }
      }
    }));

    res.json({
      applications: result,
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

exports.getCompanyProfileAdmin = async (req, res) => {
  try {
    const { companyId } = req.params;

    const company = await Company.findById(companyId);

    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }

    return res.json(company);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

exports.updateCompanyProfileAdmin = async (req, res) => {
  try {
    const { companyId } = req.params;
    const {
      description,
      website,
      industry,
      size,
      foundedYear,
      socialLinks
    } = req.body || {};

    if (!mongoose.Types.ObjectId.isValid(companyId)) {
      return res.status(400).json({ message: 'Invalid company ID format' });
    }

    const isValidUrl = (value) => {
      if (!value) return true;
      try {
        new URL(value);
        return true;
      } catch (err) {
        return false;
      }
    };

    if (!isValidUrl(website)) {
      return res.status(400).json({ message: 'Invalid website URL' });
    }

    if (!isValidUrl(socialLinks?.linkedin)) {
      return res.status(400).json({ message: 'Invalid LinkedIn URL' });
    }

    if (!isValidUrl(socialLinks?.twitter)) {
      return res.status(400).json({ message: 'Invalid Twitter URL' });
    }

    const company = await Company.findById(companyId);

    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }

    if (description !== undefined) company.description = description;
    if (website !== undefined) company.website = website;
    if (industry !== undefined) company.industry = industry;
    if (size !== undefined) company.size = size;
    if (foundedYear !== undefined) company.foundedYear = foundedYear;

    if (socialLinks !== undefined) {
      company.socialLinks = {
        linkedin: socialLinks?.linkedin ?? company.socialLinks?.linkedin ?? null,
        twitter: socialLinks?.twitter ?? company.socialLinks?.twitter ?? null
      };
    }

    await company.save();
    invalidatePublicCompanyProfileCache(company._id);

    return res.status(200).json(company);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

exports.updateApplication = async (req, res) => {
  try {
    const { appId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(appId)) {
      return res.status(400).json({ error: 'Invalid application ID format' });
    }

    const parsed = adminUpdateApplicationSchema.parse(req.body);

    const application = await Application.findById(appId);

    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }

    if (application.status === 'withdrawn') {
      return res.status(400).json({ error: 'Cannot process withdrawn applications' });
    }

    if (application.status === 'hired') {
      return res.status(400).json({ error: 'Cannot modify applications that have been hired' });
    }

    const updateFields = {
      status: parsed.status
    };

    if (parsed.status === 'reviewed') {
      updateFields.reviewedAt = new Date();
      updateFields.rejectionReason = null;
      updateFields.rejectionSource = null;
    } else if (parsed.status === 'rejected') {
      // Don't set reviewedAt when admin rejects - this keeps it hidden from companies
      updateFields.rejectionReason = parsed.rejectionReason || null;
      updateFields.rejectionSource = 'admin';
    }

    const updatedApp = await Application.findByIdAndUpdate(
      appId,
      { $set: updateFields },
      { returnDocument: 'after' }
    )
      .populate('studentId', 'fullName email profileLink isHired userId')
      .populate({
        path: 'jobPostingId',
        select: 'title companyId',
        populate: {
          path: 'companyId',
          select: 'name userId'
        }
      });

    const responsePayload = {
      id: updatedApp._id.toString(),
      studentId: updatedApp.studentId._id.toString(),
      jobPostingId: updatedApp.jobPostingId._id.toString(),
      status: updatedApp.status,
      createdAt: updatedApp.createdAt,
      reviewedAt: updatedApp.reviewedAt,
      rejectionReason: updatedApp.rejectionReason,
      student: {
        id: updatedApp.studentId._id.toString(),
        fullName: updatedApp.studentId.fullName,
        email: updatedApp.studentId.email,
        profileLink: updatedApp.studentId.profileLink,
        isHired: updatedApp.studentId.isHired
      },
      jobPosting: {
        id: updatedApp.jobPostingId._id.toString(),
        title: updatedApp.jobPostingId.title,
        company: {
          id: updatedApp.jobPostingId.companyId._id.toString(),
          name: updatedApp.jobPostingId.companyId.name
        }
      }
    };

    res.json(responsePayload);

    if (parsed.status === 'reviewed') {
      emailService
        .sendApplicationStatusEmail(
          updatedApp.studentId.email,
          {
            status: 'approved',
            jobTitle: updatedApp.jobPostingId.title,
            companyName: updatedApp.jobPostingId.companyId.name,
            studentName: updatedApp.studentId.fullName
          },
          { userId: updatedApp.studentId.userId }
        )
        .catch((error) => console.error('Failed to send application approval email', error));

      notificationService
        .notifyApplicationApproved(updatedApp.studentId.userId, {
          jobTitle: updatedApp.jobPostingId.title,
          companyName: updatedApp.jobPostingId.companyId.name
        })
        .catch((err) => console.error('Notification error (app approved):', err));

      // Notify company about the new application (after admin approval)
      if (updatedApp.jobPostingId.companyId?.userId) {
        notificationService
          .notifyApplicationReceived(updatedApp.jobPostingId.companyId.userId, {
            jobTitle: updatedApp.jobPostingId.title,
            studentName: updatedApp.studentId.fullName
          })
          .catch((err) => console.error('Notification error (app received by company):', err));
      }
    } else if (parsed.status === 'rejected') {
      emailService
        .sendApplicationStatusEmail(
          updatedApp.studentId.email,
          {
            status: 'rejected',
            jobTitle: updatedApp.jobPostingId.title,
            companyName: updatedApp.jobPostingId.companyId.name,
            studentName: updatedApp.studentId.fullName,
            reason: updatedApp.rejectionReason
          },
          { userId: updatedApp.studentId.userId }
        )
        .catch((error) => console.error('Failed to send application rejection email', error));

      notificationService
        .notifyApplicationRejected(updatedApp.studentId.userId, {
          jobTitle: updatedApp.jobPostingId.title,
          companyName: updatedApp.jobPostingId.companyId.name,
          reason: updatedApp.rejectionReason
        })
        .catch((err) => console.error('Notification error (app rejected):', err));
    }
  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: error.issues[0].message });
    }

    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

// ─── Student Management ───────────────────────────────────────────────────────

exports.getStudents = async (req, res) => {
  try {
    const {
      subscriptionTier,
      hasActiveApplications,
      isHired,
      hasResume,
      hasVideo,
      search,
      page = 1,
      limit = 20
    } = req.query;

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const skip = (pageNum - 1) * limitNum;

    // Build aggregation pipeline
    const pipeline = [];

    // Match conditions for student fields
    const matchConditions = {};

    if (subscriptionTier && ['free', 'paid'].includes(subscriptionTier)) {
      matchConditions.subscriptionTier = subscriptionTier;
    }

    if (isHired !== undefined) {
      matchConditions.isHired = isHired === 'true';
    }

    if (hasResume !== undefined) {
      if (hasResume === 'true') {
        matchConditions.resumeUrl = { $ne: null };
      } else {
        matchConditions.resumeUrl = null;
      }
    }

    if (hasVideo !== undefined) {
      if (hasVideo === 'true') {
        matchConditions.introVideoUrl = { $ne: null };
      } else {
        matchConditions.introVideoUrl = null;
      }
    }

    if (search) {
      const escapedSearch = escapeRegex(search);
      matchConditions.$or = [
        { fullName: { $regex: escapedSearch, $options: 'i' } },
        { email: { $regex: escapedSearch, $options: 'i' } }
      ];
    }

    if (Object.keys(matchConditions).length > 0) {
      pipeline.push({ $match: matchConditions });
    }

    // Lookup applications to count active ones
    pipeline.push({
      $lookup: {
        from: 'applications',
        localField: '_id',
        foreignField: 'studentId',
        as: 'applications'
      }
    });

    // Add computed fields
    pipeline.push({
      $addFields: {
        totalApplications: { $size: '$applications' },
        activeApplications: {
          $size: {
            $filter: {
              input: '$applications',
              cond: { $in: ['$$this.status', ['pending', 'reviewed']] }
            }
          }
        }
      }
    });

    // Filter by hasActiveApplications if specified
    if (hasActiveApplications !== undefined) {
      if (hasActiveApplications === 'true') {
        pipeline.push({ $match: { activeApplications: { $gt: 0 } } });
      } else {
        pipeline.push({ $match: { activeApplications: 0 } });
      }
    }

    // Count total before pagination
    const countPipeline = [...pipeline, { $count: 'total' }];
    const countResult = await Student.aggregate(countPipeline);
    const total = countResult[0]?.total || 0;

    // Add sorting and pagination
    pipeline.push(
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limitNum },
      {
        $project: {
          _id: 1,
          fullName: 1,
          email: 1,
          subscriptionTier: 1,
          isHired: 1,
          hasResume: { $cond: [{ $ne: ['$resumeUrl', null] }, true, false] },
          hasVideo: { $cond: [{ $ne: ['$introVideoUrl', null] }, true, false] },
          totalApplications: 1,
          activeApplications: 1,
          createdAt: 1
        }
      }
    );

    const students = await Student.aggregate(pipeline);

    const result = students.map(s => ({
      id: s._id.toString(),
      fullName: s.fullName,
      email: s.email,
      subscriptionTier: s.subscriptionTier,
      isHired: s.isHired,
      hasResume: s.hasResume,
      hasVideo: s.hasVideo,
      totalApplications: s.totalApplications,
      activeApplications: s.activeApplications,
      createdAt: s.createdAt
    }));

    res.json({
      students: result,
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

exports.getStudentProfile = async (req, res) => {
  try {
    const { studentId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(studentId)) {
      return res.status(400).json({ error: 'Invalid student ID format' });
    }

    const student = await Student.findById(studentId)
      .populate({
        path: 'currentSubscriptionId',
        populate: {
          path: 'serviceId',
          select: 'name description price billingCycle features'
        }
      });

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    // Generate presigned URLs for media files
    const [resumeUrl, introVideoUrl] = await Promise.all([
      student.resumeUrl ? getPresignedUrl(student.resumeUrl) : null,
      student.introVideoUrl ? getPresignedUrl(student.introVideoUrl) : null
    ]);

    // Get payment history
    const payments = await PaymentRecord.find({ studentId: student._id })
      .populate({
        path: 'subscriptionId',
        populate: {
          path: 'serviceId',
          select: 'name price'
        }
      })
      .sort({ paymentDate: -1 });

    // Get all applications with job details
    const applications = await Application.find({ studentId: student._id })
      .populate({
        path: 'jobPostingId',
        select: 'title location jobType salaryRange status',
        populate: {
          path: 'companyId',
          select: 'name'
        }
      })
      .sort({ createdAt: -1 });

    res.json({
      id: student._id,
      fullName: student.fullName,
      email: student.email,
      profileLink: student.profileLink || null,
      bio: student.bio || null,
      location: student.location || null,
      availableFrom: student.availableFrom || null,
      skills: student.skills || [],
      education: student.education || [],
      experience: student.experience || [],
      resumeUrl,
      introVideoUrl,
      isHired: student.isHired,
      createdAt: student.createdAt,
      subscription: {
        tier: student.subscriptionTier,
        current: student.currentSubscriptionId ? {
          id: student.currentSubscriptionId._id,
          status: student.currentSubscriptionId.status,
          startDate: student.currentSubscriptionId.startDate,
          endDate: student.currentSubscriptionId.endDate,
          autoRenew: student.currentSubscriptionId.autoRenew,
          plan: student.currentSubscriptionId.serviceId ? {
            id: student.currentSubscriptionId.serviceId._id,
            name: student.currentSubscriptionId.serviceId.name,
            description: student.currentSubscriptionId.serviceId.description,
            price: student.currentSubscriptionId.serviceId.price,
            billingCycle: student.currentSubscriptionId.serviceId.billingCycle,
            features: student.currentSubscriptionId.serviceId.features
          } : null
        } : null
      },
      payments: payments.map(p => ({
        id: p._id,
        amount: p.amount,
        currency: p.currency,
        status: p.status,
        paymentDate: p.paymentDate,
        paymentMethod: p.paymentMethod,
        transactionId: p.transactionId,
        plan: p.subscriptionId?.serviceId ? {
          name: p.subscriptionId.serviceId.name,
          price: p.subscriptionId.serviceId.price
        } : null
      })),
      applications: applications.map(app => ({
        id: app._id,
        status: app.status,
        createdAt: app.createdAt,
        reviewedAt: app.reviewedAt,
        rejectionReason: app.rejectionReason,
        job: app.jobPostingId ? {
          id: app.jobPostingId._id,
          title: app.jobPostingId.title,
          location: app.jobPostingId.location,
          jobType: app.jobPostingId.jobType,
          salaryRange: app.jobPostingId.salaryRange,
          status: app.jobPostingId.status,
          company: app.jobPostingId.companyId ? {
            id: app.jobPostingId.companyId._id,
            name: app.jobPostingId.companyId.name
          } : null
        } : null
      }))
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.assignStudentSubscription = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { serviceId, endDate, autoRenew = false } = req.body;

    if (!mongoose.Types.ObjectId.isValid(studentId)) {
      return res.status(400).json({ error: 'Invalid student ID format' });
    }

    if (!serviceId || !mongoose.Types.ObjectId.isValid(serviceId)) {
      return res.status(400).json({ error: 'Valid service ID is required' });
    }

    const student = await Student.findById(studentId);

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const service = await AvailableService.findById(serviceId);

    if (!service) {
      return res.status(404).json({ error: 'Subscription plan not found' });
    }

    // Cancel current subscription if exists and is not free
    if (student.currentSubscriptionId) {
      const currentSub = await ActiveSubscription.findById(student.currentSubscriptionId)
        .populate('serviceId', 'tier');

      if (currentSub && currentSub.serviceId?.tier !== 'free') {
        await ActiveSubscription.updateOne(
          { _id: student.currentSubscriptionId },
          { $set: { status: 'cancelled', autoRenew: false } }
        );
      }
    }

    // Calculate end date based on billing cycle
    const now = new Date();
    let calculatedEndDate;

    if (endDate) {
      calculatedEndDate = new Date(endDate);
    } else {
      switch (service.billingCycle) {
        case 'one-time':
          calculatedEndDate = new Date('2099-12-31');
          break;
        case 'yearly':
          calculatedEndDate = new Date(now);
          calculatedEndDate.setFullYear(calculatedEndDate.getFullYear() + 1);
          break;
        case 'quarterly':
          calculatedEndDate = new Date(now);
          calculatedEndDate.setMonth(calculatedEndDate.getMonth() + 3);
          break;
        case 'monthly':
        default:
          calculatedEndDate = new Date(now);
          calculatedEndDate.setMonth(calculatedEndDate.getMonth() + 1);
          break;
      }
    }

    // Create new subscription
    const subscription = await ActiveSubscription.create({
      studentId: student._id,
      serviceId: service._id,
      startDate: now,
      endDate: calculatedEndDate,
      status: 'active',
      autoRenew: service.billingCycle === 'one-time' ? false : Boolean(autoRenew)
    });

    // Update student
    await Student.updateOne(
      { _id: student._id },
      {
        $set: {
          currentSubscriptionId: subscription._id,
          subscriptionTier: service.tier
        }
      }
    );

    const populatedSubscription = await ActiveSubscription.findById(subscription._id)
      .populate('serviceId', 'name description price billingCycle features tier');

    res.json({
      success: true,
      message: `Student assigned to ${service.name} plan`,
      subscription: {
        id: populatedSubscription._id,
        status: populatedSubscription.status,
        startDate: populatedSubscription.startDate,
        endDate: populatedSubscription.endDate,
        autoRenew: populatedSubscription.autoRenew,
        plan: {
          id: populatedSubscription.serviceId._id,
          name: populatedSubscription.serviceId.name,
          description: populatedSubscription.serviceId.description,
          price: populatedSubscription.serviceId.price,
          billingCycle: populatedSubscription.serviceId.billingCycle,
          tier: populatedSubscription.serviceId.tier
        }
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

// ─── Subscription Plan Management ────────────────────────────────────────────

exports.getSubscriptionPlans = async (req, res) => {
  try {
    const { includeInactive = 'true' } = req.query;

    const filter = includeInactive === 'true' ? {} : { isActive: true };
    const plans = await AvailableService.find(filter).sort({ displayOrder: 1, createdAt: -1 });

    res.json({
      plans: plans.map(plan => ({
        id: plan._id,
        name: plan.name,
        description: plan.description,
        maxApplications: plan.maxApplications,
        price: plan.price,
        currency: plan.currency,
        billingCycle: plan.billingCycle,
        trialDays: plan.trialDays,
        discount: plan.discount,
        features: plan.features,
        badge: plan.badge,
        displayOrder: plan.displayOrder,
        resumeDownloadsPerMonth: plan.resumeDownloadsPerMonth,
        videoViewsPerMonth: plan.videoViewsPerMonth,
        prioritySupport: plan.prioritySupport,
        profileBoost: plan.profileBoost,
        applicationHighlight: plan.applicationHighlight,
        isActive: plan.isActive,
        createdAt: plan.createdAt,
        updatedAt: plan.updatedAt
      }))
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getSubscriptionPlan = async (req, res) => {
  try {
    const { planId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(planId)) {
      return res.status(400).json({ error: 'Invalid plan ID format' });
    }

    const plan = await AvailableService.findById(planId);

    if (!plan) {
      return res.status(404).json({ error: 'Subscription plan not found' });
    }

    res.json({
      id: plan._id,
      name: plan.name,
      description: plan.description,
      maxApplications: plan.maxApplications,
      price: plan.price,
      currency: plan.currency,
      billingCycle: plan.billingCycle,
      trialDays: plan.trialDays,
      discount: plan.discount,
      features: plan.features,
      badge: plan.badge,
      displayOrder: plan.displayOrder,
      resumeDownloadsPerMonth: plan.resumeDownloadsPerMonth,
      videoViewsPerMonth: plan.videoViewsPerMonth,
      prioritySupport: plan.prioritySupport,
      profileBoost: plan.profileBoost,
      applicationHighlight: plan.applicationHighlight,
      isActive: plan.isActive,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.createSubscriptionPlan = async (req, res) => {
  try {
    const {
      name,
      description,
      maxApplications,
      price,
      currency,
      billingCycle,
      trialDays,
      discount,
      features,
      badge,
      displayOrder,
      resumeDownloadsPerMonth,
      videoViewsPerMonth,
      prioritySupport,
      profileBoost,
      applicationHighlight,
      isActive
    } = req.body;

    if (!name || name.trim().length < 2) {
      return res.status(400).json({ error: 'Name must be at least 2 characters' });
    }

    if (!description || description.trim().length < 10) {
      return res.status(400).json({ error: 'Description must be at least 10 characters' });
    }

    if (price === undefined || price < 0) {
      return res.status(400).json({ error: 'Price must be a non-negative number' });
    }

    if (currency && !CURRENCIES.includes(currency)) {
      return res.status(400).json({ error: `Currency must be one of: ${CURRENCIES.join(', ')}` });
    }

    if (billingCycle && !BILLING_CYCLES.includes(billingCycle)) {
      return res.status(400).json({ error: `Billing cycle must be one of: ${BILLING_CYCLES.join(', ')}` });
    }

    const plan = await AvailableService.create({
      name: name.trim(),
      description: description.trim(),
      maxApplications: maxApplications || null,
      price,
      currency: currency || 'USD',
      billingCycle: billingCycle || 'monthly',
      trialDays: trialDays || 0,
      discount: discount || 0,
      features: features || [],
      badge: badge?.trim() || null,
      displayOrder: displayOrder || 0,
      resumeDownloadsPerMonth: resumeDownloadsPerMonth || null,
      videoViewsPerMonth: videoViewsPerMonth || null,
      prioritySupport: prioritySupport || false,
      profileBoost: profileBoost || false,
      applicationHighlight: applicationHighlight || false,
      isActive: isActive !== false
    });

    res.status(201).json({
      id: plan._id,
      name: plan.name,
      description: plan.description,
      maxApplications: plan.maxApplications,
      price: plan.price,
      currency: plan.currency,
      billingCycle: plan.billingCycle,
      trialDays: plan.trialDays,
      discount: plan.discount,
      features: plan.features,
      badge: plan.badge,
      displayOrder: plan.displayOrder,
      resumeDownloadsPerMonth: plan.resumeDownloadsPerMonth,
      videoViewsPerMonth: plan.videoViewsPerMonth,
      prioritySupport: plan.prioritySupport,
      profileBoost: plan.profileBoost,
      applicationHighlight: plan.applicationHighlight,
      isActive: plan.isActive,
      createdAt: plan.createdAt
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.updateSubscriptionPlan = async (req, res) => {
  try {
    const { planId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(planId)) {
      return res.status(400).json({ error: 'Invalid plan ID format' });
    }

    const plan = await AvailableService.findById(planId);

    if (!plan) {
      return res.status(404).json({ error: 'Subscription plan not found' });
    }

    const {
      name,
      description,
      maxApplications,
      price,
      currency,
      billingCycle,
      trialDays,
      discount,
      features,
      badge,
      displayOrder,
      resumeDownloadsPerMonth,
      videoViewsPerMonth,
      prioritySupport,
      profileBoost,
      applicationHighlight,
      isActive
    } = req.body;

    if (name !== undefined) {
      if (name.trim().length < 2) {
        return res.status(400).json({ error: 'Name must be at least 2 characters' });
      }
      plan.name = name.trim();
    }

    if (description !== undefined) {
      if (description.trim().length < 10) {
        return res.status(400).json({ error: 'Description must be at least 10 characters' });
      }
      plan.description = description.trim();
    }

    if (price !== undefined) {
      if (price < 0) {
        return res.status(400).json({ error: 'Price must be a non-negative number' });
      }
      plan.price = price;
    }

    if (currency !== undefined) {
      if (!CURRENCIES.includes(currency)) {
        return res.status(400).json({ error: `Currency must be one of: ${CURRENCIES.join(', ')}` });
      }
      plan.currency = currency;
    }

    if (billingCycle !== undefined) {
      if (!BILLING_CYCLES.includes(billingCycle)) {
        return res.status(400).json({ error: `Billing cycle must be one of: ${BILLING_CYCLES.join(', ')}` });
      }
      plan.billingCycle = billingCycle;
    }

    if (maxApplications !== undefined) plan.maxApplications = maxApplications || null;
    if (trialDays !== undefined) plan.trialDays = trialDays;
    if (discount !== undefined) plan.discount = discount;
    if (features !== undefined) plan.features = features;
    if (badge !== undefined) plan.badge = badge?.trim() || null;
    if (displayOrder !== undefined) plan.displayOrder = displayOrder;
    if (resumeDownloadsPerMonth !== undefined) plan.resumeDownloadsPerMonth = resumeDownloadsPerMonth || null;
    if (videoViewsPerMonth !== undefined) plan.videoViewsPerMonth = videoViewsPerMonth || null;
    if (prioritySupport !== undefined) plan.prioritySupport = prioritySupport;
    if (profileBoost !== undefined) plan.profileBoost = profileBoost;
    if (applicationHighlight !== undefined) plan.applicationHighlight = applicationHighlight;
    if (isActive !== undefined) plan.isActive = isActive;

    await plan.save();

    res.json({
      id: plan._id,
      name: plan.name,
      description: plan.description,
      maxApplications: plan.maxApplications,
      price: plan.price,
      currency: plan.currency,
      billingCycle: plan.billingCycle,
      trialDays: plan.trialDays,
      discount: plan.discount,
      features: plan.features,
      badge: plan.badge,
      displayOrder: plan.displayOrder,
      resumeDownloadsPerMonth: plan.resumeDownloadsPerMonth,
      videoViewsPerMonth: plan.videoViewsPerMonth,
      prioritySupport: plan.prioritySupport,
      profileBoost: plan.profileBoost,
      applicationHighlight: plan.applicationHighlight,
      isActive: plan.isActive,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.deleteSubscriptionPlan = async (req, res) => {
  try {
    const { planId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(planId)) {
      return res.status(400).json({ error: 'Invalid plan ID format' });
    }

    const plan = await AvailableService.findById(planId);

    if (!plan) {
      return res.status(404).json({ error: 'Subscription plan not found' });
    }

    // Soft delete by setting isActive to false
    plan.isActive = false;
    await plan.save();

    res.json({ success: true, message: 'Subscription plan deactivated' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

// ─── Free Tier Configuration ─────────────────────────────────────────────────

exports.getFreeTierConfig = async (req, res) => {
  try {
    const [maxApplications, features, resumeDownloads, videoViews] = await Promise.all([
      SystemConfig.getValue(CONFIG_KEYS.FREE_TIER_MAX_APPLICATIONS, 2),
      SystemConfig.getValue(CONFIG_KEYS.FREE_TIER_FEATURES, []),
      SystemConfig.getValue(CONFIG_KEYS.FREE_TIER_RESUME_DOWNLOADS, null),
      SystemConfig.getValue(CONFIG_KEYS.FREE_TIER_VIDEO_VIEWS, null)
    ]);

    res.json({
      maxApplications,
      features,
      resumeDownloadsPerMonth: resumeDownloads,
      videoViewsPerMonth: videoViews
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.updateFreeTierConfig = async (req, res) => {
  try {
    const { maxApplications, features, resumeDownloadsPerMonth, videoViewsPerMonth } = req.body;

    const updates = [];

    if (maxApplications !== undefined) {
      if (maxApplications !== null && (maxApplications < 0 || !Number.isInteger(maxApplications))) {
        return res.status(400).json({ error: 'Max applications must be a non-negative integer or null for unlimited' });
      }
      updates.push(
        SystemConfig.setValue(
          CONFIG_KEYS.FREE_TIER_MAX_APPLICATIONS,
          maxApplications,
          'Maximum applications allowed for free tier',
          req.user.userId
        )
      );
    }

    if (features !== undefined) {
      if (!Array.isArray(features)) {
        return res.status(400).json({ error: 'Features must be an array' });
      }
      updates.push(
        SystemConfig.setValue(
          CONFIG_KEYS.FREE_TIER_FEATURES,
          features,
          'Features available for free tier',
          req.user.userId
        )
      );
    }

    if (resumeDownloadsPerMonth !== undefined) {
      updates.push(
        SystemConfig.setValue(
          CONFIG_KEYS.FREE_TIER_RESUME_DOWNLOADS,
          resumeDownloadsPerMonth,
          'Resume downloads per month for free tier',
          req.user.userId
        )
      );
    }

    if (videoViewsPerMonth !== undefined) {
      updates.push(
        SystemConfig.setValue(
          CONFIG_KEYS.FREE_TIER_VIDEO_VIEWS,
          videoViewsPerMonth,
          'Video views per month for free tier',
          req.user.userId
        )
      );
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    await Promise.all(updates);

    // Return updated config
    const [updatedMaxApps, updatedFeatures, updatedResumeDownloads, updatedVideoViews] = await Promise.all([
      SystemConfig.getValue(CONFIG_KEYS.FREE_TIER_MAX_APPLICATIONS, 2),
      SystemConfig.getValue(CONFIG_KEYS.FREE_TIER_FEATURES, []),
      SystemConfig.getValue(CONFIG_KEYS.FREE_TIER_RESUME_DOWNLOADS, null),
      SystemConfig.getValue(CONFIG_KEYS.FREE_TIER_VIDEO_VIEWS, null)
    ]);

    res.json({
      maxApplications: updatedMaxApps,
      features: updatedFeatures,
      resumeDownloadsPerMonth: updatedResumeDownloads,
      videoViewsPerMonth: updatedVideoViews
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};
