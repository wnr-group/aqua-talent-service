const mongoose = require('mongoose');
const { SUBSCRIPTION_TIERS } = require('../constants');

const EducationSchema = new mongoose.Schema({
  institution: {
    type: String,
    trim: true,
    maxlength: 200,
    default: null
  },
  degree: {
    type: String,
    trim: true,
    maxlength: 200,
    default: null
  },
  field: {
    type: String,
    trim: true,
    maxlength: 200,
    default: null
  },
  startYear: {
    type: Number,
    min: 1900,
    max: new Date().getFullYear() + 6,
    default: null
  },
  endYear: {
    type: Number,
    min: 1900,
    max: new Date().getFullYear() + 6,
    default: null
  }
}, { _id: false });

const ExperienceSchema = new mongoose.Schema({
  company: {
    type: String,
    trim: true,
    maxlength: 200,
    default: null
  },
  title: {
    type: String,
    trim: true,
    maxlength: 200,
    default: null
  },
  startDate: {
    type: Date,
    default: null
  },
  endDate: {
    type: Date,
    default: null
  },
  description: {
    type: String,
    maxlength: 2000,
    default: null
  }
}, { _id: false });

const StudentSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  fullName: {
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
  profileLink: {
    type: String,
    maxlength: 500,
    default: null
  },
  isHired: {
    type: Boolean,
    default: false
  },
  bio: {
    type: String,
    maxlength: 2000,
    default: null
  },
  location: {
    type: String,
    maxlength: 200,
    default: null
  },
  availableFrom: {
    type: Date,
    default: null
  },
  skills: {
    type: [String],
    default: [],
    validate: {
      validator(value) {
        return Array.isArray(value) && value.length <= 50;
      },
      message: 'Skills cannot exceed 50 entries'
    }
  },
  education: {
    type: [EducationSchema],
    default: []
  },
  experience: {
    type: [ExperienceSchema],
    default: []
  },
  resumeUrl: {
    type: String,
    default: null
  },
  introVideoUrl: {
    type: String,
    default: null
  },
  currentSubscriptionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ActiveSubscription',
    default: null
  },
  subscriptionTier: {
    type: String,
    enum: SUBSCRIPTION_TIERS,
    default: 'free'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes
StudentSchema.index({ isHired: 1 });

module.exports = mongoose.model('Student', StudentSchema);