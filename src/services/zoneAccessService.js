const mongoose = require('mongoose');

const Student = require('../models/Student');
const ActiveSubscription = require('../models/ActiveSubscription');
const Addon = require('../models/Addon');
const SubscriptionAddon = require('../models/SubscriptionAddon');
const SubscriptionZone = require('../models/SubscriptionZone');
const JobPosting = require('../models/JobPosting');
const PayPerJobPurchase = require('../models/PayPerJobPurchase');
const Zone = require('../models/Zone');

const getAccessibleZones = async (studentId) => {
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
  // Check Pay Per Job purchase first
  const payPerJob = await PayPerJobPurchase.findOne({
    studentId,
    jobPostingId,
    status: 'completed'
  });
  if (payPerJob) {
    return { canAccess: true, source: 'pay-per-job' };
  }

  const job = await JobPosting.findById(jobPostingId).populate('countryId', 'zoneId');

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

const getUnlockOptions = async (zoneId, studentId = null) => {
  const addons = await Addon.find({
    type: 'zone'
  }).select('name priceINR priceUSD zoneCount unlockAllZones').lean();

  // Get zone name for description
  const zone = zoneId ? await Zone.findById(zoneId).select('name').lean() : null;
  const zoneName = zone?.name || 'this zone';

  const options = [];

  // Single zone addon
  const singleZone = addons.find(a => a.zoneCount === 1 && !a.unlockAllZones);
  if (singleZone) {
    options.push({
      type: 'zone-addon',
      addonId: singleZone._id,
      label: singleZone.name,
      description: `Unlock ${zoneName} permanently`,
      priceINR: singleZone.priceINR,
      priceUSD: singleZone.priceUSD,
      zonesIncluded: singleZone.zoneCount
    });
  }

  // Multi-zone bundle addons (2+ zones, not unlock all)
  const bundles = addons
    .filter(a => a.zoneCount > 1 && !a.unlockAllZones)
    .sort((a, b) => a.zoneCount - b.zoneCount);

  for (const bundle of bundles) {
    options.push({
      type: 'zone-addon',
      addonId: bundle._id,
      label: bundle.name,
      description: `Unlock any ${bundle.zoneCount} zones`,
      priceINR: bundle.priceINR,
      priceUSD: bundle.priceUSD,
      zonesIncluded: bundle.zoneCount
    });
  }

  // Unlock all zones addon
  const unlockAll = addons.find(a => a.unlockAllZones);
  if (unlockAll) {
    options.push({
      type: 'zone-addon',
      addonId: unlockAll._id,
      label: unlockAll.name,
      description: 'Unlock all zones permanently',
      priceINR: unlockAll.priceINR,
      priceUSD: unlockAll.priceUSD,
      unlockAllZones: true
    });
  }

  // Pay per job option (pricing from database)
  const payPerJobPricing = await Addon.getPayPerJobPricing();
  options.push({
    type: 'pay-per-job',
    label: 'One-time Job Access',
    description: 'Apply to this job only',
    priceINR: payPerJobPricing.priceINR,
    priceUSD: payPerJobPricing.priceUSD
  });

  // Upgrade plan option - find a plan with more zones than current plan
  const AvailableService = require('../models/AvailableService');
  const PlanZone = require('../models/PlanZone');

  let currentPlanZoneCount = 0;
  let currentPlanId = null;

  // Get current plan's zone count if studentId provided
  if (studentId) {
    const student = await Student.findById(studentId);
    if (student?.currentSubscriptionId) {
      const subscription = await ActiveSubscription.findById(student.currentSubscriptionId)
        .select('serviceId');
      if (subscription?.serviceId) {
        currentPlanId = subscription.serviceId;
        currentPlanZoneCount = await PlanZone.countDocuments({ planId: currentPlanId });
      }
    }
  }

  // Find plans with more zones than current, or allZonesIncluded
  const allPlans = await AvailableService.find({
    isActive: true,
    tier: 'paid'
  }).select('_id name allZonesIncluded').lean();

  // Get zone counts for each plan
  const planZoneCounts = await PlanZone.aggregate([
    { $group: { _id: '$planId', zoneCount: { $sum: 1 } } }
  ]);
  const zoneCountMap = new Map(planZoneCounts.map(p => [p._id.toString(), p.zoneCount]));

  // Find upgrade options: plans with more zones OR allZonesIncluded
  const upgradePlans = allPlans.filter(plan => {
    // Skip current plan
    if (currentPlanId && plan._id.toString() === currentPlanId.toString()) {
      return false;
    }
    // Include if allZonesIncluded
    if (plan.allZonesIncluded) {
      return true;
    }
    // Include if has more zones than current plan
    const planZones = zoneCountMap.get(plan._id.toString()) || 0;
    return planZones > currentPlanZoneCount;
  });

  // Pick the cheapest upgrade option
  if (upgradePlans.length > 0) {
    // Sort by zone count to get the next tier up
    const sortedUpgrades = upgradePlans.sort((a, b) => {
      const aZones = a.allZonesIncluded ? 999 : (zoneCountMap.get(a._id.toString()) || 0);
      const bZones = b.allZonesIncluded ? 999 : (zoneCountMap.get(b._id.toString()) || 0);
      return aZones - bZones;
    });

    const upgradePlan = sortedUpgrades[0];
    options.push({
      type: 'upgrade-plan',
      label: `Upgrade to ${upgradePlan.name}`,
      description: upgradePlan.allZonesIncluded
        ? 'Get access to all zones + more applications'
        : 'Get access to more zones + applications',
      planId: upgradePlan._id,
      url: '/pricing'
    });
  }

  return options;
};

module.exports = {
  getAccessibleZones,
  canAccessJob,
  getUnlockOptions
};
