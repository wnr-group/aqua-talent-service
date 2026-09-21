"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifyAdminsApplicationWithdrawn = exports.notifyWithdrawalRejected = exports.notifyWithdrawalApproved = exports.notifyAdminsWithdrawalRequested = exports.notifyAdminsNewApplication = exports.notifyAdminsCompanyReverifyRequired = exports.notifyAdminsNewJobPending = exports.notifyAdminsNewCompanyPending = exports.notifyCompanyRejected = exports.notifyCompanyApproved = exports.notifyJobApproved = exports.notifyApplicationReceived = exports.notifyApplicationHired = exports.notifyApplicationOfferExtended = exports.notifyApplicationInterviewScheduled = exports.notifyApplicationRejected = exports.notifyApplicationApproved = exports.notifyApplicationSubmitted = exports.createNotification = void 0;
/**
 * notificationService.ts
 *
 * Central service for creating in-app notifications.
 * All public helpers are fire-and-forget safe - callers are not expected
 * to await them, but they do return the saved row when awaited.
 */
const client_1 = require("../lib/supabase/client");
const createNotification = async (data) => {
    try {
        const supabase = (0, client_1.getSupabaseClient)();
        const { data: notification, error } = await supabase
            .from('notifications')
            .insert({
            recipient_id: data.recipientId,
            recipient_type: data.recipientType,
            type: data.type,
            title: data.title,
            message: data.message,
            link: data.link ?? null
        })
            .select()
            .single();
        if (error) {
            throw error;
        }
        return notification;
    }
    catch (error) {
        console.error('[notificationService] Failed to create notification', {
            error: error.message,
            data
        });
        return null;
    }
};
exports.createNotification = createNotification;
// ─── Application notifications ─────────────────────────────────────────────
const notifyApplicationSubmitted = (studentUserId, { jobTitle, companyName }) => (0, exports.createNotification)({
    recipientId: studentUserId,
    recipientType: 'student',
    type: 'application_submitted',
    title: 'Application submitted',
    message: `Your application for "${jobTitle}" at ${companyName} has been submitted.`,
    link: `/my-applications`
});
exports.notifyApplicationSubmitted = notifyApplicationSubmitted;
const notifyApplicationApproved = (studentUserId, { jobTitle, companyName }) => (0, exports.createNotification)({
    recipientId: studentUserId,
    recipientType: 'student',
    type: 'application_approved',
    title: 'Application approved',
    message: `Your application for "${jobTitle}" at ${companyName} has been approved and forwarded to the company.`,
    link: `/my-applications`
});
exports.notifyApplicationApproved = notifyApplicationApproved;
const notifyApplicationRejected = (studentUserId, { jobTitle, companyName, reason }) => {
    const reasonSuffix = reason ? ` Reason: ${reason}` : '';
    return (0, exports.createNotification)({
        recipientId: studentUserId,
        recipientType: 'student',
        type: 'application_rejected',
        title: 'Application not successful',
        message: `Your application for "${jobTitle}" at ${companyName} was not approved.${reasonSuffix}`,
        link: `/my-applications`
    });
};
exports.notifyApplicationRejected = notifyApplicationRejected;
const formatInterviewDateTime = (value) => {
    if (!value) {
        return null;
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return null;
    }
    const formatted = new Intl.DateTimeFormat('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'UTC'
    }).format(date);
    return `${formatted} UTC`;
};
const notifyApplicationInterviewScheduled = (studentUserId, { jobTitle, companyName, interviewDate }) => {
    const interviewDateTime = formatInterviewDateTime(interviewDate);
    const interviewSuffix = interviewDateTime ? ` Interview: ${interviewDateTime}.` : '';
    return (0, exports.createNotification)({
        recipientId: studentUserId,
        recipientType: 'student',
        type: 'application_interview_scheduled',
        title: 'Interview scheduled',
        message: `Great news! An interview has been scheduled for "${jobTitle}" at ${companyName}.${interviewSuffix}`,
        link: `/my-applications`
    });
};
exports.notifyApplicationInterviewScheduled = notifyApplicationInterviewScheduled;
const notifyApplicationOfferExtended = (studentUserId, { jobTitle, companyName }) => (0, exports.createNotification)({
    recipientId: studentUserId,
    recipientType: 'student',
    type: 'application_offer_extended',
    title: 'Offer extended',
    message: `You have received an offer for "${jobTitle}" at ${companyName}. Check your email for details.`,
    link: `/my-applications`
});
exports.notifyApplicationOfferExtended = notifyApplicationOfferExtended;
const notifyApplicationHired = (studentUserId, { jobTitle, companyName }) => (0, exports.createNotification)({
    recipientId: studentUserId,
    recipientType: 'student',
    type: 'application_hired',
    title: '🎉 You\'ve been hired!',
    message: `Congratulations! ${companyName} has selected you for the "${jobTitle}" role.`,
    link: `/my-applications`
});
exports.notifyApplicationHired = notifyApplicationHired;
const notifyApplicationReceived = (companyUserId, { jobTitle, studentName }) => (0, exports.createNotification)({
    recipientId: companyUserId,
    recipientType: 'company',
    type: 'application_received',
    title: 'New application received',
    message: `${studentName} has applied for the "${jobTitle}" role.`,
    link: `/applications`
});
exports.notifyApplicationReceived = notifyApplicationReceived;
const notifyJobApproved = (companyUserId, { jobTitle }) => (0, exports.createNotification)({
    recipientId: companyUserId,
    recipientType: 'company',
    type: 'job_approved',
    title: 'Job posting approved',
    message: `Your job posting "${jobTitle}" has been approved and is now live.`,
    link: `/company/jobs`
});
exports.notifyJobApproved = notifyJobApproved;
// ─── Company registration notifications ────────────────────────────────────
const notifyCompanyApproved = (companyUserId, { companyName }) => (0, exports.createNotification)({
    recipientId: companyUserId,
    recipientType: 'company',
    type: 'company_approved',
    title: 'Company registration approved',
    message: `${companyName} has been approved. You can now post jobs and review applicants.`,
    link: `/company/dashboard`
});
exports.notifyCompanyApproved = notifyCompanyApproved;
const notifyCompanyRejected = (companyUserId, { companyName, reason, rejectionReason }) => {
    const rejectionDetails = rejectionReason || reason;
    const reasonSuffix = rejectionDetails ? ` Reason: ${rejectionDetails}` : '';
    return (0, exports.createNotification)({
        recipientId: companyUserId,
        recipientType: 'company',
        type: 'company_rejected',
        title: 'Company registration not approved',
        message: `Registration for ${companyName} was not approved.${reasonSuffix}`,
        link: `/company/dashboard`
    });
};
exports.notifyCompanyRejected = notifyCompanyRejected;
const getAdminUserIds = async () => {
    try {
        const supabase = (0, client_1.getSupabaseClient)();
        const { data: admins, error } = await supabase.from('users').select('id').eq('user_type', 'admin');
        if (error) {
            throw error;
        }
        return (admins || []).map((admin) => admin.id);
    }
    catch (error) {
        console.error('[notificationService] Failed to fetch admin recipients', { error: error.message });
        return [];
    }
};
const notifyAdminsNewCompanyPending = async ({ companyId, companyName }) => {
    try {
        const adminIds = await getAdminUserIds();
        if (!adminIds.length) {
            return [];
        }
        return Promise.all(adminIds.map((adminId) => (0, exports.createNotification)({
            recipientId: adminId,
            recipientType: 'admin',
            type: 'ADMIN_NEW_COMPANY_PENDING',
            title: 'New Company Registration Pending Approval',
            message: `${companyName} has registered and requires verification.`,
            link: `/admin/companies/${companyId}`
        })));
    }
    catch (error) {
        console.error('[notificationService] Failed admin notification for company pending', { error: error.message, companyId });
        return [];
    }
};
exports.notifyAdminsNewCompanyPending = notifyAdminsNewCompanyPending;
const notifyAdminsNewJobPending = async ({ jobId, companyName }) => {
    try {
        const adminIds = await getAdminUserIds();
        if (!adminIds.length) {
            return [];
        }
        return Promise.all(adminIds.map((adminId) => (0, exports.createNotification)({
            recipientId: adminId,
            recipientType: 'admin',
            type: 'ADMIN_NEW_JOB_PENDING',
            title: 'New Job Posting Pending Review',
            message: `${companyName} submitted a job for approval.`,
            link: `/admin/jobs/${jobId}`
        })));
    }
    catch (error) {
        console.error('[notificationService] Failed admin notification for job pending', { error: error.message, jobId });
        return [];
    }
};
exports.notifyAdminsNewJobPending = notifyAdminsNewJobPending;
const notifyAdminsCompanyReverifyRequired = async ({ companyId, companyName }) => {
    try {
        const adminIds = await getAdminUserIds();
        if (!adminIds.length) {
            return [];
        }
        return Promise.all(adminIds.map((adminId) => (0, exports.createNotification)({
            recipientId: adminId,
            recipientType: 'admin',
            type: 'ADMIN_COMPANY_REVERIFY_REQUIRED',
            title: 'Company Profile Update Requires Review',
            message: `${companyName} updated verification details.`,
            link: `/admin/companies/${companyId}`
        })));
    }
    catch (error) {
        console.error('[notificationService] Failed admin notification for company reverification', { error: error.message, companyId });
        return [];
    }
};
exports.notifyAdminsCompanyReverifyRequired = notifyAdminsCompanyReverifyRequired;
const notifyAdminsNewApplication = async ({ studentName, jobTitle, applicationId }) => {
    try {
        const adminIds = await getAdminUserIds();
        if (!adminIds.length) {
            return [];
        }
        return Promise.all(adminIds.map((adminId) => (0, exports.createNotification)({
            recipientId: adminId,
            recipientType: 'admin',
            type: 'ADMIN_NEW_APPLICATION',
            title: 'New Student Application',
            message: `${studentName} applied for "${jobTitle}". Application ID: ${applicationId}.`,
            link: `/admin/applications`
        })));
    }
    catch (error) {
        console.error('[notificationService] Failed admin notification for new application', { error: error.message, applicationId });
        return [];
    }
};
exports.notifyAdminsNewApplication = notifyAdminsNewApplication;
const notifyAdminsWithdrawalRequested = async ({ studentName, jobTitle, applicationId }) => {
    try {
        const adminIds = await getAdminUserIds();
        if (!adminIds.length) {
            return [];
        }
        return Promise.all(adminIds.map((adminId) => (0, exports.createNotification)({
            recipientId: adminId,
            recipientType: 'admin',
            type: 'withdrawal_requested',
            title: 'Withdrawal Request',
            message: `${studentName} has requested to withdraw their application for "${jobTitle}". Application ID: ${applicationId}.`,
            link: `/admin/applications`
        })));
    }
    catch (error) {
        console.error('[notificationService] Failed admin notification for withdrawal request', { error: error.message, applicationId });
        return [];
    }
};
exports.notifyAdminsWithdrawalRequested = notifyAdminsWithdrawalRequested;
const notifyWithdrawalApproved = (studentUserId, { jobTitle, companyName }) => (0, exports.createNotification)({
    recipientId: studentUserId,
    recipientType: 'student',
    type: 'withdrawal_approved',
    title: 'Withdrawal approved',
    message: `Your withdrawal request for "${jobTitle}" at ${companyName} has been approved.`,
    link: `/my-applications`
});
exports.notifyWithdrawalApproved = notifyWithdrawalApproved;
const notifyWithdrawalRejected = (studentUserId, { jobTitle, companyName }) => (0, exports.createNotification)({
    recipientId: studentUserId,
    recipientType: 'student',
    type: 'withdrawal_rejected',
    title: 'Withdrawal rejected',
    message: `Your withdrawal request for "${jobTitle}" at ${companyName} has been rejected. Your application has been restored.`,
    link: `/my-applications`
});
exports.notifyWithdrawalRejected = notifyWithdrawalRejected;
const notifyAdminsApplicationWithdrawn = async ({ studentName, jobTitle, applicationId }) => {
    try {
        const adminIds = await getAdminUserIds();
        if (!adminIds.length) {
            return [];
        }
        return Promise.all(adminIds.map((adminId) => (0, exports.createNotification)({
            recipientId: adminId,
            recipientType: 'admin',
            type: 'APPLICATION_WITHDRAWN',
            title: 'Application Withdrawn',
            message: `${studentName} has withdrawn their application for "${jobTitle}".`,
            link: `/admin/applications`
        })));
    }
    catch (error) {
        console.error('[notificationService] Failed admin notification for application withdrawal', { error: error.message, applicationId });
        return [];
    }
};
exports.notifyAdminsApplicationWithdrawn = notifyAdminsApplicationWithdrawn;
//# sourceMappingURL=notificationService.js.map