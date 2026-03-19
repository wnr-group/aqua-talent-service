const mongoose = require('mongoose');

const isPresent = (value) => value !== null && value !== undefined;

const AddonSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 120
  },
  type: {
    type: String,
    enum: ['zone', 'jobs', 'pay-per-job'],
    required: true
  },
  priceINR: {
    type: Number,
    default: null,
    min: 0
  },
  priceUSD: {
    type: Number,
    default: null,
    min: 0
  },
  zoneCount: {
    type: Number,
    default: null,
    min: 1
  },
  jobCreditCount: {
    type: Number,
    default: null,
    min: 1
  },
  unlockAllZones: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  collection: 'addons'
});

AddonSchema.pre('validate', function() {
  if (this.type === 'jobs') {
    if (!isPresent(this.jobCreditCount) || this.jobCreditCount <= 0) {
      this.invalidate('jobCreditCount', 'Jobs addon must define jobCreditCount');
    }

    if (isPresent(this.zoneCount)) {
      this.invalidate('zoneCount', 'Jobs addon cannot define zoneCount');
    }
  }

  if (this.type === 'zone') {
    // unlockAllZones addons don't need zoneCount
    if (!this.unlockAllZones) {
      if (!isPresent(this.zoneCount) || this.zoneCount <= 0) {
        this.invalidate('zoneCount', 'Zone addon must define zoneCount (unless unlockAllZones)');
      }
    }

    if (isPresent(this.jobCreditCount)) {
      this.invalidate('jobCreditCount', 'Zone addon cannot define jobCreditCount');
    }
  }

  // pay-per-job type only needs pricing, no other fields
  if (this.type === 'pay-per-job') {
    if (isPresent(this.zoneCount)) {
      this.invalidate('zoneCount', 'Pay-per-job addon cannot define zoneCount');
    }
    if (isPresent(this.jobCreditCount)) {
      this.invalidate('jobCreditCount', 'Pay-per-job addon cannot define jobCreditCount');
    }
  }
});

// Static method to get pay-per-job pricing
AddonSchema.statics.getPayPerJobPricing = async function() {
  const addon = await this.findOne({ type: 'pay-per-job' }).lean();
  if (addon) {
    return { priceINR: addon.priceINR, priceUSD: addon.priceUSD };
  }
  // Fallback defaults if not configured
  return { priceINR: 2500, priceUSD: 35 };
};

AddonSchema.index({ name: 1 }, { unique: true });
AddonSchema.index({ type: 1 });
AddonSchema.index({ unlockAllZones: 1 });

module.exports = mongoose.model('Addon', AddonSchema);