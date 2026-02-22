const mongoose = require('mongoose');
const { COMPANY_STATUSES, COMPANY_INDUSTRIES, COMPANY_SIZES } = require('../constants');

const SocialLinksSchema = new mongoose.Schema({
  linkedin: {
    type: String,
    default: null
  },
  twitter: {
    type: String,
    default: null
  }
}, { _id: false });

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
    lowercase: true,
    unique: true
  },
  status: {
    type: String,
    enum: COMPANY_STATUSES,
    default: 'pending'
  },
  logo: {
    type: String,
    default: null
  },
  website: {
    type: String,
    default: null
  },
  description: {
    type: String,
    maxlength: 2000,
    default: null
  },
  industry: {
    type: String,
    enum: [...COMPANY_INDUSTRIES, null],
    default: null
  },
  size: {
    type: String,
    enum: [...COMPANY_SIZES, null],
    default: null
  },
  socialLinks: {
    type: SocialLinksSchema,
    default: {}
  },
  foundedYear: {
    type: Number,
    min: 1800,
    max: new Date().getFullYear(),
    default: null
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
CompanySchema.index({ email: 1 }, { unique: true });

module.exports = mongoose.model('Company', CompanySchema);