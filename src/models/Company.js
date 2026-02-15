const mongoose = require('mongoose');
const { COMPANY_STATUSES } = require('../constants');

const CompanySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  name: {
    type: String,
    required: true,
    minlength: 2,
    maxlength: 100,
    trim: true
  },
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  status: {
    type: String,
    enum: COMPANY_STATUSES,
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

CompanySchema.index({ status: 1 });
CompanySchema.index({ createdAt: -1 });

module.exports = mongoose.model('Company', CompanySchema)