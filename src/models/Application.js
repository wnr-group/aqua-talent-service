const mongoose = require('mongoose');
const { APPLICATION_STATUSES } = require('../constants');

const ApplicationSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true
  },
  jobPostingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'JobPosting',
    required: true
  },
  status: {
    type: String,
    enum: APPLICATION_STATUSES,
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
  reviewedAt: {
    type: Date,
    default: null
  }
});

// Compound unique index - prevents duplicate applications
ApplicationSchema.index({ studentId: 1, jobPostingId: 1 }, { unique: true });

// Other indexes
ApplicationSchema.index({ studentId: 1 });
ApplicationSchema.index({ jobPostingId: 1 });
ApplicationSchema.index({ status: 1 });
ApplicationSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Application', ApplicationSchema);