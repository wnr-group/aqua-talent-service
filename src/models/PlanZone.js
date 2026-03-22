const mongoose = require('mongoose');

const PlanZoneSchema = new mongoose.Schema({
  planId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AvailableService',
    required: true
  },
  zoneId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Zone',
    required: true
  }
}, {
  collection: 'plan_zones'
});

PlanZoneSchema.index({ planId: 1 });
PlanZoneSchema.index({ zoneId: 1 });
PlanZoneSchema.index({ planId: 1, zoneId: 1 }, { unique: true });

module.exports = mongoose.model('PlanZone', PlanZoneSchema);