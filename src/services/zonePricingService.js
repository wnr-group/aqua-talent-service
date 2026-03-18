const mongoose = require('mongoose');

const PlanZone = require('../models/PlanZone');
const SubscriptionZone = require('../models/SubscriptionZone');
const SubscriptionAddon = require('../models/SubscriptionAddon');

const ensureSubscriptionZonesForPlan = async ({ subscriptionId, serviceId }) => {
  if (!subscriptionId || !serviceId) {
    return 0;
  }

  const AvailableService = require('../models/AvailableService');
  const plan = await AvailableService.findById(serviceId);

  // Skip if plan has allZonesIncluded
  if (plan?.allZonesIncluded) {
    return 0;
  }

  const planZones = await PlanZone.find({ planId: serviceId }).select('zoneId').lean();

  if (!planZones.length) {
    return 0;
  }

  const createdAt = new Date();
  const operations = planZones.map((planZone) => ({
    updateOne: {
      filter: {
        subscriptionId,
        zoneId: planZone.zoneId
      },
      update: {
        $setOnInsert: {
          subscriptionId,
          zoneId: planZone.zoneId,
          source: 'plan',
          createdAt
        }
      },
      upsert: true
    }
  }));

  const result = await SubscriptionZone.bulkWrite(operations, { ordered: false });
  return result.upsertedCount || 0;
};

const getAdditionalJobCredits = async (subscriptionId) => {
  if (!subscriptionId || !mongoose.Types.ObjectId.isValid(subscriptionId)) {
    return 0;
  }

  const objectId = new mongoose.Types.ObjectId(subscriptionId);
  const [summary] = await SubscriptionAddon.aggregate([
    {
      $match: {
        subscriptionId: objectId
      }
    },
    {
      $lookup: {
        from: 'addons',
        localField: 'addonId',
        foreignField: '_id',
        as: 'addon'
      }
    },
    { $unwind: '$addon' },
    {
      $match: {
        'addon.type': 'jobs'
      }
    },
    {
      $group: {
        _id: null,
        totalCredits: {
          $sum: {
            $multiply: [
              '$quantity',
              { $ifNull: ['$addon.jobCreditCount', 0] }
            ]
          }
        }
      }
    }
  ]);

  return summary?.totalCredits || 0;
};

module.exports = {
  ensureSubscriptionZonesForPlan,
  getAdditionalJobCredits
};
