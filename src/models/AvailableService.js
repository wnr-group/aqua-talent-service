const mongoose = require('mongoose');

const AvailableServiceSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 120
  },
  description: {
    type: String,
    required: true,
    trim: true,
    maxlength: 1000
  },
  maxApplications: {
    type: Number,
    required: true,
    min: 1
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  features: {
    type: [String],
    default: []
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

AvailableServiceSchema.index({ isActive: 1 });
AvailableServiceSchema.index({ price: 1 });

module.exports = mongoose.model('AvailableService', AvailableServiceSchema);