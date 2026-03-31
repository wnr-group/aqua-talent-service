const Student = require('../models/Student');
const ActiveSubscription = require('../models/ActiveSubscription');
const SystemConfig = require('../models/SystemConfig');
const { CONFIG_KEYS } = require('../constants');

const DEFAULT_FREE_TIER_MAX_APPLICATIONS = 2;
const SUBSCRIPTION_GRACE_PERIOD_DAYS = 3;

const toGracePeriodEnd = (endDate) => {
  const graceEndDate = new Date(endDate);
  graceEndDate.setDate(graceEndDate.getDate() + SUBSCRIPTION_GRACE_PERIOD_DAYS);
  return graceEndDate;
};

const getFreeTierMaxApplications = async () => {
  return DEFAULT_FREE_TIER_MAX_APPLICATIONS;
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
    .populate('serviceId', 'name tier description maxApplications price currency billingCycle trialDays discount features badge displayOrder prioritySupport profileBoost applicationHighlight isActive');

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
  const student = await Student.findById(studentId);

  if (student?.currentSubscriptionId) {
    const subscription = await ActiveSubscription.findById(student.currentSubscriptionId)
      .populate('serviceId', 'tier maxApplications');

    if (subscription?.serviceId?.tier === 'free') {
      // Include any purchased job-addon credits even on the free-tier plan so that
      // students who bought extra credits while on a free plan are not silently blocked.
      const { getAdditionalJobCredits } = require('./zonePricingService');
      const addonCredits = await getAdditionalJobCredits(subscription._id);
      const freeMax = await getFreeTierMaxApplications();
      return freeMax + addonCredits;
    }

    if (typeof subscription?.serviceId?.maxApplications === 'number') {
      // Include stacked applications from previous plan
      const baseLimit = subscription.serviceId.maxApplications;
      const stackedApps = subscription.stackedApplications || 0;

      // Include additional job credits from addons
      const { getAdditionalJobCredits } = require('./zonePricingService');
      const addonCredits = await getAdditionalJobCredits(subscription._id);

      return baseLimit + stackedApps + addonCredits;
    }

    // maxApplications is null means unlimited
    if (subscription?.serviceId?.maxApplications === null) {
      return Infinity;
    }
  }

  if (student?.subscriptionTier === 'free') {
    return getFreeTierMaxApplications();
  }

  return Infinity;
};

const isSubscriptionActive = async (studentId) => {
  const status = await checkSubscriptionStatus(studentId);
  return status.isActive;
};

module.exports = {
  checkSubscriptionStatus,
  getApplicationLimit,
  isSubscriptionActive,
  getFreeTierMaxApplications,
  SUBSCRIPTION_GRACE_PERIOD_DAYS
};
