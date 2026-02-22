const mongoose = require('mongoose');

const PasswordResetTokenSchema = new mongoose.Schema({
  token: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  userType: {
    type: String,
    required: true,
    enum: ['admin', 'company', 'student']
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  expiresAt: {
    type: Date,
    required: true
  },
  usedAt: {
    type: Date,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// TTL index - automatically delete expired tokens
PasswordResetTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Index for user lookup
PasswordResetTokenSchema.index({ userId: 1 });

module.exports = mongoose.model('PasswordResetToken', PasswordResetTokenSchema);
