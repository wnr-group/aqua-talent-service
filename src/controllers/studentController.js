const mongoose = require('mongoose');

const Student = require('../models/Student');
const Company = require('../models/Company');
const JobPosting = require('../models/JobPosting');
const Application = require('../models/Application');
const { getApplicationLimit } = require('../services/subscriptionService');
const { uploadStudentResume } = require('../services/mediaService');
const emailService = require('../services/emailService');
const notificationService = require('../services/notificationService');

// Check if email is taken by another user (excluding current student)
const isEmailTakenByOther = async (email, currentStudentId) => {
  const normalizedEmail = email.toLowerCase().trim();

  // Check other students
  const otherStudent = await Student.exists({
    email: normalizedEmail,
    _id: { $ne: currentStudentId }
  });
  if (otherStudent) return true;

  // Check companies
  const companyExists = await Company.exists({ email: normalizedEmail });
  if (companyExists) return true;

  // Check admin email
  if (process.env.ADMIN_EMAIL?.toLowerCase() === normalizedEmail) return true;

  return false;
};

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const isValidUrl = (value) => {
  if (typeof value !== 'string' || value.trim() === '') {
    return false;
  }

  try {
    new URL(value);
    return true;
  } catch (error) {
    return false;
  }
};

const sanitizeString = (value, maxLength) => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, maxLength);
};

const normalizeYear = (value) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const year = Number(value);
  const maxYear = new Date().getFullYear() + 6;
  if (!Number.isInteger(year) || year < 1900 || year > maxYear) {
    return null;
  }

  return year;
};

const normalizeDate = (value) => {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
};

const buildProfileResponse = (student) => ({
  fullName: student.fullName,
  email: student.email,
  profileLink: student.profileLink || '',
  bio: student.bio || '',
  location: student.location || '',
  availableFrom: student.availableFrom,
  skills: student.skills || [],
  education: student.education || [],
  experience: student.experience || [],
  resumeUrl: student.resumeUrl || null,
  introVideoUrl: student.introVideoUrl || '',
  isHired: student.isHired
});

