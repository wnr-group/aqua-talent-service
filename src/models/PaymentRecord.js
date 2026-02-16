const mongoose = require('mongoose');

const PAYMENT_STATUSES = ['pending', 'completed', 'failed', 'refunded'];

const PaymentRecordSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true
  },
  subscriptionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ActiveSubscription',
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    default: 'USD'
  },
  paymentDate: {
    type: Date,
    default: Date.now
  },
  status: {
    type: String,
    enum: PAYMENT_STATUSES,
    default: 'completed'
  },
  transactionId: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  paymentMethod: {
    type: String,
    required: true,
    trim: true
  },
  gatewayResponse: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

PaymentRecordSchema.index({ studentId: 1, paymentDate: -1 });

module.exports = mongoose.model('PaymentRecord', PaymentRecordSchema);