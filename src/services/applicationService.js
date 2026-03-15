const Student = require('../models/Student');
const ActiveSubscription = require('../models/ActiveSubscription');
const { getApplicationLimit } = require('./subscriptionService');

const getSubscriptionUsage = async (studentId) => {
  const student = await Student.findById(studentId);

  if (!student?.currentSubscriptionId) {
    return { applicationsUsed: 0, subscription: null };
  }

  const subscription = await ActiveSubscription.findById(student.currentSubscriptionId)
    .populate('serviceId', 'maxApplications');

  if (!subscription) {
    return { applicationsUsed: 0, subscription: null };
  }

  return {
    applicationsUsed: subscription.applicationsUsed || 0,
    subscription
  };
};

const incrementApplicationCount = async (studentId) => {
  const student = await Student.findById(studentId);

  if (!student?.currentSubscriptionId) {
    return null;
  }

  const subscription = await ActiveSubscription.findByIdAndUpdate(
    student.currentSubscriptionId,
    { $inc: { applicationsUsed: 1 } },
    { new: true }
  );

  return subscription;
};

const decrementApplicationCount = async (studentId) => {
  const student = await Student.findById(studentId);

  if (!student?.currentSubscriptionId) {
    return null;
  }

  // Only decrement if applicationsUsed > 0
  const subscription = await ActiveSubscription.findOneAndUpdate(
    { _id: student.currentSubscriptionId, applicationsUsed: { $gt: 0 } },
    { $inc: { applicationsUsed: -1 } },
    { new: true }
  );

  return subscription;
};

const canApply = async (studentId) => {
  const student = await Student.findById(studentId);

  if (!student) {
    return {
      canApply: false,
      reason: 'not_found'
    };
  }

  if (student.isHired) {
    return {
      canApply: false,
      reason: 'hired'
    };
  }

  const applicationLimit = await getApplicationLimit(studentId);
  const { applicationsUsed } = await getSubscriptionUsage(studentId);

  if (applicationLimit === Infinity) {
    return {
      canApply: true,
      applicationsUsed,
      applicationLimit: null
    };
  }

  if (applicationsUsed >= applicationLimit) {
    return {
      canApply: false,
      reason: 'limit',
      applicationsUsed,
      applicationLimit
    };
  }

  return {
    canApply: true,
    applicationsUsed,
    applicationLimit
  };
};

/**
 * Business rule: a student may request withdrawal when their application is
 * in `pending` or `reviewed` (shortlisted) state.  For every other status the
 * request is denied so callers can surface a useful error without throwing.
 */
const validateWithdrawal = (application) => {
  const allowedStatuses = ['pending', 'reviewed'];

  if (!allowedStatuses.includes(application.status)) {
    return {
      allowed: false,
      message: `Withdrawal request is not allowed for applications with status '${application.status}'.`
    };
  }

  return { allowed: true };
};

module.exports = {
  getSubscriptionUsage,
  incrementApplicationCount,
  decrementApplicationCount,
  validateWithdrawal,
  canApply
};
