const Mailgun = require('mailgun.js');
const FormData = require('form-data');

const {
  MAILGUN_API_KEY,
  MAILGUN_DOMAIN,
  MAILGUN_BASE_URL = '',
  MAILGUN_REGION = 'us',
  MAILGUN_FROM_EMAIL,
  EMAIL_ENABLED = 'false',
  APP_BASE_URL = ''
} = process.env;

const { logEmailSuccess, logEmailFailure, logEmailSkip } = require('../utils/emailLogger');
const {
  getApplicationStatusTemplate,
  getWelcomeTemplate,
  getCompanyApprovedTemplate,
  getCompanyRejectedTemplate,
  getPasswordResetTemplate
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

const normalizeMailgunApiKey = () => {
  const rawKey = String(MAILGUN_API_KEY || '').trim();
  if (!rawKey) {
    return '';
  }

  if (rawKey.startsWith('key-')) {
    return rawKey;
  }

  if (/^[a-f0-9]{20,}-[a-f0-9-]{6,}$/i.test(rawKey)) {
    return `key-${rawKey}`;
  }

  return rawKey;
};

const normalizeMailgunBaseUrl = () => {
  if (MAILGUN_BASE_URL) {
    return MAILGUN_BASE_URL;
  }

  const region = String(MAILGUN_REGION || 'us').toLowerCase();
  return region === 'eu' ? 'https://api.eu.mailgun.net' : 'https://api.mailgun.net';
};

const extractEmailDomain = (fromEmail) => {
  const rawFrom = String(fromEmail || '').trim();
  if (!rawFrom) {
    return '';
  }

  const bracketMatch = rawFrom.match(/<([^>]+)>/);
  const emailValue = (bracketMatch?.[1] || rawFrom).trim();
  const atIndex = emailValue.lastIndexOf('@');

  if (atIndex === -1) {
    return '';
  }

  return emailValue.slice(atIndex + 1).toLowerCase();
};

const getFallbackMailgunBaseUrl = (currentBaseUrl) => {
  if (MAILGUN_BASE_URL) {
    return null;
  }

  if (String(currentBaseUrl || '').includes('api.eu.mailgun.net')) {
    return 'https://api.mailgun.net';
  }

  return 'https://api.eu.mailgun.net';
};

const buildMailgunClient = (baseUrl) => {
  const normalizedApiKey = normalizeMailgunApiKey();

  if (!normalizedApiKey) {
    return null;
  }

  const mailgun = new Mailgun(FormData);
  return mailgun.client({
    username: 'api',
    key: normalizedApiKey,
    url: baseUrl
  });
};

const initializeClient = () => {
  if (!emailEnabled) {
    return null;
  }

  const normalizedApiKey = normalizeMailgunApiKey();

  if (!normalizedApiKey || !MAILGUN_DOMAIN || !MAILGUN_FROM_EMAIL) {
    logEmailFailure('Mailgun configuration incomplete', {
      MAILGUN_API_KEY: Boolean(normalizedApiKey),
      MAILGUN_DOMAIN: Boolean(MAILGUN_DOMAIN),
      MAILGUN_FROM_EMAIL: Boolean(MAILGUN_FROM_EMAIL)
    });
    return null;
  }

  const configuredDomain = String(MAILGUN_DOMAIN || '').trim().toLowerCase();
  const senderDomain = extractEmailDomain(MAILGUN_FROM_EMAIL);

  if (!senderDomain || senderDomain !== configuredDomain) {
    logEmailFailure('MAILGUN_FROM_EMAIL domain must match MAILGUN_DOMAIN', {
      MAILGUN_DOMAIN: configuredDomain || null,
      MAILGUN_FROM_EMAIL_DOMAIN: senderDomain || null
    });
    return null;
  }

  if (normalizedApiKey !== String(MAILGUN_API_KEY || '').trim()) {
    logEmailSkip('MAILGUN_API_KEY appears to be missing key- prefix; applying normalized key format.');
  }

  const resolvedBaseUrl = normalizeMailgunBaseUrl();
  return buildMailgunClient(resolvedBaseUrl);
};

const getClient = () => {
  if (!mailgunClient) {
    mailgunClient = initializeClient();
  }
  return mailgunClient;
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const shouldRetryError = (error) => {
  const status = error?.status;

  if (status && [400, 401, 403, 404, 422].includes(status)) {
    return false;
  }

  return true;
};

const executeWithRetry = async (fn, attempt = 1) => {
  try {
    return await fn();
  } catch (error) {
    if (!shouldRetryError(error)) {
      throw error;
    }

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

    try {
      await executeWithRetry(() => client.messages.create(MAILGUN_DOMAIN, payload));
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) {
        const currentBaseUrl = normalizeMailgunBaseUrl();
        const fallbackBaseUrl = getFallbackMailgunBaseUrl(currentBaseUrl);

        if (fallbackBaseUrl) {
          const fallbackClient = buildMailgunClient(fallbackBaseUrl);

          if (fallbackClient) {
            try {
              await executeWithRetry(() => fallbackClient.messages.create(MAILGUN_DOMAIN, payload));
              logEmailSuccess('Email sent using Mailgun regional fallback', { to: recipients, subject, emailType, fallbackBaseUrl });
              return { success: true, fallbackBaseUrl };
            } catch (fallbackError) {
              error = fallbackError;
            }
          }
        }
      }

      if (error?.status === 401 || error?.status === 403) {
        logEmailFailure('Mailgun authorization failed. Verify MAILGUN_API_KEY, MAILGUN_DOMAIN, MAILGUN_FROM_EMAIL and MAILGUN_REGION/MAILGUN_BASE_URL.', {
          status: error?.status,
          details: error?.details,
          type: error?.type,
          MAILGUN_DOMAIN: Boolean(MAILGUN_DOMAIN),
          MAILGUN_FROM_EMAIL: Boolean(MAILGUN_FROM_EMAIL),
          MAILGUN_BASE_URL: normalizeMailgunBaseUrl(),
          MAILGUN_REGION
        });
      }
      throw error;
    }

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

const sendPasswordResetEmail = (userEmail, resetData = {}, options = {}) => {
  const template = getPasswordResetTemplate(resetData);
  return sendEmail(userEmail, template.subject, template.html, template.text, options);
};

module.exports = {
  sendEmail,
  sendApplicationStatusEmail,
  sendWelcomeEmail,
  sendCompanyApprovedEmail,
  sendCompanyRejectedEmail,
  sendPasswordResetEmail
};
