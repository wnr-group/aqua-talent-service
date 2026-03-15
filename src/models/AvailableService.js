const mongoose = require('mongoose');

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
    default: function() {
      const usdFallbacks = [
        this.usdPrice,
        this.nonIndianPrice,
        this.internationalPrice,
        this.non_indian_price,
        this.international_price,
        this.price
      ];

      return usdFallbacks.find((value) => typeof value === 'number') ?? 0;
    }
  },
  nonIndianPrice: {
    type: Number,
    default: null,
    min: 0
  },
  internationalPrice: {
    type: Number,
    default: null,
    min: 0
  },
  usdPrice: {
    type: Number,
    default: null,
    min: 0
  },
  non_indian_price: {
    type: Number,
    default: null,
    min: 0
  },
  international_price: {
    type: Number,
    default: null,
    min: 0
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
  isCompanySpotlight: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
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
  let freePlan = await this.findOne({ tier: 'free' });

  if (!freePlan) {
    freePlan = await this.create({
      name: 'Free',
      tier: 'free',
      description: 'Basic access to job listings and limited applications',
      maxApplications: null, // Will use SystemConfig value
      price: 0,
      currency: 'USD',
      billingCycle: 'one-time',
      features: ['Basic job search', 'Limited applications', 'Profile creation'],
      isActive: true,
      displayOrder: 0
    });
  }

  return freePlan;
};

module.exports = mongoose.model('AvailableService', AvailableServiceSchema);
