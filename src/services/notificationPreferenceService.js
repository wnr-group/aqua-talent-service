const NotificationPreference = require('../models/NotificationPreference');

const NOTIFICATION_CHANNELS = {
  EMAIL: 'email'
};

const EMAIL_NOTIFICATION_TYPES = {
  APPLICATION_SUBMITTED: 'application_submitted',
  APPLICATION_APPROVED: 'application_approved',
  APPLICATION_REJECTED: 'application_rejected',
  APPLICATION_HIRED: 'application_hired',
  COMPANY_APPROVED: 'company_approved',
  COMPANY_REJECTED: 'company_rejected'
};

const shouldSendEmail = async ({ userId, emailType, channel = NOTIFICATION_CHANNELS.EMAIL }) => {
  if (!userId || !emailType) {
    return true;
  }

  try {
    const preference = await NotificationPreference.findOne({
      userId,
      emailType,
      channel
    })
      .select('optedOut')
      .lean();

    if (!preference) {
      return true;
    }

    return preference.optedOut !== true;
  } catch (error) {
    console.error('Failed to read notification preferences', { error: error.message, userId, emailType });
    return true;
  }
};

module.exports = {
  NOTIFICATION_CHANNELS,
  EMAIL_NOTIFICATION_TYPES,
  shouldSendEmail
};
