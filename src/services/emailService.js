const Mailgun = require('mailgun.js');
const FormData = require('form-data');

const {
  MAILGUN_API_KEY,
  MAILGUN_DOMAIN,
  MAILGUN_BASE_URL = 'https://api.mailgun.net',
  MAILGUN_FROM_EMAIL,
  EMAIL_ENABLED = 'false',
  APP_BASE_URL = ''
} = process.env;

const { logEmailSuccess, logEmailFailure, logEmailSkip } = require('../utils/emailLogger');
const {
  getApplicationStatusTemplate,
  getWelcomeTemplate,
  getCompanyApprovedTemplate,
  getCompanyRejectedTemplate
} = require('../templates/emailTemplates');
const {
  shouldSendEmail,
  EMAIL_NOTIFICATION_TYPES,
  NOTIFICATION_CHANNELS
} = require('./notificationPreferenceService');

const emailEnabled = EMAIL_ENABLED.toLowerCase() === 'true';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const UNSUB_PLACEHOLDER_REGEX = /{{unsubscribe_url}}/g;
const APPLICATION_EMAIL_TYPE_MAP = {
  submitted: EMAIL_NOTIFICATION_TYPES.APPLICATION_SUBMITTED,
  approved: EMAIL_NOTIFICATION_TYPES.APPLICATION_APPROVED,
  rejected: EMAIL_NOTIFICATION_TYPES.APPLICATION_REJECTED,
  hired: EMAIL_NOTIFICATION_TYPES.APPLICATION_HIRED
};

let mailgunClient = null;

const initializeClient = () => {
  if (!emailEnabled) {
    return null;
  }

  if (!MAILGUN_API_KEY || !MAILGUN_DOMAIN || !MAILGUN_FROM_EMAIL) {
    logEmailFailure('Mailgun configuration incomplete', {
      MAILGUN_DOMAIN: Boolean(MAILGUN_DOMAIN),
      MAILGUN_FROM_EMAIL: Boolean(MAILGUN_FROM_EMAIL)
    });
    return null;
  }

  const mailgun = new Mailgun(FormData);
  return mailgun.client({
    username: 'api',
    key: MAILGUN_API_KEY,
    url: MAILGUN_BASE_URL
  });
};

