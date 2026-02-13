const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    minlength: 3,
    maxlength: 30,
    lowercase: true,
    trim: true
  },
  passwordHash: {
    type: String,
    required: true
  },
  userType: {
    type: String,
    required: true,
    enum: ['admin', 'company', 'student']
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes

UserSchema.index({ userType: 1 });

module.exports = mongoose.model('User', UserSchema);