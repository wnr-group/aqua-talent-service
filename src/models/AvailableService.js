const mongoose = require('mongoose');

const FREE_TIER_PLAN_NAME = 'Free Tier';
const FREE_TIER_MAX_APPLICATIONS = 2;

const AvailableServiceSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 120
  },
  tier: {
    type: String,
    enum: ['free', 'paid'],
    default: 'paid'
  },
  description: {
    type: String,
    required: true,
    trim: true,
    maxlength: 1000
  },
  maxApplications: {
    type: Number,
    default: null, // null means unlimited
    min: 1
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  priceINR: {
    type: Number,
    required: true,
    min: 0,
    default: function() {
      return typeof this.price === 'number' ? this.price : 0;
    }
  },
  priceUSD: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  currency: {
    type: String,
    default: 'USD',
    enum: ['USD', 'EUR', 'GBP', 'INR', 'AUD', 'CAD']
  },
  // All plans are now quota-based (one-time purchase for X applications)
  billingCycle: {
    type: String,
    default: 'one-time',
    enum: ['one-time']
  },
  discount: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  features: {
    type: [String],
    default: []
  },
  badge: {
    type: String,
    trim: true,
    maxlength: 50,
    default: null // e.g., "Popular", "Best Value"
  },
  displayOrder: {
    type: Number,
    default: 0
  },
  // Feature limits (per plan purchase, not per month)
  resumeDownloads: {
    type: Number,
    default: null // null means unlimited
  },
  videoViews: {
    type: Number,
    default: null // null means unlimited
  },
  // Feature flags
  prioritySupport: {
    type: Boolean,
    default: false
  },
  profileBoost: {
    type: Boolean,
    default: false
  },
  applicationHighlight: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
  },
  allZonesIncluded: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

AvailableServiceSchema.pre('save', function() {
  this.updatedAt = new Date();
});

AvailableServiceSchema.index({ isActive: 1 });
AvailableServiceSchema.index({ price: 1 });
AvailableServiceSchema.index({ displayOrder: 1 });
AvailableServiceSchema.index({ tier: 1 });

// Static method to get or create the free plan
AvailableServiceSchema.statics.getFreePlan = async function() {
  let freePlan = await this.findOne({ tier: 'free' }).sort({ createdAt: 1 });

  const freePlanDefaults = {
    name: FREE_TIER_PLAN_NAME,
    tier: 'free',
    description: 'Basic access to job listings and limited applications',
    maxApplications: FREE_TIER_MAX_APPLICATIONS,
    price: 0,
    currency: 'USD',
    billingCycle: 'one-time',
    features: ['Basic job search', 'Limited applications', 'Profile creation'],
    isActive: true,
    allZonesIncluded: true,
    displayOrder: 0
  };

  if (!freePlan) {
    freePlan = await this.create(freePlanDefaults);
  } else {
    let hasUpdates = false;

    if (freePlan.maxApplications !== FREE_TIER_MAX_APPLICATIONS) {
      freePlan.maxApplications = FREE_TIER_MAX_APPLICATIONS;
      hasUpdates = true;
    }

    if (freePlan.price !== 0) {
      freePlan.price = 0;
      hasUpdates = true;
    }

    if (freePlan.billingCycle !== 'one-time') {
      freePlan.billingCycle = 'one-time';
      hasUpdates = true;
    }

    if (!freePlan.name || freePlan.name.trim().length === 0) {
      freePlan.name = freePlanDefaults.name;
      hasUpdates = true;
    }

    if (!freePlan.description || freePlan.description.trim().length === 0) {
      freePlan.description = freePlanDefaults.description;
      hasUpdates = true;
    }

    if (!Array.isArray(freePlan.features) || freePlan.features.length === 0) {
      freePlan.features = freePlanDefaults.features;
      hasUpdates = true;
    }

    if (!freePlan.isActive) {
      freePlan.isActive = true;
      hasUpdates = true;
    }

    if (!freePlan.allZonesIncluded) {
      freePlan.allZonesIncluded = true;
      hasUpdates = true;
    }

    if (hasUpdates) {
      await freePlan.save();
    }
  }

  return freePlan;
};

module.exports = mongoose.model('AvailableService', AvailableServiceSchema);