const getClient = () => {
  if (!mailgunClient) {
    mailgunClient = initializeClient();
  }
  return mailgunClient;
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const executeWithRetry = async (fn, attempt = 1) => {
  try {
    return await fn();
  } catch (error) {
    if (attempt >= MAX_RETRIES) {
      throw error;
    }
    await delay(RETRY_DELAY_MS * attempt);
    return executeWithRetry(fn, attempt + 1);
  }
};

const scheduleTask = (taskName, handler) =>
  new Promise((resolve, reject) => {
    setImmediate(async () => {
      try {
        const result = await handler();
        resolve(result);
      } catch (error) {
        logEmailFailure(`${taskName} failed`, { error: error.message });
        reject(error);
      }
    });
  });

const normalizeRecipients = (recipients) => {
  const list = Array.isArray(recipients) ? recipients : [recipients];
  const filtered = list
    .filter(Boolean)
    .map((email) => email.trim())
    .filter((email) => email.length > 0);

  if (filtered.length === 0) {
    throw new Error('No recipients provided');
  }

  return filtered;
};

const trimTrailingSlash = (value = '') => value.replace(/\/$/, '');

const buildUnsubscribeUrl = (email) => {
  if (!email) {
    return null;
  }

  const base = trimTrailingSlash(APP_BASE_URL || '');
  if (!base) {
    return null;
  }

  return `${base}/unsubscribe?email=${encodeURIComponent(email)}`;
};

const injectUnsubscribeUrl = (content, unsubscribeUrl) => {
  if (!content) {
    return content;
  }

  if (!unsubscribeUrl) {
    return content.replace(UNSUB_PLACEHOLDER_REGEX, '#');
  }

  return content.replace(UNSUB_PLACEHOLDER_REGEX, unsubscribeUrl);
};

const getApplicationEmailType = (status = 'submitted') => {
  const normalized = (status || 'submitted').toLowerCase();
  return APPLICATION_EMAIL_TYPE_MAP[normalized] || EMAIL_NOTIFICATION_TYPES.APPLICATION_SUBMITTED;
};

const buildPayload = (to, subject, html, text, unsubscribeUrl) => {
  if (!MAILGUN_DOMAIN) {
    throw new Error('MAILGUN_DOMAIN is not configured');
  }

  if (!MAILGUN_FROM_EMAIL) {
    throw new Error('MAILGUN_FROM_EMAIL is not configured');
  }

  const recipients = normalizeRecipients(to);

  const payload = {
    from: MAILGUN_FROM_EMAIL,
    to: recipients,
    subject,
    html,
    text
  };

  if (unsubscribeUrl) {
    payload['h:List-Unsubscribe'] = `<${unsubscribeUrl}>`;
  }

  return payload;
};

const sendEmail = async (to, subject, html, text = '', options = {}) =>
  scheduleTask('sendEmail', async () => {
    const recipients = normalizeRecipients(to);

    if (!emailEnabled) {
      logEmailSkip('EMAIL_ENABLED=false, skipping send', { to: recipients, subject });
      return { skipped: true };
    }

    const { userId = null, emailType = null } = options;

    if (userId && emailType) {
      const allowSend = await shouldSendEmail({
        userId,
        emailType,
        channel: NOTIFICATION_CHANNELS.EMAIL
      });

      if (!allowSend) {
        logEmailSkip('Recipient opted out via notification preference', {
          to: recipients,
          emailType
        });
        return { skipped: true, reason: 'opted_out' };
      }
    }

    const client = getClient();
    if (!client) {
      const error = new Error('Mailgun client not initialized');
      logEmailFailure('Unable to send email', { to: recipients, subject, error: error.message });
      throw error;
    }

    const unsubscribeUrl = buildUnsubscribeUrl(recipients[0]);
    const processedHtml = injectUnsubscribeUrl(html, unsubscribeUrl);
    const processedText = injectUnsubscribeUrl(text, unsubscribeUrl);
    const payload = buildPayload(recipients, subject, processedHtml, processedText, unsubscribeUrl);

    await executeWithRetry(() => client.messages.create(MAILGUN_DOMAIN, payload));
    logEmailSuccess('Email sent', { to: recipients, subject, emailType });
    return { success: true };
  });

const sendApplicationStatusEmail = (studentEmail, applicationData = {}, options = {}) => {
  const template = getApplicationStatusTemplate(applicationData.status, applicationData);
  const emailType = getApplicationEmailType(applicationData.status);
  return sendEmail(studentEmail, template.subject, template.html, template.text, {
    ...options,
    emailType
  });
};

const sendWelcomeEmail = (userEmail, userData = {}, options = {}) => {
  const template = getWelcomeTemplate(userData.userType, userData);
  return sendEmail(userEmail, template.subject, template.html, template.text, options);
};

const sendCompanyApprovedEmail = (companyEmail, companyData = {}, options = {}) => {
  const template = getCompanyApprovedTemplate(companyData);
  return sendEmail(companyEmail, template.subject, template.html, template.text, {
    ...options,
    emailType: EMAIL_NOTIFICATION_TYPES.COMPANY_APPROVED
  });
};

const sendCompanyRejectedEmail = (companyEmail, companyData = {}, options = {}) => {
  const template = getCompanyRejectedTemplate(companyData);
  return sendEmail(companyEmail, template.subject, template.html, template.text, {
    ...options,
    emailType: EMAIL_NOTIFICATION_TYPES.COMPANY_REJECTED
  });
};

module.exports = {
  sendEmail,
  sendApplicationStatusEmail,
  sendWelcomeEmail,
  sendCompanyApprovedEmail,
  sendCompanyRejectedEmail
};
