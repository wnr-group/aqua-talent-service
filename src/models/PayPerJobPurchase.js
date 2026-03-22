const mongoose = require('mongoose');

const PayPerJobPurchaseSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student',
    required: true
  },
  jobPostingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'JobPosting',
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    enum: ['INR', 'USD'],
    required: true
  },
  paymentRecordId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PaymentRecord',
    default: null
  },
  razorpayOrderId: {
    type: String,
    default: null
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed'],
    default: 'pending'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  completedAt: {
    type: Date,
    default: null
  }
}, {
  collection: 'pay_per_job_purchases'
});

// Unique constraint only on completed purchases - allows retrying failed purchases
PayPerJobPurchaseSchema.index(
  { studentId: 1, jobPostingId: 1 },
  { unique: true, partialFilterExpression: { status: 'completed' } }
);
PayPerJobPurchaseSchema.index({ studentId: 1 });
PayPerJobPurchaseSchema.index({ jobPostingId: 1 });
PayPerJobPurchaseSchema.index({ status: 1 });
PayPerJobPurchaseSchema.index({ razorpayOrderId: 1 });

module.exports = mongoose.model('PayPerJobPurchase', PayPerJobPurchaseSchema);
