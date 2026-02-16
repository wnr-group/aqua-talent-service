const Student = require('../models/Student');
const ActiveSubscription = require('../models/ActiveSubscription');

const FREE_TIER_MAX_APPLICATIONS = 2;
const SUBSCRIPTION_GRACE_PERIOD_DAYS = 3;

const toGracePeriodEnd = (endDate) => {
  const graceEndDate = new Date(endDate);
  graceEndDate.setDate(graceEndDate.getDate() + SUBSCRIPTION_GRACE_PERIOD_DAYS);
  return graceEndDate;
};

const checkSubscriptionStatus = async (studentId) => {
  const student = await Student.findById(studentId);

  if (!student || !student.currentSubscriptionId) {
    return {
      tier: 'free',
      status: 'free',
      isActive: true,
      inGracePeriod: false,
      subscription: null
    };
  }

  const subscription = await ActiveSubscription.findById(student.currentSubscriptionId)
    .populate('serviceId', 'name maxApplications price');

  if (!subscription) {
    await Student.findByIdAndUpdate(studentId, {
      $set: {
        currentSubscriptionId: null,
        subscriptionTier: 'free'
      }
    });

    return {
      tier: 'free',
      status: 'free',
      isActive: true,
      inGracePeriod: false,
      subscription: null
    };
  }

  const now = new Date();
  const gracePeriodEnd = toGracePeriodEnd(subscription.endDate);

  if (subscription.status === 'cancelled') {
    return {
      tier: 'paid',
      status: 'cancelled',
      isActive: false,
      inGracePeriod: false,
      subscription
    };
  }

  const inGracePeriod = subscription.endDate < now && now <= gracePeriodEnd;
  const isActive = subscription.status === 'active' && (subscription.endDate >= now || inGracePeriod);

  if (!isActive && subscription.status !== 'expired' && subscription.endDate < now) {
    await ActiveSubscription.updateOne(
      { _id: subscription._id },
      { $set: { status: 'expired' } }
    );
    subscription.status = 'expired';
  }

  return {
    tier: 'paid',
    status: subscription.status,
    isActive,
    inGracePeriod,
    subscription
  };
};

const getApplicationLimit = async (studentId) => {
  const status = await checkSubscriptionStatus(studentId);

  if (status.isActive && status.subscription?.serviceId?.maxApplications) {
    return status.subscription.serviceId.maxApplications;
  }

  return FREE_TIER_MAX_APPLICATIONS;
};

const isSubscriptionActive = async (studentId) => {
  const status = await checkSubscriptionStatus(studentId);
  return status.isActive;
};

module.exports = {
  checkSubscriptionStatus,
  getApplicationLimit,
  isSubscriptionActive,
  FREE_TIER_MAX_APPLICATIONS,
  SUBSCRIPTION_GRACE_PERIOD_DAYS
};
