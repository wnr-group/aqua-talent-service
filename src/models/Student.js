const mongoose = require('mongoose');
const { SUBSCRIPTION_TIERS } = require('../constants');

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