const Student = require('../models/Student');
const Application = require('../models/Application');
const { getApplicationLimit } = require('./subscriptionService');

const NON_COUNTABLE_STATUSES = ['withdrawn', 'rejected'];

const getActiveApplicationCount = async (studentId) => {
  return Application.countDocuments({
    studentId,
    status: { $nin: NON_COUNTABLE_STATUSES }
  });
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

  if (applicationLimit === Infinity) {
    return {
      canApply: true,
      applicationsUsed: await getActiveApplicationCount(studentId),
      applicationLimit
    };
  }

  const applicationsUsed = await getActiveApplicationCount(studentId);

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
 * Business rule: withdrawal is not permitted at any stage after a student has applied.
 * Returns an object so callers can inspect the reason without catching exceptions.
 */
const validateWithdrawal = (application) => {
  // Withdrawal is unconditionally disallowed once an application exists.
  return {
    allowed: false,
    message: 'Application withdrawal is not allowed after applying.'
  };
};

module.exports = {
  getActiveApplicationCount,
  validateWithdrawal,
  canApply
};
