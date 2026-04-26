const mongoose = require('mongoose');

const User = require('../models/User');
const Company = require('../models/Company');
const JobPosting = require('../models/JobPosting');
const Student = require('../models/Student');
const Application = require('../models/Application');
const AvailableService = require('../models/AvailableService');
const ActiveSubscription = require('../models/ActiveSubscription');
const PaymentRecord = require('../models/PaymentRecord');
const SystemConfig = require('../models/SystemConfig');
const Zone = require('../models/Zone');
const ZoneCountry = require('../models/ZoneCountry');
const PlanZone = require('../models/PlanZone');
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

const buildSubscriptionPlanResponse = (plan) => ({
  id: plan._id,
  name: plan.name,
  description: plan.description,
  maxApplications: plan.maxApplications,
  price: plan.price,
  priceINR: plan.priceINR,
  priceUSD: plan.priceUSD,
  currency: plan.currency,
  billingCycle: 'one-time',
  discount: plan.discount,
  features: plan.features,
  badge: plan.badge,
  displayOrder: plan.displayOrder,
  resumeDownloads: plan.resumeDownloads,
  videoViews: plan.videoViews,
  prioritySupport: plan.prioritySupport,
  profileBoost: plan.profileBoost,
  applicationHighlight: plan.applicationHighlight,
  allZonesIncluded: plan.allZonesIncluded,
  isActive: plan.isActive,
  createdAt: plan.createdAt,
  updatedAt: plan.updatedAt
});

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
          isActive: '$user.isActive',
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
      isActive: c.isActive !== false,
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

    const company = await Company.findById(companyId).populate('userId', 'isActive');

    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }

    const companyObj = company.toObject();
    companyObj.isActive = company.userId?.isActive !== false;

    return res.json(companyObj);
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
        { email: { $regex: escapedSearch, $options: 'i' } },
        { studentId: { $regex: escapedSearch, $options: 'i' } }
      ];
    }

    if (Object.keys(matchConditions).length > 0) {
      pipeline.push({ $match: matchConditions });
    }

    // Lookup user to get isActive
    pipeline.push({
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'user'
      }
    });
    pipeline.push({ $unwind: { path: '$user', preserveNullAndEmpty: true } });

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
          studentId: 1,
          fullName: 1,
          email: 1,
          subscriptionTier: 1,
          isHired: 1,
          isActive: '$user.isActive',
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
      studentId: s.studentId || null,
      fullName: s.fullName,
      email: s.email,
      subscriptionTier: s.subscriptionTier,
      isHired: s.isHired,
      isActive: s.isActive !== false,
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
      .populate('userId', 'isActive')
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

    // Get payment history with detailed type information
    const payments = await PaymentRecord.find({ studentId: student._id })
      .populate({
        path: 'subscriptionId',
        populate: {
          path: 'serviceId',
          select: 'name price'
        }
      })
      .populate('serviceId', 'name price')
      .sort({ paymentDate: -1 });

    // Get pay-per-job purchases for this student to enrich payment data
    const PayPerJobPurchase = require('../models/PayPerJobPurchase');
    const JobPosting = require('../models/JobPosting');
    const payPerJobPurchases = await PayPerJobPurchase.find({
      studentId: student._id
    }).populate('jobPostingId', 'title').lean();
    // Map by razorpayOrderId for lookup
    const payPerJobByOrderId = new Map(
      payPerJobPurchases
        .filter(p => p.razorpayOrderId)
        .map(p => [p.razorpayOrderId, p])
    );

    // Get subscription addons to enrich payment data
    const SubscriptionAddon = require('../models/SubscriptionAddon');
    const subscriptionAddons = await SubscriptionAddon.find({
      paymentRecordId: { $in: payments.map(p => p._id) }
    }).populate('addonId', 'name type').lean();
    const addonByPaymentId = new Map(
      subscriptionAddons.map(sa => [sa.paymentRecordId.toString(), sa])
    );

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
      studentId: student.studentId || null,
      fullName: student.fullName,
      email: student.email,
      isActive: student.userId?.isActive !== false,
      isDGShipping: student.isDGShipping || 'no',
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
      payments: payments.map(p => {
        // Determine payment type from gatewayResponse or related records
        let paymentType = 'unknown';
        let typeLabel = 'Unknown';
        let details = null;

        const gatewayType = p.gatewayResponse?.type;
        // Get order ID from either field or gatewayResponse
        const orderId = p.razorpayOrderId || p.gatewayResponse?.orderId;

        if (gatewayType === 'pay_per_job') {
          paymentType = 'pay-per-job';
          typeLabel = 'Pay Per Job';
          // Look up by order ID from gatewayResponse
          const purchase = payPerJobByOrderId.get(orderId);
          if (purchase?.jobPostingId) {
            details = {
              jobId: purchase.jobPostingId._id,
              jobTitle: purchase.jobPostingId.title
            };
          }
        } else if (gatewayType === 'zone_addon') {
          paymentType = 'zone-addon';
          typeLabel = 'Zone Addon';
          const addon = addonByPaymentId.get(p._id.toString());
          if (addon?.addonId) {
            details = {
              addonId: addon.addonId._id,
              addonName: addon.addonId.name
            };
          }
        } else if (p.subscriptionId?.serviceId) {
          // Has subscription = plan purchase (completed or pending)
          paymentType = 'plan';
          typeLabel = 'Plan Purchase';
          details = {
            planId: p.subscriptionId.serviceId._id,
            planName: p.subscriptionId.serviceId.name,
            planPrice: p.subscriptionId.serviceId.price
          };
        } else if (p.serviceId) {
          // Has serviceId but no subscription = pending plan purchase
          paymentType = 'plan';
          typeLabel = 'Plan Purchase';
          details = {
            planId: p.serviceId._id,
            planName: p.serviceId.name,
            planPrice: p.serviceId.price
          };
        }

        return {
          id: p._id,
          type: paymentType,
          typeLabel,
          amount: p.amount,
          currency: p.currency,
          status: p.status,
          paymentDate: p.paymentDate,
          paymentMethod: p.paymentMethod,
          razorpayOrderId: orderId || null,
          razorpayPaymentId: p.razorpayPaymentId || null,
          transactionId: p.razorpayPaymentId || p.transactionId,
          details
        };
      }),
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
    const { serviceId } = req.body;

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

    // Mark current subscription as exhausted if exists and is not free
    if (student.currentSubscriptionId) {
      const currentSub = await ActiveSubscription.findById(student.currentSubscriptionId)
        .populate('serviceId', 'tier');

      if (currentSub && currentSub.serviceId?.tier !== 'free') {
        await ActiveSubscription.updateOne(
          { _id: student.currentSubscriptionId },
          { $set: { status: 'exhausted', autoRenew: false } }
        );
      }
    }

    const now = new Date();

    // Create new quota-based subscription
    const subscription = await ActiveSubscription.create({
      studentId: student._id,
      serviceId: service._id,
      startDate: now,
      endDate: null,
      status: 'active',
      autoRenew: false,
      applicationsUsed: 0,
      maxApplications: service.maxApplications
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
      plans: plans.map(buildSubscriptionPlanResponse)
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

    res.json(buildSubscriptionPlanResponse(plan));
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

    // Use priceINR as the primary price, fallback to price
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

    // Normalize empty string / undefined to null (null = unlimited)
    const normalizedMaxApplications = (maxApplications === '' || maxApplications === undefined) ? null : maxApplications;

    if (normalizedMaxApplications !== null && normalizedMaxApplications < 1) {
      return res.status(400).json({ error: 'maxApplications must be at least 1, or omit it for unlimited' });
    }

    const plan = await AvailableService.create({
      name: name.trim(),
      description: description.trim(),
      maxApplications: normalizedMaxApplications,
      price: inrPrice,
      priceINR: inrPrice,
      priceUSD: priceUSD ?? 0,
      currency: currency || 'INR',
      billingCycle: 'one-time',
      discount: discount || 0,
      features: features || [],
      badge: badge?.trim() || null,
      displayOrder: displayOrder || 0,
      resumeDownloads: resumeDownloads || null,
      videoViews: videoViews || null,
      prioritySupport: prioritySupport || false,
      profileBoost: profileBoost || false,
      applicationHighlight: applicationHighlight || false,
      allZonesIncluded: allZonesIncluded || false,
      isActive: isActive !== false
    });

    res.status(201).json(buildSubscriptionPlanResponse(plan));
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

    // Handle price updates - support both price and priceINR
    if (price !== undefined || priceINR !== undefined) {
      const newPrice = priceINR ?? price;
      if (newPrice < 0) {
        return res.status(400).json({ error: 'Price (INR) must be a non-negative number' });
      }
      plan.price = newPrice;
      plan.priceINR = newPrice;
    }

    if (priceUSD !== undefined) {
      if (priceUSD !== null && priceUSD < 0) {
        return res.status(400).json({ error: 'Price (USD) must be a non-negative number' });
      }
      plan.priceUSD = priceUSD;
    }

    if (currency !== undefined) {
      if (!CURRENCIES.includes(currency)) {
        return res.status(400).json({ error: `Currency must be one of: ${CURRENCIES.join(', ')}` });
      }
      plan.currency = currency;
    }

    if (maxApplications !== undefined) {
      if (plan.tier === 'free') {
        // Free plan limit is permanently fixed at 2
        plan.maxApplications = 2;
      } else {
        // Normalize empty string to null (unlimited)
        const normalizedMax = maxApplications === '' ? null : maxApplications;
        if (normalizedMax !== null && normalizedMax < 1) {
          return res.status(400).json({ error: 'maxApplications must be at least 1, or null for unlimited' });
        }
        plan.maxApplications = normalizedMax;
      }
    }
    if (discount !== undefined) plan.discount = discount;
    if (features !== undefined) plan.features = features;
    if (badge !== undefined) plan.badge = badge?.trim() || null;
    if (displayOrder !== undefined) plan.displayOrder = displayOrder;
    if (resumeDownloads !== undefined) plan.resumeDownloads = resumeDownloads || null;
    if (videoViews !== undefined) plan.videoViews = videoViews || null;
    if (prioritySupport !== undefined) plan.prioritySupport = prioritySupport;
    if (profileBoost !== undefined) plan.profileBoost = profileBoost;
    if (applicationHighlight !== undefined) plan.applicationHighlight = applicationHighlight;
    if (allZonesIncluded !== undefined) plan.allZonesIncluded = allZonesIncluded;
    if (isActive !== undefined) plan.isActive = isActive;

    await plan.save();

    res.json(buildSubscriptionPlanResponse(plan));
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
    const [features, resumeDownloads, videoViews] = await Promise.all([
      SystemConfig.getValue(CONFIG_KEYS.FREE_TIER_FEATURES, []),
      SystemConfig.getValue(CONFIG_KEYS.FREE_TIER_RESUME_DOWNLOADS, null),
      SystemConfig.getValue(CONFIG_KEYS.FREE_TIER_VIDEO_VIEWS, null)
    ]);

    res.json({
      maxApplications: 2,
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
      if (maxApplications !== 2) {
        return res.status(400).json({ error: 'Free tier max applications is fixed at 2' });
      }
      updates.push(
        SystemConfig.setValue(
          CONFIG_KEYS.FREE_TIER_MAX_APPLICATIONS,
          2,
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
    const [updatedFeatures, updatedResumeDownloads, updatedVideoViews] = await Promise.all([
      SystemConfig.getValue(CONFIG_KEYS.FREE_TIER_FEATURES, []),
      SystemConfig.getValue(CONFIG_KEYS.FREE_TIER_RESUME_DOWNLOADS, null),
      SystemConfig.getValue(CONFIG_KEYS.FREE_TIER_VIDEO_VIEWS, null)
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

// ─── Zone Management ─────────────────────────────────────────────────────────

exports.getZones = async (req, res) => {
  try {
    const zones = await Zone.find().sort({ name: 1 }).lean();

    const zonesWithCountries = await Promise.all(zones.map(async (zone) => {
      const countries = await ZoneCountry.find({ zoneId: zone._id })
        .select('_id countryName')
        .sort({ countryName: 1 })
        .lean();

      return {
        id: zone._id,
        name: zone.name,
        description: zone.description,
        countries: countries.map(c => ({ id: c._id, name: c.countryName })),
        countryCount: countries.length
      };
    }));

    res.json({ zones: zonesWithCountries });
  } catch (error) {
    console.error('Get zones error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.createZone = async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name || !description) {
      return res.status(400).json({ error: 'Name and description are required' });
    }

    const existingZone = await Zone.findOne({ name: name.trim() });
    if (existingZone) {
      return res.status(409).json({ error: 'Zone with this name already exists' });
    }

    const zone = await Zone.create({
      name: name.trim(),
      description: description.trim()
    });

    res.status(201).json({
      id: zone._id,
      name: zone.name,
      description: zone.description,
      countries: [],
      countryCount: 0
    });
  } catch (error) {
    console.error('Create zone error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.updateZone = async (req, res) => {
  try {
    const { zoneId } = req.params;
    const { name, description } = req.body;

    if (!mongoose.Types.ObjectId.isValid(zoneId)) {
      return res.status(400).json({ error: 'Invalid zone ID' });
    }

    const zone = await Zone.findById(zoneId);
    if (!zone) {
      return res.status(404).json({ error: 'Zone not found' });
    }

    if (name !== undefined) {
      const existingZone = await Zone.findOne({
        name: name.trim(),
        _id: { $ne: zoneId }
      });
      if (existingZone) {
        return res.status(409).json({ error: 'Zone with this name already exists' });
      }
      zone.name = name.trim();
    }

    if (description !== undefined) {
      zone.description = description.trim();
    }

    await zone.save();

    res.json({
      id: zone._id,
      name: zone.name,
      description: zone.description
    });
  } catch (error) {
    console.error('Update zone error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.deleteZone = async (req, res) => {
  try {
    const { zoneId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(zoneId)) {
      return res.status(400).json({ error: 'Invalid zone ID' });
    }

    const planCount = await PlanZone.countDocuments({ zoneId });
    if (planCount > 0) {
      return res.status(400).json({
        error: 'Cannot delete zone that is assigned to plans',
        planCount
      });
    }

    const countries = await ZoneCountry.find({ zoneId }).select('_id');
    const countryIds = countries.map(c => c._id);

    const JobPosting = require('../models/JobPosting');
    const jobCount = await JobPosting.countDocuments({ countryId: { $in: countryIds } });
    if (jobCount > 0) {
      return res.status(400).json({
        error: 'Cannot delete zone with countries that have jobs assigned',
        jobCount
      });
    }

    await ZoneCountry.deleteMany({ zoneId });
    await Zone.findByIdAndDelete(zoneId);

    res.json({ success: true });
  } catch (error) {
    console.error('Delete zone error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.addCountryToZone = async (req, res) => {
  try {
    const { zoneId } = req.params;
    const { countryName } = req.body;

    if (!mongoose.Types.ObjectId.isValid(zoneId)) {
      return res.status(400).json({ error: 'Invalid zone ID' });
    }

    if (!countryName || typeof countryName !== 'string') {
      return res.status(400).json({ error: 'Country name is required' });
    }

    const zone = await Zone.findById(zoneId);
    if (!zone) {
      return res.status(404).json({ error: 'Zone not found' });
    }

    const existingCountry = await ZoneCountry.findOne({
      countryName: countryName.trim()
    });
    if (existingCountry) {
      return res.status(409).json({
        error: 'Country already exists',
        existingZoneId: existingCountry.zoneId
      });
    }

    const country = await ZoneCountry.create({
      zoneId,
      countryName: countryName.trim()
    });

    res.status(201).json({
      id: country._id,
      name: country.countryName,
      zoneId: country.zoneId
    });
  } catch (error) {
    console.error('Add country to zone error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.removeCountryFromZone = async (req, res) => {
  try {
    const { zoneId, countryId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(zoneId) || !mongoose.Types.ObjectId.isValid(countryId)) {
      return res.status(400).json({ error: 'Invalid zone or country ID' });
    }

    const country = await ZoneCountry.findOne({ _id: countryId, zoneId });
    if (!country) {
      return res.status(404).json({ error: 'Country not found in this zone' });
    }

    const JobPosting = require('../models/JobPosting');
    const jobCount = await JobPosting.countDocuments({ countryId });
    if (jobCount > 0) {
      return res.status(400).json({
        error: 'Cannot remove country that has jobs assigned',
        jobCount
      });
    }

    await ZoneCountry.findByIdAndDelete(countryId);

    res.json({ success: true });
  } catch (error) {
    console.error('Remove country from zone error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getPlanZones = async (req, res) => {
  try {
    const { planId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(planId)) {
      return res.status(400).json({ error: 'Invalid plan ID' });
    }

    const AvailableService = require('../models/AvailableService');
    const plan = await AvailableService.findById(planId);
    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    const planZones = await PlanZone.find({ planId })
      .populate('zoneId', 'name description')
      .lean();

    const zones = planZones
      .filter(pz => pz.zoneId)
      .map(pz => ({
        id: pz.zoneId._id,
        name: pz.zoneId.name,
        description: pz.zoneId.description
      }));

    res.json({
      planId,
      planName: plan.name,
      allZonesIncluded: plan.allZonesIncluded,
      zones
    });
  } catch (error) {
    console.error('Get plan zones error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.setPlanZones = async (req, res) => {
  try {
    const { planId } = req.params;
    const { zoneIds, allZonesIncluded } = req.body;

    if (!mongoose.Types.ObjectId.isValid(planId)) {
      return res.status(400).json({ error: 'Invalid plan ID' });
    }

    const AvailableService = require('../models/AvailableService');
    const plan = await AvailableService.findById(planId);
    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    if (typeof allZonesIncluded === 'boolean') {
      plan.allZonesIncluded = allZonesIncluded;
      await plan.save();
    }

    if (plan.allZonesIncluded) {
      await PlanZone.deleteMany({ planId });
      return res.json({
        planId,
        planName: plan.name,
        allZonesIncluded: true,
        zones: []
      });
    }

    if (!Array.isArray(zoneIds)) {
      return res.status(400).json({ error: 'zoneIds must be an array' });
    }

    const validZoneIds = zoneIds.filter(id => mongoose.Types.ObjectId.isValid(id));
    const zones = await Zone.find({ _id: { $in: validZoneIds } });

    if (zones.length !== validZoneIds.length) {
      return res.status(400).json({ error: 'Some zone IDs are invalid' });
    }

    await PlanZone.deleteMany({ planId });

    if (validZoneIds.length > 0) {
      const planZonesDocs = validZoneIds.map(zoneId => ({
        planId,
        zoneId
      }));
      await PlanZone.insertMany(planZonesDocs);
    }

    res.json({
      planId,
      planName: plan.name,
      allZonesIncluded: plan.allZonesIncluded,
      zones: zones.map(z => ({
        id: z._id,
        name: z.name,
        description: z.description
      }))
    });
  } catch (error) {
    console.error('Set plan zones error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// ===========================
// Addon Management
// ===========================

exports.getAddons = async (req, res) => {
  try {
    const Addon = require('../models/Addon');
    const addons = await Addon.find().sort({ type: 1, name: 1 }).lean();

    const formattedAddons = addons.map(a => ({
      id: a._id,
      name: a.name,
      type: a.type,
      priceINR: a.priceINR,
      priceUSD: a.priceUSD,
      zoneCount: a.zoneCount,
      jobCreditCount: a.jobCreditCount,
      unlockAllZones: a.unlockAllZones,
      createdAt: a.createdAt
    }));

    res.json({ addons: formattedAddons });
  } catch (error) {
    console.error('Get addons error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.createAddon = async (req, res) => {
  try {
    const Addon = require('../models/Addon');
    const { name, type, priceINR, priceUSD, zoneCount, jobCreditCount, unlockAllZones } = req.body;

    if (!name || !type) {
      return res.status(400).json({ error: 'Name and type are required' });
    }

    if (!['zone', 'jobs'].includes(type)) {
      return res.status(400).json({ error: 'Type must be zone or jobs' });
    }

    const existingAddon = await Addon.findOne({ name: name.trim() });
    if (existingAddon) {
      return res.status(409).json({ error: 'Addon with this name already exists' });
    }

    const addonData = {
      name: name.trim(),
      type,
      priceINR: priceINR || null,
      priceUSD: priceUSD || null
    };

    if (type === 'zone') {
      addonData.unlockAllZones = unlockAllZones || false;
      if (!unlockAllZones) {
        addonData.zoneCount = zoneCount;
      }
    } else if (type === 'jobs') {
      addonData.jobCreditCount = jobCreditCount;
    }

    const addon = await Addon.create(addonData);

    res.status(201).json({
      id: addon._id,
      name: addon.name,
      type: addon.type,
      priceINR: addon.priceINR,
      priceUSD: addon.priceUSD,
      zoneCount: addon.zoneCount,
      jobCreditCount: addon.jobCreditCount,
      unlockAllZones: addon.unlockAllZones
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    console.error('Create addon error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.updateAddon = async (req, res) => {
  try {
    const Addon = require('../models/Addon');
    const { addonId } = req.params;
    const { name, priceINR, priceUSD, zoneCount, jobCreditCount, unlockAllZones } = req.body;

    if (!mongoose.Types.ObjectId.isValid(addonId)) {
      return res.status(400).json({ error: 'Invalid addon ID' });
    }

    const addon = await Addon.findById(addonId);
    if (!addon) {
      return res.status(404).json({ error: 'Addon not found' });
    }

    if (name !== undefined) {
      const existingAddon = await Addon.findOne({
        name: name.trim(),
        _id: { $ne: addonId }
      });
      if (existingAddon) {
        return res.status(409).json({ error: 'Addon with this name already exists' });
      }
      addon.name = name.trim();
    }

    if (priceINR !== undefined) addon.priceINR = priceINR;
    if (priceUSD !== undefined) addon.priceUSD = priceUSD;

    if (addon.type === 'zone') {
      if (unlockAllZones !== undefined) addon.unlockAllZones = unlockAllZones;
      if (zoneCount !== undefined && !addon.unlockAllZones) addon.zoneCount = zoneCount;
    } else if (addon.type === 'jobs') {
      if (jobCreditCount !== undefined) addon.jobCreditCount = jobCreditCount;
    }

    await addon.save();

    res.json({
      id: addon._id,
      name: addon.name,
      type: addon.type,
      priceINR: addon.priceINR,
      priceUSD: addon.priceUSD,
      zoneCount: addon.zoneCount,
      jobCreditCount: addon.jobCreditCount,
      unlockAllZones: addon.unlockAllZones
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ error: error.message });
    }
    console.error('Update addon error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.deleteAddon = async (req, res) => {
  try {
    const Addon = require('../models/Addon');
    const SubscriptionAddon = require('../models/SubscriptionAddon');
    const { addonId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(addonId)) {
      return res.status(400).json({ error: 'Invalid addon ID' });
    }

    const purchaseCount = await SubscriptionAddon.countDocuments({ addonId });
    if (purchaseCount > 0) {
      return res.status(400).json({
        error: 'Cannot delete addon that has been purchased',
        purchaseCount
      });
    }

    await Addon.findByIdAndDelete(addonId);

    res.json({ success: true });
  } catch (error) {
    console.error('Delete addon error:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

// ─── Account Lifecycle ────────────────────────────────────────────────────────

exports.setStudentActiveStatus = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { isActive } = req.body;
    const student = await Student.findById(studentId);
    if (!student) return res.status(404).json({ success: false, message: 'Student not found' });
    await User.findByIdAndUpdate(student.userId, { isActive });
    res.json({ success: true, isActive });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.setCompanyActiveStatus = async (req, res) => {
  try {
    const { companyId } = req.params;
    const { isActive } = req.body;
    const company = await Company.findById(companyId);
    if (!company) return res.status(404).json({ success: false, message: 'Company not found' });
    await User.findByIdAndUpdate(company.userId, { isActive });
    res.json({ success: true, isActive });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
