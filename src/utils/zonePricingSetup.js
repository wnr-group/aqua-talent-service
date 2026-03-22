const AvailableService = require('../models/AvailableService');
const PlanZone = require('../models/PlanZone');
const Zone = require('../models/Zone');
const ZoneCountry = require('../models/ZoneCountry');
const {
  DEFAULT_ZONES,
  DEFAULT_PLAN_ZONE_ASSIGNMENTS
} = require('../constants/zonePricing');

const buildPlanZoneOperation = (planId, zoneId) => ({
  updateOne: {
    filter: {
      planId,
      zoneId
    },
    update: {
      $setOnInsert: {
        planId,
        zoneId
      }
    },
    upsert: true
  }
});

const upsertZonesAndCountries = async () => {
  const zonesByName = new Map();
  let createdZones = 0;
  let createdCountries = 0;

  for (const zone of DEFAULT_ZONES) {
    const zoneDoc = await Zone.findOneAndUpdate(
      { name: zone.name },
      {
        $set: {
          description: zone.description
        },
        $setOnInsert: {
          name: zone.name
        }
      },
      {
        returnDocument: 'after',
        upsert: true,
        setDefaultsOnInsert: true,
        includeResultMetadata: true
      }
    );

    zonesByName.set(zone.name, zoneDoc.value || zoneDoc);

    if (zoneDoc?.lastErrorObject?.upserted) {
      createdZones += 1;
    }
  }

  const countryOperations = [];

  for (const zone of DEFAULT_ZONES) {
    const zoneDoc = zonesByName.get(zone.name);

    for (const countryName of zone.countries) {
      countryOperations.push({
        updateOne: {
          filter: {
            zoneId: zoneDoc._id,
            countryName
          },
          update: {
            $setOnInsert: {
              zoneId: zoneDoc._id,
              countryName
            }
          },
          upsert: true
        }
      });
    }
  }

  if (countryOperations.length) {
    const countryResult = await ZoneCountry.bulkWrite(countryOperations, { ordered: false });
    createdCountries = countryResult.upsertedCount || 0;
  }

  return {
    zonesByName,
    createdZones,
    createdCountries,
    totalZones: DEFAULT_ZONES.length,
    totalCountries: DEFAULT_ZONES.reduce((sum, zone) => sum + zone.countries.length, 0)
  };
};

const ensureDefaultPlanZoneMappings = async (zonesByName) => {
  const planNames = Object.keys(DEFAULT_PLAN_ZONE_ASSIGNMENTS);
  const premiumPlanAliases = ['Premium Plan', 'Premium'];
  const plans = await AvailableService.find({
    name: { $in: [...new Set([...planNames, ...premiumPlanAliases])] }
  }).select('_id name').lean();
  const allZones = await Zone.find({}).select('_id name').lean();

  if (!plans.length) {
    return {
      matchedPlans: [],
      createdMappings: 0,
      skippedPlans: planNames
    };
  }

  const planMap = new Map(plans.map((plan) => [plan.name, plan]));
  const zoneMap = new Map(allZones.map((zone) => [zone.name, zone]));
  const operations = [];

  for (const planName of planNames) {
    const plan = planMap.get(planName);

    if (!plan) {
      continue;
    }

    for (const zoneName of DEFAULT_PLAN_ZONE_ASSIGNMENTS[planName]) {
      const zone = zoneMap.get(zoneName) || zonesByName.get(zoneName);

      if (!zone) {
        continue;
      }

      operations.push(buildPlanZoneOperation(plan._id, zone._id));
    }
  }

  const premiumPlan = premiumPlanAliases
    .map((planName) => planMap.get(planName))
    .find(Boolean);

  if (premiumPlan) {
    const premiumPlanMappings = await PlanZone.countDocuments({ planId: premiumPlan._id });

    if (premiumPlanMappings === 0) {
      for (const zone of allZones) {
        operations.push(buildPlanZoneOperation(premiumPlan._id, zone._id));
      }
    }
  }

  let createdMappings = 0;

  if (operations.length) {
    const result = await PlanZone.bulkWrite(operations, { ordered: false });
    createdMappings = result.upsertedCount || 0;
  }

  return {
    matchedPlans: plans.map((plan) => plan.name),
    createdMappings,
    skippedPlans: planNames.filter((planName) => {
      if (planName === 'Premium Plan') {
        return !premiumPlan;
      }

      return !planMap.has(planName);
    })
  };
};

module.exports = {
  upsertZonesAndCountries,
  ensureDefaultPlanZoneMappings
};