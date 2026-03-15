const mongoose = require('mongoose');

const PAYMENT_STATUSES = ['pending', 'paid', 'completed', 'failed', 'refunded'];

const PaymentRecordSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true
  },
  serviceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AvailableService',
    default: null
  },
  subscriptionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ActiveSubscription',
    default: null
  },
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    default: null
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
  razorpayOrderId: {
    type: String,
    unique: true,
    sparse: true,
    trim: true,
    default: null
  },
  razorpayPaymentId: {
    type: String,
    trim: true,
    default: null
  },
  transactionId: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  paymentGateway: {
    type: String,
    trim: true,
    default: 'razorpay' // The payment gateway used (razorpay, stripe, etc.)
  },
  paymentMethod: {
    type: String,
    trim: true,
    default: null // The actual method used (upi, card, netbanking, wallet, etc.)
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