const buildCompleteness = (student) => {
  const sections = [
    {
      label: 'Bio',
      filled: Boolean(student.bio && student.bio.trim().length > 0)
    },
    {
      label: 'Location',
      filled: Boolean(student.location && student.location.trim().length > 0)
    },
    {
      label: 'Skills',
      filled: Array.isArray(student.skills) && student.skills.length > 0
    },
    {
      label: 'Education',
      filled: Array.isArray(student.education) && student.education.length > 0
    },
    {
      label: 'Experience',
      filled: Array.isArray(student.experience) && student.experience.length > 0
    },
    {
      label: 'Resume',
      filled: Boolean(student.resumeUrl)
    },
    {
      label: 'Intro Video',
      filled: Boolean(student.introVideoUrl)
    },
    {
      label: 'Available From',
      filled: Boolean(student.availableFrom)
    }
  ];

  const totalSections = 8;
  const completedSections = sections.filter((section) => section.filled).length;
  const percentage = Math.round((completedSections / totalSections) * 100);
  const missingItems = sections
    .filter((section) => !section.filled)
    .map((section) => section.label);

  return { percentage, missingItems };
};

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
        .populate('companyId', 'name logo industry size website')
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
          name: jobObj.companyId.name,
          logo: jobObj.companyId.logo,
          industry: jobObj.companyId.industry,
          size: jobObj.companyId.size,
          website: jobObj.companyId.website
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

    let hasApplied = false;
    let applicationStatus = null;
    let student = null;

    // Check if student has applied to this job
    if (req.user && req.user.userType === 'student') {
      student = await Student.findOne({ userId: req.user.userId });
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

    // Build query - applied students can view any job, others only approved
    const query = { _id: jobId };
    if (!hasApplied) {
      query.status = 'approved';
    }

    const job = await JobPosting.findOne(query)
      .populate('companyId', 'name logo description industry size website socialLinks foundedYear')
      .select('-rejectionReason -approvedAt');

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
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
      status: jobObj.status,
      createdAt: jobObj.createdAt,
      company: jobObj.companyId ? {
        id: jobObj.companyId._id,
        name: jobObj.companyId.name,
        logo: jobObj.companyId.logo,
        description: jobObj.companyId.description,
        industry: jobObj.companyId.industry,
        size: jobObj.companyId.size,
        website: jobObj.companyId.website,
        socialLinks: {
          linkedin: jobObj.companyId.socialLinks?.linkedin || null,
          twitter: jobObj.companyId.socialLinks?.twitter || null
        },
        foundedYear: jobObj.companyId.foundedYear
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
        { returnDocument: 'after' }
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
        populate: { path: 'companyId', select: 'name userId' }
      });

    res.status(201).json(populatedApp);

    const _jobTitle = populatedApp.jobPostingId.title;
    const _companyName = populatedApp.jobPostingId.companyId?.name;
    const _companyUserId = populatedApp.jobPostingId.companyId?.userId;

    console.log("STEP A: About to call notifyApplicationSubmitted");

    notificationService
      .notifyApplicationSubmitted(student.userId, {
        jobTitle: _jobTitle,
        companyName: _companyName
      })
      .catch((err) => console.error('Notification error (submitted):', err));

    // Company notification is sent after admin approval, not on submission

    emailService
      .sendApplicationStatusEmail(
        student.email,
        {
          status: 'submitted',
          jobTitle: populatedApp.jobPostingId.title,
          companyName: populatedApp.jobPostingId.companyId?.name,
          studentName: student.fullName
        },
        { userId: student.userId }
      )
      .catch((error) => {
        console.error('Failed to send application submission email', error);
      });
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
      'fullName email profileLink bio location availableFrom skills education experience resumeUrl introVideoUrl isHired'
    );

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    res.json(buildProfileResponse(student));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const {
      fullName,
      email,
      profileLink,
      bio,
      location,
      availableFrom,
      skills,
      education,
      experience
    } = req.body || {};

    const student = await Student.findOne({ userId: req.user.userId });

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    let hasUpdates = false;

    if (fullName !== undefined) {
      if (typeof fullName !== 'string' || fullName.trim().length < 2 || fullName.trim().length > 100) {
        return res.status(400).json({ error: 'Full name must be 2-100 characters' });
      }
      student.fullName = fullName.trim();
      hasUpdates = true;
    }

    if (email !== undefined) {
      if (!isValidEmail(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
      }
      // Check if email is taken by another user
      const emailTaken = await isEmailTakenByOther(email, student._id);
      if (emailTaken) {
        return res.status(409).json({ error: 'Email already registered' });
      }
      student.email = email.toLowerCase();
      hasUpdates = true;
    }

    if (profileLink !== undefined) {
      if (profileLink && profileLink.length > 500) {
        return res.status(400).json({ error: 'Profile link must be less than 500 characters' });
      }
      if (profileLink && !isValidUrl(profileLink)) {
        return res.status(400).json({ error: 'Profile link must be a valid URL' });
      }
      student.profileLink = profileLink ? profileLink.trim() : null;
      hasUpdates = true;
    }

    if (bio !== undefined) {
      if (bio && (typeof bio !== 'string' || bio.length > 2000)) {
        return res.status(400).json({ error: 'Bio must be a string up to 2000 characters' });
      }
      student.bio = bio ? bio.trim() : null;
      hasUpdates = true;
    }

    if (location !== undefined) {
      if (location && (typeof location !== 'string' || location.length > 200)) {
        return res.status(400).json({ error: 'Location must be a string up to 200 characters' });
      }
      student.location = location ? location.trim() : null;
      hasUpdates = true;
    }

    if (availableFrom !== undefined) {
      if (availableFrom === null || availableFrom === '') {
        student.availableFrom = null;
      } else {
        const parsedDate = normalizeDate(availableFrom);
        if (!parsedDate) {
          return res.status(400).json({ error: 'availableFrom must be a valid date' });
        }
        student.availableFrom = parsedDate;
      }
      hasUpdates = true;
    }

    if (skills !== undefined) {
      if (!Array.isArray(skills)) {
        return res.status(400).json({ error: 'Skills must be an array of strings' });
      }
      const normalizedSkills = Array.from(new Set(
        skills
          .map((skill) => (typeof skill === 'string' ? skill.trim() : ''))
          .filter((skill) => skill)
      ));

      if (normalizedSkills.length > 50) {
        return res.status(400).json({ error: 'Skills cannot exceed 50 entries' });
      }

      if (normalizedSkills.some((skill) => skill.length > 50)) {
        return res.status(400).json({ error: 'Each skill must be 50 characters or fewer' });
      }

      student.skills = normalizedSkills;
      hasUpdates = true;
    }

    if (education !== undefined) {
      if (!Array.isArray(education)) {
        return res.status(400).json({ error: 'Education must be an array' });
      }

      const normalizedEducation = education.map((entry, idx) => {
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
      }).filter((entry) => Object.values(entry).some((value) => value !== null));

      student.education = normalizedEducation;
      hasUpdates = true;
    }

    if (experience !== undefined) {
      if (!Array.isArray(experience)) {
        return res.status(400).json({ error: 'Experience must be an array' });
      }

      const normalizedExperience = experience.map((entry, idx) => {
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
      }).filter((entry) => Object.values(entry).some((value) => value !== null));

      student.experience = normalizedExperience;
      hasUpdates = true;
    }

    // Note: introVideoUrl can only be set via file upload endpoint

    if (!hasUpdates) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    await student.save();

    res.json({ success: true });
  } catch (error) {
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

exports.uploadResume = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Resume file is required' });
    }

    const student = await Student.findOne({ userId: req.user.userId });

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const resumeUrl = await uploadStudentResume(req.file);

    student.resumeUrl = resumeUrl;
    await student.save();

    res.json({ resumeUrl });
  } catch (error) {
    const clientErrorIndicators = ['resume', 'pdf', 'file buffer'];

    if (error.message && clientErrorIndicators.some((indicator) => error.message.toLowerCase().includes(indicator))) {
      return res.status(400).json({ error: error.message });
    }

    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getProfileCompleteness = async (req, res) => {
  try {
    const student = await Student.findOne({ userId: req.user.userId });

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const { percentage, missingItems } = buildCompleteness(student);

    res.json({ percentage, missingItems });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};
