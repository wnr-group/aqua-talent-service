const DEFAULT_BRAND = 'AquaTalentz';
const UNSUB_PLACEHOLDER = '{{unsubscribe_url}}';

const buildHtmlLayout = ({ title, greeting, paragraphs = [], cta }) => {
  const paragraphMarkup = paragraphs
    .filter(Boolean)
    .map((text) => `<p style="margin:0 0 16px;font-size:15px;line-height:22px;color:#1f2933;">${text}</p>`)
    .join('');

  const ctaMarkup = cta?.url
    ? `<p style="margin:24px 0"><a href="${cta.url}" style="background:#2563eb;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block;">${cta.text || 'View details'}</a></p>`
    : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
  </head>
  <body style="font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;background:#f8fafc;padding:32px;margin:0;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;box-shadow:0 10px 35px rgba(15,23,42,0.08);">
      <tr>
        <td>
          <h1 style="font-size:22px;margin:0 0 16px;color:#0f172a;">${title}</h1>
          <p style="margin:0 0 16px;font-size:15px;line-height:22px;color:#0f172a;">${greeting}</p>
          ${paragraphMarkup}
          ${ctaMarkup}
          <p style="margin-top:32px;font-size:13px;color:#475467;">Cheers,<br/>The ${DEFAULT_BRAND} Team</p>
          <p style="margin-top:24px;font-size:12px;color:#98a2b3;">If you’d like to stop receiving these updates, <a href="${UNSUB_PLACEHOLDER}" style="color:#6366f1;">unsubscribe here</a>.</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
};

const buildTextLayout = ({ greeting, paragraphs = [], cta }) => {
  const body = [greeting, ...paragraphs, cta?.url ? `${cta.text || 'View details'}: ${cta.url}` : '', '', `Unsubscribe: ${UNSUB_PLACEHOLDER}`]
    .filter(Boolean)
    .join('\n\n');

  return `${body}\n`;
};

const getStudentName = (name) => name || 'there';
const getCompanyName = (name) => name || 'your prospective company';
const getRecipientName = (data = {}) =>
  data.recipientName || data.studentName || data.firstName || data.contactName || data.companyName || null;

const applicationTemplates = {
  application_submitted: (data = {}) => {
    const subject = 'Your application has been submitted';
    const paragraphs = [
      `Thanks for applying to ${getCompanyName(data.companyName)} for the ${data.jobTitle || 'role'}.`,
      'We’ll notify you as soon as there is an update.'
    ];
    const cta = data.applicationLink ? { text: 'View application', url: data.applicationLink } : undefined;
    return { subject, paragraphs, cta };
  },
  application_approved: (data = {}) => {
    const subject = `Good news! Your application is now with ${getCompanyName(data.companyName)}`;
    const paragraphs = [
      'The hiring team is reviewing your profile. We’ll keep you posted once they respond.',
      'In the meantime, feel free to prepare any supporting materials you’d like to share.'
    ];
    const cta = data.applicationLink ? { text: 'Review status', url: data.applicationLink } : undefined;
    return { subject, paragraphs, cta };
  },
  application_rejected: (data = {}) => {
    const subject = 'Update on your application';
    const paragraphs = [
      `${getCompanyName(data.companyName)} has decided not to move forward with the ${data.jobTitle || 'role'}.`,
      'Keep your momentum going—there are more opportunities waiting inside AquaTalentz.'
    ];
    const cta = data.dashboardLink ? { text: 'Discover more roles', url: data.dashboardLink } : undefined;
    return { subject, paragraphs, cta };
  },
  application_hired: (data = {}) => {
    const subject = 'Congratulations! You’ve been hired!';
    const paragraphs = [
      `Woohoo! ${getCompanyName(data.companyName)} can’t wait for you to join.`,
      'We’ll share any additional onboarding details as soon as they come through.'
    ];
    const cta = data.dashboardLink ? { text: 'Review next steps', url: data.dashboardLink } : undefined;
    return { subject, paragraphs, cta };
  }
};

const welcomeTemplates = {
  welcome_student: (data = {}) => {
    const subject = 'Welcome to AquaTalentz';
    const paragraphs = [
      'Your dashboard is the best place to discover curated roles, track applications, and showcase your profile.',
      'Keep your info fresh so employers get the best view of your experience.'
    ];
    const cta = data.dashboardLink ? { text: 'Explore your dashboard', url: data.dashboardLink } : undefined;
    return { subject, paragraphs, cta };
  },
  welcome_company: (data = {}) => {
    const subject = 'Your company registration is pending';
    const paragraphs = [
      'Thanks for registering your organization with AquaTalentz.',
      'Our team is reviewing your submission—expect an update shortly.'
    ];
    const cta = data.dashboardLink ? { text: 'Visit company dashboard', url: data.dashboardLink } : undefined;
    return { subject, paragraphs, cta };
  }
};

const companyApprovedTemplate = (data = {}) => {
  const subject = 'Your company has been approved';
  const paragraphs = [
    `${getCompanyName(data.companyName)} is now live on AquaTalentz.`,
    'Start posting roles, reviewing applicants, and building your talent pipeline.'
  ];
  const cta = data.dashboardLink ? { text: 'Post a new role', url: data.dashboardLink } : undefined;
  return { subject, paragraphs, cta };
};

const companyRejectedTemplate = (data = {}) => {
  const subject = 'Update on your company registration';
  const paragraphs = [
    `${getCompanyName(data.companyName)} was not approved this time.`,
    data.reason
      ? `Here is the feedback we received: ${data.reason}`
      : 'Please review your submission, update any missing details, and resubmit when ready.'
  ];
  const cta = data.dashboardLink ? { text: 'Update company profile', url: data.dashboardLink } : undefined;
  return { subject, paragraphs, cta };
};

const enrichTemplate = (templateBuilder, data = {}) => {
  const { subject, paragraphs, cta } = templateBuilder(data);
  const greeting = `Hi ${getStudentName(getRecipientName(data))}!`;
  const html = buildHtmlLayout({ title: subject, greeting, paragraphs, cta });
  const text = buildTextLayout({ greeting, paragraphs, cta });
  return { subject, html, text };
};

const getApplicationStatusTemplate = (status = 'submitted', data = {}) => {
  const key = `application_${(status || 'submitted').toLowerCase()}`;
  const builder = applicationTemplates[key] || applicationTemplates.application_submitted;
  return enrichTemplate(builder, data);
};

const getWelcomeTemplate = (userType = 'student', data = {}) => {
  const key = userType === 'company' ? 'welcome_company' : 'welcome_student';
  const builder = welcomeTemplates[key] || welcomeTemplates.welcome_student;
  return enrichTemplate(builder, data);
};

const getCompanyApprovedTemplate = (data = {}) => enrichTemplate(companyApprovedTemplate, data);

const getCompanyRejectedTemplate = (data = {}) => enrichTemplate(companyRejectedTemplate, data);

const emailTemplateKeys = {
  application_submitted: 'application_submitted',
  application_approved: 'application_approved',
  application_rejected: 'application_rejected',
  application_hired: 'application_hired',
  welcome_student: 'welcome_student',
  welcome_company: 'welcome_company',
  company_approved: 'company_approved',
  company_rejected: 'company_rejected'
};

module.exports = {
  getApplicationStatusTemplate,
  getWelcomeTemplate,
  getCompanyApprovedTemplate,
  getCompanyRejectedTemplate,
  emailTemplateKeys
};
