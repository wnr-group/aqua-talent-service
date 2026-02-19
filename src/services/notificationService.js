/**
 * notificationService.js
 *
 * Central service for creating in-app notifications.
 * All public helpers are fire-and-forget safe – callers are not expected
 * to await them, but they do return the saved document when awaited.
 */

const Notification = require('../models/Notification');

// ─── Low-level helpers ─────────────────────────────────────────────────────

/**
 * Persist a single notification.  Never throws to the caller; errors are
 * logged so that notification failures don't block API responses.
 *
 * @param {{
 *   recipientId: ObjectId|string,
 *   recipientType: string,
 *   type: string,
 *   title: string,
 *   message: string,
 *   link?: string
 * }} data
 */
const createNotification = async (data) => {
    console.log("STEP B: createNotification called with:", data);

  try {
    const notification = await Notification.create(data);
    return notification;
  } catch (error) {
    console.error('[notificationService] Failed to create notification', {
      error: error.message,
      data
    });
    return null;
  }
};

// ─── Application notifications ─────────────────────────────────────────────

/**
 * Student: their application has been submitted.
 */
const notifyApplicationSubmitted = (studentUserId, { jobTitle, companyName, applicationId }) =>
  createNotification({
    recipientId: studentUserId,
    recipientType: 'student',
    type: 'application_submitted',
    title: 'Application submitted',
    message: `Your application for "${jobTitle}" at ${companyName} has been submitted.`,
    link: `/my-applications`
  });

/**
 * Student: admin approved their application (forwarded to company).
 */
const notifyApplicationApproved = (studentUserId, { jobTitle, companyName }) =>
  createNotification({
    recipientId: studentUserId,
    recipientType: 'student',
    type: 'application_approved',
    title: 'Application approved',
    message: `Your application for "${jobTitle}" at ${companyName} has been approved and forwarded to the company.`,
    link: `/my-applications`
  });

/**
 * Student: admin rejected their application.
 */
const notifyApplicationRejected = (studentUserId, { jobTitle, companyName, reason }) => {
  const reasonSuffix = reason ? ` Reason: ${reason}` : '';
  return createNotification({
    recipientId: studentUserId,
    recipientType: 'student',
    type: 'application_rejected',
    title: 'Application not successful',
    message: `Your application for "${jobTitle}" at ${companyName} was not approved.${reasonSuffix}`,
    link: `/my-applications`
  });
};

/**
 * Student: company hired them.
 */
const notifyApplicationHired = (studentUserId, { jobTitle, companyName }) =>
  createNotification({
    recipientId: studentUserId,
    recipientType: 'student',
    type: 'application_hired',
    title: '🎉 You\'ve been hired!',
    message: `Congratulations! ${companyName} has selected you for the "${jobTitle}" role.`,
    link: `/my-applications`
  });

/**
 * Company: a new application was received for one of their jobs.
 */
const notifyApplicationReceived = (companyUserId, { jobTitle, studentName, applicationId }) =>
  createNotification({
    recipientId: companyUserId,
    recipientType: 'company',
    type: 'application_received',
    title: 'New application received',
    message: `${studentName} has applied for the "${jobTitle}" role.`,
    link: `/applications`
  });

// ─── Company registration notifications ────────────────────────────────────

/**
 * Company: their registration was approved by admin.
 */
const notifyCompanyApproved = (companyUserId, { companyName }) =>
  createNotification({
    recipientId: companyUserId,
    recipientType: 'company',
    type: 'company_approved',
    title: 'Company registration approved',
    message: `${companyName} has been approved. You can now post jobs and review applicants.`,
    link: `/company/dashboard`
  });

/**
 * Company: their registration was rejected by admin.
 */
const notifyCompanyRejected = (companyUserId, { companyName, reason }) => {
  const reasonSuffix = reason ? ` Reason: ${reason}` : '';
  return createNotification({
    recipientId: companyUserId,
    recipientType: 'company',
    type: 'company_rejected',
    title: 'Company registration not approved',
    message: `Registration for ${companyName} was not approved.${reasonSuffix}`,
    link: `/company/dashboard`
  });
};

// ─── Exports ───────────────────────────────────────────────────────────────

module.exports = {
  createNotification,
  notifyApplicationSubmitted,
  notifyApplicationApproved,
  notifyApplicationRejected,
  notifyApplicationHired,
  notifyApplicationReceived,
  notifyCompanyApproved,
  notifyCompanyRejected
};
