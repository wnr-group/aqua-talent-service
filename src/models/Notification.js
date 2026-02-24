const mongoose = require('mongoose');

const NOTIFICATION_TYPES = [
  'application_submitted',
  'application_approved',
  'application_rejected',
  'application_interview_scheduled',
  'application_offer_extended',
  'application_hired',
  'application_received',
  'job_approved',
  'company_approved',
  'company_rejected',
  'ADMIN_NEW_COMPANY_PENDING',
  'ADMIN_NEW_JOB_PENDING',
  'ADMIN_COMPANY_REVERIFY_REQUIRED'
];

const RECIPIENT_TYPES = ['student', 'company', 'admin'];

const NotificationSchema = new mongoose.Schema(
  {
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    recipientType: {
      type: String,
      enum: RECIPIENT_TYPES,
      required: true
    },
    type: {
      type: String,
      enum: NOTIFICATION_TYPES,
      required: true
    },
    title: {
      type: String,
      required: true,
      maxlength: 200,
      trim: true
    },
    message: {
      type: String,
      required: true,
      maxlength: 1000,
      trim: true
    },
    link: {
      type: String,
      maxlength: 500,
      default: null
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true
    }
  },
  {
    timestamps: { createdAt: true, updatedAt: false }
  }
);

NotificationSchema.index({ recipientId: 1, isRead: 1, createdAt: -1 });
NotificationSchema.index({ recipientId: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', NotificationSchema);
module.exports.NOTIFICATION_TYPES = NOTIFICATION_TYPES;
module.exports.RECIPIENT_TYPES = RECIPIENT_TYPES;
