const mongoose = require('mongoose');

const Company = require('../models/Company');
const JobPosting = require('../models/JobPosting');
const Application = require('../models/Application');
const Student = require('../models/Student');
const { createJobSchema, updateJobSchema } = require('../utils/validation');
const { JOB_STATUSES, JOB_TYPES, APPLICATION_STATUSES } = require('../constants');

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
          pendingJobs: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } }
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
      return res.status(400).json({ error: 'Status must be pending, approved, rejected, or closed' });
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
    const parsed = createJobSchema.parse(req.body);

    const company = await Company.findOne({ userId: req.user.userId });

    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const job = await JobPosting.create({
      companyId: company._id,
      title: parsed.title,
      description: parsed.description,
      requirements: parsed.requirements || null,
      location: parsed.location,
      jobType: parsed.jobType,
      salaryRange: parsed.salaryRange || null,
      deadline: parsed.deadline ? new Date(parsed.deadline) : null,
      status: 'pending'
    });

    res.status(201).json(job);
  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: error.errors[0].message });
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

    const parsed = updateJobSchema.parse(req.body);

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

    if (job.status !== 'pending') {
      return res.status(403).json({ error: 'Can only edit jobs that are pending approval' });
    }

    // Build update fields
    const updateFields = {};
    if (parsed.title !== undefined) updateFields.title = parsed.title;
    if (parsed.description !== undefined) updateFields.description = parsed.description;
    if (parsed.requirements !== undefined) updateFields.requirements = parsed.requirements;
    if (parsed.location !== undefined) updateFields.location = parsed.location;
    if (parsed.jobType !== undefined) updateFields.jobType = parsed.jobType;
    if (parsed.salaryRange !== undefined) updateFields.salaryRange = parsed.salaryRange;
    if (parsed.deadline !== undefined) updateFields.deadline = parsed.deadline ? new Date(parsed.deadline) : null;

    const updatedJob = await JobPosting.findByIdAndUpdate(
      jobId,
      { $set: updateFields },
      { new: true, runValidators: true }
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
      .populate('studentId', 'fullName email profileLink isHired')
      .populate('jobPostingId', 'title');

    res.json(updatedApp);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};
