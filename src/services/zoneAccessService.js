const mongoose = require('mongoose');

const Student = require('../models/Student');
const ActiveSubscription = require('../models/ActiveSubscription');
const Addon = require('../models/Addon');
const SubscriptionAddon = require('../models/SubscriptionAddon');
const SubscriptionZone = require('../models/SubscriptionZone');
const JobPosting = require('../models/JobPosting');
const PayPerJobPurchase = require('../models/PayPerJobPurchase');
const Zone = require('../models/Zone');

const isZoneEnforcementEnabled = () => {
  return process.env.ZONE_ENFORCEMENT_ENABLED === 'true';
};

const getAccessibleZones = async (studentId) => {
  if (!isZoneEnforcementEnabled()) {
    return { allZones: true, zoneIds: [] };
  }

  const student = await Student.findById(studentId);
  if (!student) {
    return { allZones: false, zoneIds: [] };
  }

  const subscription = await ActiveSubscription.findById(student.currentSubscriptionId)
    .populate('serviceId', 'allZonesIncluded');

  if (!subscription) {
    return { allZones: false, zoneIds: [] };
  }

  // Check if plan grants all zones (Free tier, Premium, etc.)
  if (subscription.serviceId?.allZonesIncluded) {
    return { allZones: true, zoneIds: [] };
  }

  // Check for "unlock all zones" addon
  const unlockAllAddonIds = await Addon.find({ unlockAllZones: true }).distinct('_id');
  if (unlockAllAddonIds.length > 0) {
    const hasUnlockAll = await SubscriptionAddon.exists({
      subscriptionId: subscription._id,
      addonId: { $in: unlockAllAddonIds }
    });

    if (hasUnlockAll) {
      return { allZones: true, zoneIds: [] };
    }
  }

  // Get zones from plan + individual addons via SubscriptionZone
  const zoneIds = await SubscriptionZone.find({
    subscriptionId: subscription._id
  }).distinct('zoneId');

  return { allZones: false, zoneIds };
};

const canAccessJob = async (studentId, jobPostingId) => {
  if (!isZoneEnforcementEnabled()) {
    return { canAccess: true, source: 'zone-enforcement-disabled' };
  }

  // Check Pay Per Job purchase first
  const payPerJob = await PayPerJobPurchase.findOne({
    studentId,
    jobPostingId,
    status: 'completed'
  });
  if (payPerJob) {
    return { canAccess: true, source: 'pay-per-job' };
  }

  const job = await JobPosting.findById(jobPostingId).populate('countryId');

  // Jobs without country set are accessible to all
  if (!job || !job.countryId) {
    return { canAccess: true, source: 'no-zone-restriction' };
  }

  const jobZoneId = job.countryId.zoneId;
  const access = await getAccessibleZones(studentId);

  if (access.allZones) {
    return { canAccess: true, source: 'all-zones' };
  }

  const hasAccess = access.zoneIds.some(id => id.equals(jobZoneId));
  if (hasAccess) {
    return { canAccess: true, source: 'subscription' };
  }

  // Get zone details for the lock reason
  const zone = await Zone.findById(jobZoneId).select('name');

  return {
    canAccess: false,
    requiredZoneId: jobZoneId,
    zoneName: zone?.name || 'Unknown Zone'
  };
};

const getUnlockOptions = async (zoneId) => {
  const addons = await Addon.find({
    type: 'zone',
    $or: [
      { zoneCount: { $gte: 1 } },
      { unlockAllZones: true }
    ]
  }).select('name priceINR priceUSD zoneCount unlockAllZones').lean();

  const options = [];

  // Single zone addon
  const singleZone = addons.find(a => a.zoneCount === 1 && !a.unlockAllZones);
  if (singleZone) {
    options.push({
      type: 'zone-addon',
      addonId: singleZone._id,
      name: singleZone.name,
      priceINR: singleZone.priceINR,
      priceUSD: singleZone.priceUSD
    });
  }

  // Unlock all zones addon
  const unlockAll = addons.find(a => a.unlockAllZones);
  if (unlockAll) {
    options.push({
      type: 'unlock-all-zones',
      addonId: unlockAll._id,
      name: unlockAll.name,
      priceINR: unlockAll.priceINR,
      priceUSD: unlockAll.priceUSD
    });
  }

  // Pay per job option (hardcoded pricing as per spec)
  options.push({
    type: 'pay-per-job',
    priceINR: 2500,
    priceUSD: 35
  });

  // Upgrade plan option
  options.push({
    type: 'upgrade-plan',
    url: '/pricing'
  });

  return options;
};

module.exports = {
  isZoneEnforcementEnabled,
  getAccessibleZones,
  canAccessJob,
  getUnlockOptions
};
