const mongoose = require('mongoose');
const { SUBSCRIPTION_STATUSES } = require('../constants');

const ActiveSubscriptionSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true
  },
  serviceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AvailableService',
    required: true
  },
  startDate: {
    type: Date,
    required: true,
    default: Date.now
  },
  endDate: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: SUBSCRIPTION_STATUSES,
    default: 'pending'
  },
  autoRenew: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

ActiveSubscriptionSchema.index({ studentId: 1, status: 1 });
ActiveSubscriptionSchema.index({ studentId: 1, endDate: -1 });

module.exports = mongoose.model('ActiveSubscription', ActiveSubscriptionSchema);