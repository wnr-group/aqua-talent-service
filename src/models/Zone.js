const mongoose = require('mongoose');

const ZoneSchema = new mongoose.Schema({
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
    maxlength: 500
  }
}, {
  collection: 'zones',
  timestamps: {
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  }
});

ZoneSchema.index({ name: 1 }, { unique: true });

module.exports = mongoose.model('Zone', ZoneSchema);