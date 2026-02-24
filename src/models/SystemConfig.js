const mongoose = require('mongoose');

const SystemConfigSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  value: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  description: {
    type: String,
    trim: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
});

SystemConfigSchema.pre('save', function() {
  this.updatedAt = new Date();
});

// Static method to get a config value with default
SystemConfigSchema.statics.getValue = async function(key, defaultValue = null) {
  const config = await this.findOne({ key });
  return config ? config.value : defaultValue;
};

// Static method to set a config value
SystemConfigSchema.statics.setValue = async function(key, value, description = null, updatedBy = null) {
  const update = { value, updatedAt: new Date() };
  if (description) update.description = description;
  if (updatedBy) update.updatedBy = updatedBy;

  return this.findOneAndUpdate(
    { key },
    { $set: update, $setOnInsert: { key } },
    { upsert: true, returnDocument: 'after', runValidators: true }
  );
};

module.exports = mongoose.model('SystemConfig', SystemConfigSchema);
