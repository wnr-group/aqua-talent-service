/**
 * notificationService.js
 *
 * Central service for creating in-app notifications.
 * All public helpers are fire-and-forget safe – callers are not expected
 * to await them, but they do return the saved document when awaited.
 */

const Notification = require('../models/Notification');
const User = require('../models/User');

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

const notifyJobApproved = (companyUserId, { jobTitle }) =>
  createNotification({
    recipientId: companyUserId,
    recipientType: 'company',
    type: 'job_approved',
    title: 'Job posting approved',
    message: `Your job posting "${jobTitle}" has been approved and is now live.`,
    link: `/company/jobs`
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
const notifyCompanyRejected = (companyUserId, { companyName, reason, rejectionReason }) => {
  const rejectionDetails = rejectionReason || reason;
  const reasonSuffix = rejectionDetails ? ` Reason: ${rejectionDetails}` : '';
  return createNotification({
    recipientId: companyUserId,
    recipientType: 'company',
    type: 'company_rejected',
    title: 'Company registration not approved',
    message: `Registration for ${companyName} was not approved.${reasonSuffix}`,
    link: `/company/dashboard`
  });
};

const getAdminUserIds = async () => {
  try {
    const admins = await User.find({ userType: 'admin' }).select('_id').lean();
    return admins.map((admin) => admin._id);
  } catch (error) {
    console.error('[notificationService] Failed to fetch admin recipients', {
      error: error.message
    });
    return [];
  }
};

const notifyAdminsNewCompanyPending = async ({ companyId, companyName }) => {
  try {
    const adminIds = await getAdminUserIds();
    if (!adminIds.length) {
      return [];
    }

    return Promise.all(
      adminIds.map((adminId) =>
        createNotification({
          recipientId: adminId,
          recipientType: 'admin',
          type: 'ADMIN_NEW_COMPANY_PENDING',
          title: 'New Company Registration Pending Approval',
          message: `${companyName} has registered and requires verification.`,
          link: `/admin/companies/${companyId}`
        })
      )
    );
  } catch (error) {
    console.error('[notificationService] Failed admin notification for company pending', {
      error: error.message,
      companyId
    });
    return [];
  }
};

const notifyAdminsNewJobPending = async ({ jobId, companyName }) => {
  try {
    const adminIds = await getAdminUserIds();
    if (!adminIds.length) {
      return [];
    }

    return Promise.all(
      adminIds.map((adminId) =>
        createNotification({
          recipientId: adminId,
          recipientType: 'admin',
          type: 'ADMIN_NEW_JOB_PENDING',
          title: 'New Job Posting Pending Review',
          message: `${companyName} submitted a job for approval.`,
          link: `/admin/jobs/${jobId}`
        })
      )
    );
  } catch (error) {
    console.error('[notificationService] Failed admin notification for job pending', {
      error: error.message,
      jobId
    });
    return [];
  }
};

const notifyAdminsCompanyReverifyRequired = async ({ companyId, companyName }) => {
  try {
    const adminIds = await getAdminUserIds();
    if (!adminIds.length) {
      return [];
    }

    return Promise.all(
      adminIds.map((adminId) =>
        createNotification({
          recipientId: adminId,
          recipientType: 'admin',
          type: 'ADMIN_COMPANY_REVERIFY_REQUIRED',
          title: 'Company Profile Update Requires Review',
          message: `${companyName} updated verification details.`,
          link: `/admin/companies/${companyId}`
        })
      )
    );
  } catch (error) {
    console.error('[notificationService] Failed admin notification for company reverification', {
      error: error.message,
      companyId
    });
    return [];
  }
};

// ─── Exports ───────────────────────────────────────────────────────────────

module.exports = {
  createNotification,
  notifyApplicationSubmitted,
  notifyApplicationApproved,
  notifyApplicationRejected,
  notifyApplicationHired,
  notifyApplicationReceived,
  notifyJobApproved,
  notifyCompanyApproved,
  notifyCompanyRejected,
  notifyAdminsNewCompanyPending,
  notifyAdminsNewJobPending,
  notifyAdminsCompanyReverifyRequired
};
