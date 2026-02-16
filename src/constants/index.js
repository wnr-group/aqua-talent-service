const JOB_STATUSES = ['pending', 'approved', 'rejected', 'closed'];

const APPLICATION_STATUSES = ['pending', 'reviewed', 'hired', 'rejected', 'withdrawn'];

const COMPANY_STATUSES = ['pending', 'approved', 'rejected'];

const JOB_TYPES = [
  'Full-time',
  'Part-time',
  'Contract',
  'Internship',
  'Freelance'
];

const SUBSCRIPTION_STATUSES = ['active', 'expired', 'cancelled', 'pending'];

const SUBSCRIPTION_TIERS = ['free', 'paid'];

module.exports = {
  JOB_STATUSES,
  APPLICATION_STATUSES,
  COMPANY_STATUSES,
  JOB_TYPES,
  SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_TIERS
};
