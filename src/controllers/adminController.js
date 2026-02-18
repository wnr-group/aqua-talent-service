const mongoose = require('mongoose');

const Company = require('../models/Company');
const JobPosting = require('../models/JobPosting');
const Student = require('../models/Student');
const Application = require('../models/Application');
const {
  updateCompanyStatusSchema,
  updateJobStatusSchema,
  adminUpdateApplicationSchema,
  companyProfileSchema
} = require('../utils/validation');
const { COMPANY_STATUSES, JOB_STATUSES, APPLICATION_STATUSES, JOB_TYPES } = require('../constants');
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
    const { status } = req.query;

    if (status && !COMPANY_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Status must be pending, approved, or rejected' });
    }

    const query = {};
    if (status) {
      query.status = status;
    }

    const companies = await Company.aggregate([
      { $match: query },
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'user'
        }
      },
      { $unwind: '$user' },
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
      { $sort: { createdAt: -1 } }
    ]);

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

    res.json({ companies: result });
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
  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: error.errors[0].message });
    }

    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getJobs = async (req, res) => {
  try {
    const { status, search, location, jobType, page = 1, limit = 10 } = req.query;

    if (status && !JOB_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Status must be pending, approved, rejected, or closed' });
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
    ).populate('companyId', 'name');

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
  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: error.errors[0].message });
    }

    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getApplications = async (req, res) => {
  try {
    const { status, search, jobType, location, page = 1, limit = 10 } = req.query;

    if (status && !APPLICATION_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Status must be pending, reviewed, hired, rejected, or withdrawn' });
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
    } else if (parsed.status === 'rejected') {
      // Don't set reviewedAt when admin rejects - this keeps it hidden from companies
      updateFields.rejectionReason = parsed.rejectionReason || null;
    }

    const updatedApp = await Application.findByIdAndUpdate(
      appId,
      { $set: updateFields },
      { returnDocument: 'after' }
    )
      .populate('studentId', 'fullName email profileLink isHired')
      .populate({
        path: 'jobPostingId',
        select: 'title companyId',
        populate: {
          path: 'companyId',
          select: 'name'
        }
      });

    res.json({
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
    });
  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: error.errors[0].message });
    }

    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};
