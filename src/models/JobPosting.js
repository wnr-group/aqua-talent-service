const mongoose = require('mongoose');
const { JOB_STATUSES, JOB_TYPES } = require('../constants');

const JobPostingSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  title: {
    type: String,
    required: false,
    maxlength: 100,
    trim: true,
    default: null
  },
  description: {
    type: String,
    required: false,
    maxlength: 5000,
    default: null
  },
  requirements: {
    type: String,
    maxlength: 2000,
    default: null
  },
  location: {
    type: String,
    required: false,
    maxlength: 100,
    trim: true,
    default: null
  },
  jobType: {
    type: String,
    required: false,
    enum: [...JOB_TYPES, null],
    default: null
  },
  salaryRange: {
    type: String,
    maxlength: 50,
    default: null
  },
  deadline: {
    type: Date,
    default: null
  },
  status: {
    type: String,
    enum: JOB_STATUSES,
    default: 'pending'
  },
  rejectionReason: {
    type: String,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  approvedAt: {
    type: Date,
    default: null
  }
});

// Indexes
JobPostingSchema.index({ companyId: 1 });
JobPostingSchema.index({ status: 1 });
JobPostingSchema.index({ createdAt: -1 });
JobPostingSchema.index({ title: 'text', description: 'text' }); // For search

module.exports = mongoose.model('JobPosting', JobPostingSchema);