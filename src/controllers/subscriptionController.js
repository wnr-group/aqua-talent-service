const mongoose = require('mongoose');

const Student = require('../models/Student');
const AvailableService = require('../models/AvailableService');
const ActiveSubscription = require('../models/ActiveSubscription');
const PaymentRecord = require('../models/PaymentRecord');
const { checkSubscriptionStatus } = require('../services/subscriptionService');

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
      .select('name description maxApplications price features isActive')
      .sort({ price: 1, createdAt: 1 });

    res.json({ services });
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

    const subscriptionState = await checkSubscriptionStatus(student._id);

    if (!subscriptionState.subscription) {
      return res.json({
        subscriptionTier: student.subscriptionTier || 'free',
        currentSubscription: null,
        status: 'free',
        isActive: true,
        inGracePeriod: false
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
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.createOrUpgradeSubscription = async (req, res) => {
  try {
    const {
      serviceId,
      planKey = 'pro',
      durationDays = 30,
      autoRenew = false,
      paymentMethod = 'manual',
      currency = 'USD',
      gatewayResponse = null
    } = req.body;

    if (serviceId && !mongoose.Types.ObjectId.isValid(serviceId)) {
      return res.status(400).json({ error: 'Invalid service ID format' });
    }

    const duration = parseInt(durationDays);

    if (Number.isNaN(duration) || duration < 1 || duration > 365) {
      return res.status(400).json({ error: 'durationDays must be between 1 and 365' });
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

    const now = new Date();
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + duration);

    if (student.currentSubscriptionId) {
      await ActiveSubscription.updateOne(
        { _id: student.currentSubscriptionId, studentId: student._id, status: { $in: ['active', 'pending'] } },
        { $set: { status: 'cancelled', autoRenew: false } }
      );
    }

    const subscription = await ActiveSubscription.create({
      studentId: student._id,
      serviceId: service._id,
      startDate: now,
      endDate,
      status: 'active',
      autoRenew: Boolean(autoRenew)
    });

    const paymentRecord = await PaymentRecord.create({
      studentId: student._id,
      subscriptionId: subscription._id,
      amount: service.price,
      currency: String(currency || 'USD').toUpperCase(),
      paymentDate: now,
      status: 'completed',
      transactionId: generateTransactionId(),
      paymentMethod,
      gatewayResponse
    });

    await Student.updateOne(
      { _id: student._id },
      {
        $set: {
          currentSubscriptionId: subscription._id,
          subscriptionTier: 'paid'
        }
      }
    );

    const populatedSubscription = await ActiveSubscription.findById(subscription._id)
      .populate('serviceId', 'name description maxApplications price features');

    res.status(201).json({
      subscription: populatedSubscription,
      payment: paymentRecord
    });
  } catch (error) {
    console.error(error);
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
