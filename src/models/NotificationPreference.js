const mongoose = require('mongoose');

const NotificationPreferenceSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    channel: {
      type: String,
      enum: ['email'],
      default: 'email'
    },
    emailType: {
      type: String,
      required: true,
      trim: true
    },
    optedOut: {
      type: Boolean,
      default: false
    },
    metadata: {
      type: Map,
      of: String,
      default: undefined
    }
  },
  {
    timestamps: true
  }
);

NotificationPreferenceSchema.index({ userId: 1, channel: 1, emailType: 1 }, { unique: true });

module.exports = mongoose.model('NotificationPreference', NotificationPreferenceSchema);
