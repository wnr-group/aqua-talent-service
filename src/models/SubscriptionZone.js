const mongoose = require('mongoose');

const SubscriptionZoneSchema = new mongoose.Schema({
  subscriptionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ActiveSubscription',
    required: true
  },
  zoneId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Zone',
    required: true
  },
  source: {
    type: String,
    enum: ['plan', 'addon', 'bundle'],
    required: true,
    default: 'plan'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  collection: 'subscription_zones'
});

SubscriptionZoneSchema.index({ subscriptionId: 1 });
SubscriptionZoneSchema.index({ zoneId: 1 });
SubscriptionZoneSchema.index({ subscriptionId: 1, zoneId: 1 }, { unique: true });

module.exports = mongoose.model('SubscriptionZone', SubscriptionZoneSchema);