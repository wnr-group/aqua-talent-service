const mongoose = require('mongoose');

const Student = require('../models/Student');
const Application = require('../models/Application');
const AvailableService = require('../models/AvailableService');
const ActiveSubscription = require('../models/ActiveSubscription');
const PaymentRecord = require('../models/PaymentRecord');
const { checkSubscriptionStatus, getApplicationLimit } = require('../services/subscriptionService');
const { getSubscriptionUsage } = require('../services/applicationService');

const generateTransactionId = () => `txn_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
const DEFAULT_PRO_PLAN_NAME = process.env.PRO_PLAN_NAME?.trim() || 'Pro Plan';
const escapeRegex = (value = '') => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const findDefaultProPlan = async (planKey = 'pro') => {
  const normalizedKey = String(planKey || '').trim().toLowerCase();

  if (normalizedKey && normalizedKey !== 'pro') {
    const directRegex = new RegExp(`^${escapeRegex(planKey)}$`, 'i');
    const directMatch = await AvailableService.findOne({
      isActive: true,
      name: { $regex: directRegex }
    }).sort({ createdAt: 1 });

    if (directMatch) {
      return directMatch;
    }
  }

  const strictRegex = new RegExp(`^${escapeRegex(DEFAULT_PRO_PLAN_NAME)}$`, 'i');

  const strictMatch = await AvailableService.findOne({
    isActive: true,
    name: { $regex: strictRegex }
  }).sort({ createdAt: 1 });

  if (strictMatch) {
    return strictMatch;
  }

  const fuzzyMatch = await AvailableService.findOne({
    isActive: true,
    name: { $regex: /pro/i }
  }).sort({ price: -1 });

  if (fuzzyMatch) {
    return fuzzyMatch;
  }

  return AvailableService.findOne({ isActive: true }).sort({ price: -1, createdAt: 1 });
};

exports.getAvailableServices = async (req, res) => {
  try {
    const services = await AvailableService.find({ isActive: true })
      .select('name tier description maxApplications price priceINR priceUSD currency billingCycle trialDays discount features badge displayOrder prioritySupport profileBoost applicationHighlight allZonesIncluded')
      .sort({ displayOrder: 1, price: 1 })
      .lean();

    // Fetch zones for each plan
    const PlanZone = require('../models/PlanZone');
    const Zone = require('../models/Zone');

    const serviceIds = services.map(s => s._id);
    const planZones = await PlanZone.find({ planId: { $in: serviceIds } })
      .populate('zoneId', 'name description')
      .lean();

    // Group zones by planId
    const zonesByPlan = {};
    for (const pz of planZones) {
      if (!pz.zoneId) continue;
      const planIdStr = pz.planId.toString();
      if (!zonesByPlan[planIdStr]) {
        zonesByPlan[planIdStr] = [];
      }
      zonesByPlan[planIdStr].push({
        id: pz.zoneId._id,
        name: pz.zoneId.name,
        description: pz.zoneId.description
      });
    }

    // For plans with allZonesIncluded, fetch all zones
    const allZones = await Zone.find().select('name description').lean();
    const allZonesFormatted = allZones.map(z => ({
      id: z._id,
      name: z.name,
      description: z.description
    }));

    // Attach zones to each service
    const servicesWithZones = services.map(service => {
      const serviceIdStr = service._id.toString();
      return {
        ...service,
        zones: service.allZonesIncluded
          ? allZonesFormatted
          : (zonesByPlan[serviceIdStr] || [])
      };
    });

    res.json({ services: servicesWithZones });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.getCurrentSubscription = async (req, res) => {
  try {
    const student = await Student.findOne({ userId: req.user.userId });

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    // Get application limit and usage from subscription counter
    const applicationLimit = await getApplicationLimit(student._id);
    const { applicationsUsed } = await getSubscriptionUsage(student._id);

    const subscriptionState = await checkSubscriptionStatus(student._id);

    if (!subscriptionState.subscription) {
      return res.json({
        subscriptionTier: student.subscriptionTier || 'free',
        currentSubscription: null,
        status: 'free',
        isActive: true,
        inGracePeriod: false,
        applicationLimit: applicationLimit === Infinity ? null : applicationLimit,
        applicationsUsed,
        applicationsRemaining: applicationLimit === Infinity ? null : Math.max(0, applicationLimit - applicationsUsed)
      });
    }

    const subscription = subscriptionState.subscription;

    res.json({
      subscriptionTier: student.subscriptionTier,
      status: subscriptionState.status,
      isActive: subscriptionState.isActive,
      inGracePeriod: subscriptionState.inGracePeriod,
      currentSubscription: {
        id: subscription._id,
        service: subscription.serviceId,
        startDate: subscription.startDate,
        endDate: subscription.endDate,
        status: subscription.status,
        autoRenew: subscription.autoRenew
      },
      applicationLimit: applicationLimit === Infinity ? null : applicationLimit,
      applicationsUsed,
      applicationsRemaining: applicationLimit === Infinity ? null : Math.max(0, applicationLimit - applicationsUsed)
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

const createOrUpgradeSubscriptionForStudent = async ({
  student,
  service,
  paymentMethod = 'manual',
  currency = 'USD',
  gatewayResponse = null,
  createPaymentRecord = true,
  paymentAmount = null
}) => {
  if (!student) {
    const error = new Error('Student not found');
    error.statusCode = 404;
    throw error;
  }

  if (!service) {
    const error = new Error('Subscription service not found. Please configure the Pro plan or provide a valid serviceId.');
    error.statusCode = 404;
    throw error;
  }

  if (service.tier === 'free') {
    const error = new Error('Cannot subscribe to free tier through this endpoint');
    error.statusCode = 400;
    throw error;
  }

  const now = new Date();
  let remainingApplications = 0;
  let addonZonesToPreserve = [];
  let currentSubscription = null;

  // Check current subscription if exists
  if (student.currentSubscriptionId) {
    currentSubscription = await ActiveSubscription.findOne({
      _id: student.currentSubscriptionId,
      studentId: student._id,
      status: { $in: ['active', 'pending'] }
    }).populate('serviceId', 'maxApplications');

    if (currentSubscription) {
      // Block same plan purchase
      if (currentSubscription.serviceId._id.toString() === service._id.toString()) {
        const currentMax = currentSubscription.serviceId.maxApplications;
        const used = currentSubscription.applicationsUsed || 0;
        const remaining = currentMax === null ? Infinity : currentMax - used;

        if (remaining > 0 || currentMax === null) {
          const error = new Error('You already have an active subscription to this plan with remaining applications. Please use your current quota or upgrade to a different plan.');
          error.statusCode = 400;
          error.code = 'SAME_PLAN_ACTIVE';
          throw error;
        }
      }

      // Calculate remaining applications to stack
      const currentMax = currentSubscription.serviceId.maxApplications;
      const used = currentSubscription.applicationsUsed || 0;

      if (currentMax !== null) {
        remainingApplications = Math.max(0, currentMax - used);
      }
      // If currentMax is null (unlimited), we don't carry over anything special

      // Get addon-purchased zones to preserve
      const SubscriptionZone = require('../models/SubscriptionZone');
      const addonZones = await SubscriptionZone.find({
        subscriptionId: currentSubscription._id,
        source: 'addon'
      }).lean();

      addonZonesToPreserve = addonZones.map(z => z.zoneId);

      // Mark previous subscription as exhausted
      await ActiveSubscription.updateOne(
        { _id: currentSubscription._id },
        { $set: { status: 'exhausted', autoRenew: false } }
      );
    }
  }

  // Calculate new maxApplications with stacking
  let newMaxApplications = service.maxApplications;
  if (newMaxApplications !== null && remainingApplications > 0) {
    newMaxApplications = service.maxApplications + remainingApplications;
  }

  // Create new subscription with stacked quota
  const subscription = await ActiveSubscription.create({
    studentId: student._id,
    serviceId: service._id,
    startDate: now,
    endDate: null, // Quota-based, not time-based
    status: 'active',
    autoRenew: false,
    applicationsUsed: 0,
    stackedApplications: remainingApplications
  });

  let paymentRecord = null;

  if (createPaymentRecord) {
    paymentRecord = await PaymentRecord.create({
      studentId: student._id,
      serviceId: service._id,
      subscriptionId: subscription._id,
      amount: paymentAmount ?? service.price,
      currency: String(currency || 'USD').toUpperCase(),
      paymentDate: now,
      status: 'completed',
      transactionId: generateTransactionId(),
      paymentMethod,
      gatewayResponse: {
        ...gatewayResponse,
        stackedApplications: remainingApplications,
        previousSubscriptionId: currentSubscription?._id?.toString() || null
      }
    });
  }

  await Student.updateOne(
    { _id: student._id },
    {
      $set: {
        currentSubscriptionId: subscription._id,
        subscriptionTier: service.tier === 'free' ? 'free' : 'paid'
      }
    }
  );

  // Populate subscription zones from plan configuration
  const { ensureSubscriptionZonesForPlan } = require('../services/zonePricingService');
  await ensureSubscriptionZonesForPlan({
    subscriptionId: subscription._id,
    serviceId: service._id
  });

  // Preserve addon-purchased zones from previous subscription
  if (addonZonesToPreserve.length > 0) {
    const SubscriptionZone = require('../models/SubscriptionZone');
    const zoneOperations = addonZonesToPreserve.map(zoneId => ({
      updateOne: {
        filter: {
          subscriptionId: subscription._id,
          zoneId
        },
        update: {
          $setOnInsert: {
            subscriptionId: subscription._id,
            zoneId,
            source: 'addon',
            createdAt: now
          }
        },
        upsert: true
      }
    }));

    await SubscriptionZone.bulkWrite(zoneOperations, { ordered: false });
  }

  // Also preserve addon records from previous subscription
  if (currentSubscription) {
    const SubscriptionAddon = require('../models/SubscriptionAddon');
    const previousAddons = await SubscriptionAddon.find({
      subscriptionId: currentSubscription._id
    }).lean();

    if (previousAddons.length > 0) {
      const Addon = require('../models/Addon');
      // Only preserve zone addons, not job addons (job credits are already counted in remaining)
      const zoneAddonIds = await Addon.find({ type: 'zone' }).distinct('_id');
      const zoneAddonIdStrings = zoneAddonIds.map(id => id.toString());

      const zoneAddonsToPreserve = previousAddons.filter(
        addon => zoneAddonIdStrings.includes(addon.addonId.toString())
      );

      if (zoneAddonsToPreserve.length > 0) {
        const addonOperations = zoneAddonsToPreserve.map(addon => ({
          updateOne: {
            filter: {
              subscriptionId: subscription._id,
              addonId: addon.addonId
            },
            update: {
              $setOnInsert: {
                subscriptionId: subscription._id,
                addonId: addon.addonId,
                paymentRecordId: addon.paymentRecordId,
                quantity: addon.quantity,
                createdAt: now
              }
            },
            upsert: true
          }
        }));

        await SubscriptionAddon.bulkWrite(addonOperations, { ordered: false });
      }
    }
  }

  const populatedSubscription = await ActiveSubscription.findById(subscription._id)
    .populate('serviceId', 'name description maxApplications price features');

  return {
    subscription: populatedSubscription,
    payment: paymentRecord,
    stackedApplications: remainingApplications
  };
};

exports.createOrUpgradeSubscriptionForStudent = createOrUpgradeSubscriptionForStudent;

exports.createOrUpgradeSubscription = async (req, res) => {
  try {
    const {
      serviceId,
      planKey = 'pro',
      autoRenew = false,
      paymentMethod = 'manual',
      currency = 'USD',
      gatewayResponse = null
    } = req.body;

    if (serviceId && !mongoose.Types.ObjectId.isValid(serviceId)) {
      return res.status(400).json({ error: 'Invalid service ID format' });
    }

    const student = await Student.findOne({ userId: req.user.userId });

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    let service = null;

    if (serviceId) {
      service = await AvailableService.findOne({ _id: serviceId, isActive: true });
    } else {
      service = await findDefaultProPlan(planKey);
    }

    if (!service) {
      return res.status(404).json({ error: 'Subscription service not found. Please configure the Pro plan or provide a valid serviceId.' });
    }

    const result = await createOrUpgradeSubscriptionForStudent({
      student,
      service,
      autoRenew,
      paymentMethod,
      currency,
      gatewayResponse,
      createPaymentRecord: true,
      paymentAmount: service.price
    });

    res.status(201).json({
      subscription: result.subscription,
      payment: result.payment
    });
  } catch (error) {
    console.error(error);

    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }

    res.status(500).json({ error: 'Server error' });
  }
};

exports.getPaymentHistory = async (req, res) => {
  try {
    const student = await Student.findOne({ userId: req.user.userId });

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const payments = await PaymentRecord.find({ studentId: student._id })
      .populate({
        path: 'subscriptionId',
        populate: {
          path: 'serviceId',
          select: 'name price maxApplications'
        }
      })
      .sort({ paymentDate: -1 });

    res.json({ payments });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.updateSubscription = async (req, res) => {
  try {
    const { autoRenew, extendByDays, status } = req.body;

    const student = await Student.findOne({ userId: req.user.userId });

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    if (!student.currentSubscriptionId) {
      return res.status(404).json({ error: 'No active subscription found for student' });
    }

    const subscription = await ActiveSubscription.findOne({
      _id: student.currentSubscriptionId,
      studentId: student._id
    }).populate('serviceId', 'name description maxApplications price features');

    if (!subscription) {
      await Student.updateOne(
        { _id: student._id },
        { $set: { currentSubscriptionId: null, subscriptionTier: 'free' } }
      );

      return res.status(404).json({ error: 'Subscription not found' });
    }

    const updateFields = {};

    if (typeof autoRenew !== 'undefined') {
      updateFields.autoRenew = Boolean(autoRenew);
    }

    if (typeof status !== 'undefined') {
      const normalizedStatus = String(status).toLowerCase();

      if (!['active', 'cancelled', 'pending'].includes(normalizedStatus)) {
        return res.status(400).json({ error: 'status must be active, pending, or cancelled' });
      }

      updateFields.status = normalizedStatus;
    }

    let createdPayment = null;

    if (typeof extendByDays !== 'undefined') {
      const extensionDays = parseInt(extendByDays, 10);

      if (Number.isNaN(extensionDays) || extensionDays < 1 || extensionDays > 365) {
        return res.status(400).json({ error: 'extendByDays must be between 1 and 365' });
      }

      const now = new Date();
      const baseline = subscription.endDate > now ? new Date(subscription.endDate) : now;
      baseline.setDate(baseline.getDate() + extensionDays);

      updateFields.endDate = baseline;
      updateFields.status = 'active';

      createdPayment = await PaymentRecord.create({
        studentId: student._id,
        subscriptionId: subscription._id,
        amount: subscription.serviceId?.price || 0,
        currency: 'USD',
        paymentDate: now,
        status: 'completed',
        transactionId: generateTransactionId(),
        paymentMethod: 'renewal',
        gatewayResponse: {
          type: 'renewal',
          extendByDays: extensionDays
        }
      });
    }

    if (Object.keys(updateFields).length === 0) {
      return res.status(400).json({ error: 'No valid fields provided for update' });
    }

    const updatedSubscription = await ActiveSubscription.findByIdAndUpdate(
      subscription._id,
      { $set: updateFields },
      { returnDocument: 'after' }
    ).populate('serviceId', 'name description maxApplications price features');

    if (updatedSubscription.status === 'cancelled') {
      await Student.updateOne(
        { _id: student._id },
        {
          $set: {
            currentSubscriptionId: null,
            subscriptionTier: 'free'
          }
        }
      );
    }

    res.json({
      subscription: updatedSubscription,
      payment: createdPayment
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.cancelSubscription = async (req, res) => {
  try {
    const student = await Student.findOne({ userId: req.user.userId });

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    if (!student.currentSubscriptionId) {
      return res.status(404).json({ error: 'No active subscription found for student' });
    }

    const subscription = await ActiveSubscription.findOneAndUpdate(
      {
        _id: student.currentSubscriptionId,
        studentId: student._id,
        status: { $in: ['active', 'pending'] }
      },
      {
        $set: {
          status: 'cancelled',
          autoRenew: false
        }
      },
      { returnDocument: 'after' }
    ).populate('serviceId', 'name description maxApplications price features');

    if (!subscription) {
      await Student.updateOne(
        { _id: student._id },
        { $set: { currentSubscriptionId: null, subscriptionTier: 'free' } }
      );

      return res.status(404).json({ error: 'Subscription not found or already inactive' });
    }

    await Student.updateOne(
      { _id: student._id },
      {
        $set: {
          currentSubscriptionId: null,
          subscriptionTier: 'free'
        }
      }
    );

    res.json({
      message: 'Subscription cancelled successfully',
      subscription
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};
