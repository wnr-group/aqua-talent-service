const JOB_STATUSES = ['draft', 'pending', 'approved', 'rejected', 'unpublished', 'closed'];

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

const COMPANY_INDUSTRIES = [
  'Technology',
  'Finance',
  'Healthcare',
  'Education',
  'Manufacturing',
  'Retail',
  'Consulting',
  'Media',
  'Non-profit',
  'Other'
];

const COMPANY_SIZES = [
  '1-10',
  '11-50',
  '51-200',
  '201-500',
  '501-1000',
  '1000+'
];

const CONFIG_KEYS = {
  FREE_TIER_MAX_APPLICATIONS: 'free_tier_max_applications',
  FREE_TIER_FEATURES: 'free_tier_features',
  FREE_TIER_RESUME_DOWNLOADS: 'free_tier_resume_downloads',
  FREE_TIER_VIDEO_VIEWS: 'free_tier_video_views'
};

const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'AUD', 'CAD'];

const BILLING_CYCLES = ['monthly', 'quarterly', 'yearly', 'one-time'];

module.exports = {
  JOB_STATUSES,
  APPLICATION_STATUSES,
  COMPANY_STATUSES,
  JOB_TYPES,
  SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_TIERS,
  COMPANY_INDUSTRIES,
  COMPANY_SIZES,
  CONFIG_KEYS,
  CURRENCIES,
  BILLING_CYCLES
};
