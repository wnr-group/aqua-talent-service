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
    enum: ['zone', 'jobs'],
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
    if (!isPresent(this.zoneCount) || this.zoneCount <= 0) {
      this.invalidate('zoneCount', 'Zone addon must define zoneCount');
    }

    if (isPresent(this.jobCreditCount)) {
      this.invalidate('jobCreditCount', 'Zone addon cannot define jobCreditCount');
    }
  }
});

AddonSchema.index({ name: 1 }, { unique: true });
AddonSchema.index({ type: 1 });

module.exports = mongoose.model('Addon', AddonSchema);