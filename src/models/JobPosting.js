const mongoose = require('mongoose');

const JobPostingSchema = new mongoose.Schema({
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  title: {
    type: String,
    required: true,
    minlength: 5,
    maxlength: 100,
    trim: true
  },
  description: {
    type: String,
    required: true,
    minlength: 50,
    maxlength: 5000
  },
  requirements: {
    type: String,
    maxlength: 2000,
    default: null
  },
  location: {
    type: String,
    required: true,
    minlength: 2,
    maxlength: 100,
    trim: true
  },
  jobType: {
    type: String,
    required: true,
    minlength: 2,
    maxlength: 50,
    trim: true
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
    enum: ['pending', 'approved', 'rejected', 'closed'],
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