const mongoose = require('mongoose');

const SubscriptionAddonSchema = new mongoose.Schema({
  subscriptionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ActiveSubscription',
    required: true
  },
  addonId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Addon',
    required: true
  },
  paymentRecordId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PaymentRecord',
    default: null
  },
  quantity: {
    type: Number,
    required: true,
    min: 1,
    default: 1
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  collection: 'subscription_addons'
});

SubscriptionAddonSchema.index({ subscriptionId: 1 });
SubscriptionAddonSchema.index({ addonId: 1 });
SubscriptionAddonSchema.index({ subscriptionId: 1, addonId: 1 }, { unique: true });

module.exports = mongoose.model('SubscriptionAddon', SubscriptionAddonSchema);