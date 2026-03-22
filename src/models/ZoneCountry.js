const mongoose = require('mongoose');

const ZoneCountrySchema = new mongoose.Schema({
  zoneId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Zone',
    required: true
  },
  countryName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 120
  }
}, {
  collection: 'zone_countries'
});

ZoneCountrySchema.index({ zoneId: 1 });
ZoneCountrySchema.index({ countryName: 1 });
ZoneCountrySchema.index({ zoneId: 1, countryName: 1 }, { unique: true });

module.exports = mongoose.model('ZoneCountry', ZoneCountrySchema);