const mongoose = require('mongoose');

const Student = require('../models/Student');
const JobPosting = require('../models/JobPosting');
const Application = require('../models/Application');
const { getApplicationLimit } = require('../services/subscriptionService');

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

exports.getDashboard = async (req, res) => {
  try {
    const student = await Student.findOne({ userId: req.user.userId });

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const stats = await Application.aggregate([
      { $match: { studentId: student._id } },
      {
        $group: {
          _id: null,
          applicationsUsed: {
            $sum: { $cond: [{ $not: [{ $in: ['$status', ['withdrawn', 'rejected']] }] }, 1, 0] }
          },
          pendingApplications: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
          }
        }
      }
    ]);

    const applicationLimit = await getApplicationLimit(student._id);
    const hasUnlimitedApplications = applicationLimit === Infinity;

    res.json({
      applicationsUsed: stats[0]?.applicationsUsed || 0,
      applicationLimit: hasUnlimitedApplications ? null : applicationLimit,
      hasUnlimitedApplications,
      subscriptionTier: student.subscriptionTier,
      pendingApplications: stats[0]?.pendingApplications || 0,
      isHired: student.isHired
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getJobs = async (req, res) => {
  try {
    const { search, location, jobType, page = 1, limit = 10 } = req.query;

    const query = { status: 'approved' };

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
        .limit(limitNum)
        .select('-rejectionReason -approvedAt -status'),
      JobPosting.countDocuments(query)
    ]);

    const transformedJobs = jobs.map(job => {
      const jobObj = job.toObject();
      return {
        id: jobObj._id,
        title: jobObj.title,
        description: jobObj.description,
        requirements: jobObj.requirements,
        location: jobObj.location,
        jobType: jobObj.jobType,
        salaryRange: jobObj.salaryRange,
        deadline: jobObj.deadline,
        createdAt: jobObj.createdAt,
        company: jobObj.companyId ? {
          id: jobObj.companyId._id,
          name: jobObj.companyId.name
        } : null
      };
    });

    res.json({
      jobs: transformedJobs,
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

    const job = await JobPosting.findOne({ _id: jobId, status: 'approved' })
      .populate('companyId', 'name')
      .select('-rejectionReason -approvedAt -status');

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    let hasApplied = false;
    let applicationStatus = null;

    if (req.user && req.user.userType === 'student') {
      const student = await Student.findOne({ userId: req.user.userId });
      if (student) {
        const application = await Application.findOne({
          studentId: student._id,
          jobPostingId: jobId
        });

        if (application) {
          hasApplied = true;
          applicationStatus = application.status;
        }
      }
    }

    const jobObj = job.toObject();

    res.json({
      id: jobObj._id,
      title: jobObj.title,
      description: jobObj.description,
      requirements: jobObj.requirements,
      location: jobObj.location,
      jobType: jobObj.jobType,
      salaryRange: jobObj.salaryRange,
      deadline: jobObj.deadline,
      createdAt: jobObj.createdAt,
      company: jobObj.companyId ? {
        id: jobObj.companyId._id,
        name: jobObj.companyId.name
      } : null,
      hasApplied,
      applicationStatus
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.applyToJob = async (req, res) => {
  try {
    const { jobId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(jobId)) {
      return res.status(400).json({ error: 'Invalid job ID format' });
    }

    const student = await Student.findOne({ userId: req.user.userId });

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    if (student.isHired) {
      return res.status(403).json({
        error: 'Hired students cannot apply to new jobs.'
      });
    }

    const activeApplications = await Application.countDocuments({
      studentId: student._id,
      status: { $nin: ['withdrawn', 'rejected'] }
    });

    if (student.subscriptionTier !== 'paid' && activeApplications >= 2) {
      return res.status(403).json({ error: 'Application limit reached' });
    }

    const existingApp = await Application.findOne({
      studentId: student._id,
      jobPostingId: jobId
    });

    if (existingApp && existingApp.status !== 'withdrawn') {
      return res.status(400).json({ error: 'You have already applied to this job' });
    }

    const job = await JobPosting.findOne({ _id: jobId, status: 'approved' });

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    let application;

    if (existingApp && existingApp.status === 'withdrawn') {
      // Reapply by resetting the withdrawn application
      application = await Application.findByIdAndUpdate(
        existingApp._id,
        {
          $set: {
            status: 'pending',
            rejectionReason: null,
            reviewedAt: null,
            createdAt: new Date()
          }
        },
        { new: true }
      );
    } else {
      application = await Application.create({
        studentId: student._id,
        jobPostingId: jobId,
        status: 'pending'
      });
    }

    const populatedApp = await Application.findById(application._id)
      .populate({
        path: 'jobPostingId',
        select: 'title',
        populate: { path: 'companyId', select: 'name' }
      });

    res.status(201).json(populatedApp);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getApplications = async (req, res) => {
  try {
    const student = await Student.findOne({ userId: req.user.userId });

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const applications = await Application.find({ studentId: student._id })
      .populate({
        path: 'jobPostingId',
        select: 'title location jobType',
        populate: { path: 'companyId', select: 'name' }
      })
      .sort({ createdAt: -1 });

    res.json({ applications });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.withdrawApplication = async (req, res) => {
  try {
    const { appId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(appId)) {
      return res.status(400).json({ error: 'Invalid application ID format' });
    }

    const student = await Student.findOne({ userId: req.user.userId });

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const application = await Application.findById(appId);

    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }

    if (!application.studentId.equals(student._id)) {
      return res.status(403).json({ error: 'You can only withdraw your own applications' });
    }

    if (application.status === 'withdrawn') {
      return res.status(400).json({ error: 'Application already withdrawn' });
    }

    if (application.status === 'hired') {
      return res.status(400).json({ error: 'Cannot withdraw after being hired' });
    }

    if (application.status === 'rejected') {
      return res.status(400).json({ error: 'Cannot withdraw a rejected application' });
    }

    application.status = 'withdrawn';
    await application.save();

    res.json(application);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getProfile = async (req, res) => {
  try {
    const student = await Student.findOne(
      { userId: req.user.userId },
      'fullName email profileLink'
    );

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    res.json({
      fullName: student.fullName,
      email: student.email,
      profileLink: student.profileLink || ''
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const { fullName, email, profileLink } = req.body;
    const updateFields = {};

    if (fullName !== undefined) {
      if (typeof fullName !== 'string' || fullName.trim().length < 2 || fullName.trim().length > 100) {
        return res.status(400).json({ error: 'Full name must be 2-100 characters' });
      }
      updateFields.fullName = fullName.trim();
    }

    if (email !== undefined) {
      if (!isValidEmail(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
      }
      updateFields.email = email.toLowerCase();
    }

    if (profileLink !== undefined) {
      if (profileLink !== '') {
        try {
          new URL(profileLink);
        } catch (e) {
          return res.status(400).json({ error: 'Profile link must be a valid URL' });
        }
        if (profileLink.length > 500) {
          return res.status(400).json({ error: 'Profile link must be less than 500 characters' });
        }
      }
      updateFields.profileLink = profileLink || null;
    }

    if (Object.keys(updateFields).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const result = await Student.updateOne(
      { userId: req.user.userId },
      { $set: updateFields }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};
