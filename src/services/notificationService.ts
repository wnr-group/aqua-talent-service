/**
 * notificationService.ts
 *
 * Central service for creating in-app notifications.
 * All public helpers are fire-and-forget safe - callers are not expected
 * to await them, but they do return the saved row when awaited.
 */
import { getSupabaseClient } from '../lib/supabase/client';

interface NotificationInput {
  recipientId: string;
  recipientType: string;
  type: string;
  title: string;
  message: string;
  link?: string | null;
}

export const createNotification = async (data: NotificationInput) => {
  try {
    const supabase = getSupabaseClient();
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
  } catch (error: any) {
    console.error('[notificationService] Failed to create notification', {
      error: error.message,
      data
    });
    return null;
  }
};

// ─── Application notifications ─────────────────────────────────────────────

export const notifyApplicationSubmitted = (
  studentUserId: string,
  { jobTitle, companyName }: { jobTitle: string; companyName: string }
) =>
  createNotification({
    recipientId: studentUserId,
    recipientType: 'student',
    type: 'application_submitted',
    title: 'Application submitted',
    message: `Your application for "${jobTitle}" at ${companyName} has been submitted.`,
    link: `/my-applications`
  });

export const notifyApplicationApproved = (
  studentUserId: string,
  { jobTitle, companyName }: { jobTitle: string; companyName: string }
) =>
  createNotification({
    recipientId: studentUserId,
    recipientType: 'student',
    type: 'application_approved',
    title: 'Application approved',
    message: `Your application for "${jobTitle}" at ${companyName} has been approved and forwarded to the company.`,
    link: `/my-applications`
  });

export const notifyApplicationRejected = (
  studentUserId: string,
  { jobTitle, companyName, reason }: { jobTitle: string; companyName: string; reason?: string | null }
) => {
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

const formatInterviewDateTime = (value: any): string | null => {
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

export const notifyApplicationInterviewScheduled = (
  studentUserId: string,
  { jobTitle, companyName, interviewDate }: { jobTitle: string; companyName: string; interviewDate?: any }
) => {
  const interviewDateTime = formatInterviewDateTime(interviewDate);
  const interviewSuffix = interviewDateTime ? ` Interview: ${interviewDateTime}.` : '';

  return createNotification({
    recipientId: studentUserId,
    recipientType: 'student',
    type: 'application_interview_scheduled',
    title: 'Interview scheduled',
    message: `Great news! An interview has been scheduled for "${jobTitle}" at ${companyName}.${interviewSuffix}`,
    link: `/my-applications`
  });
};

export const notifyApplicationOfferExtended = (
  studentUserId: string,
  { jobTitle, companyName }: { jobTitle: string; companyName: string }
) =>
  createNotification({
    recipientId: studentUserId,
    recipientType: 'student',
    type: 'application_offer_extended',
    title: 'Offer extended',
    message: `You have received an offer for "${jobTitle}" at ${companyName}. Check your email for details.`,
    link: `/my-applications`
  });

export const notifyApplicationHired = (
  studentUserId: string,
  { jobTitle, companyName }: { jobTitle: string; companyName: string }
) =>
  createNotification({
    recipientId: studentUserId,
    recipientType: 'student',
    type: 'application_hired',
    title: '🎉 You\'ve been hired!',
    message: `Congratulations! ${companyName} has selected you for the "${jobTitle}" role.`,
    link: `/my-applications`
  });

export const notifyApplicationReceived = (
  companyUserId: string,
  { jobTitle, studentName }: { jobTitle: string; studentName: string }
) =>
  createNotification({
    recipientId: companyUserId,
    recipientType: 'company',
    type: 'application_received',
    title: 'New application received',
    message: `${studentName} has applied for the "${jobTitle}" role.`,
    link: `/applications`
  });

export const notifyJobApproved = (companyUserId: string, { jobTitle }: { jobTitle: string }) =>
  createNotification({
    recipientId: companyUserId,
    recipientType: 'company',
    type: 'job_approved',
    title: 'Job posting approved',
    message: `Your job posting "${jobTitle}" has been approved and is now live.`,
    link: `/company/jobs`
  });

// ─── Company registration notifications ────────────────────────────────────

export const notifyCompanyApproved = (companyUserId: string, { companyName }: { companyName: string }) =>
  createNotification({
    recipientId: companyUserId,
    recipientType: 'company',
    type: 'company_approved',
    title: 'Company registration approved',
    message: `${companyName} has been approved. You can now post jobs and review applicants.`,
    link: `/company/dashboard`
  });

export const notifyCompanyRejected = (
  companyUserId: string,
  { companyName, reason, rejectionReason }: { companyName: string; reason?: string | null; rejectionReason?: string | null }
) => {
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

const getAdminUserIds = async (): Promise<string[]> => {
  try {
    const supabase = getSupabaseClient();
    const { data: admins, error } = await supabase.from('users').select('id').eq('user_type', 'admin');
    if (error) {
      throw error;
    }
    return (admins || []).map((admin) => admin.id);
  } catch (error: any) {
    console.error('[notificationService] Failed to fetch admin recipients', { error: error.message });
    return [];
  }
};

export const notifyAdminsNewCompanyPending = async ({ companyId, companyName }: { companyId: string; companyName: string }) => {
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
  } catch (error: any) {
    console.error('[notificationService] Failed admin notification for company pending', { error: error.message, companyId });
    return [];
  }
};

export const notifyAdminsNewJobPending = async ({ jobId, companyName }: { jobId: string; companyName: string }) => {
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
  } catch (error: any) {
    console.error('[notificationService] Failed admin notification for job pending', { error: error.message, jobId });
    return [];
  }
};

export const notifyAdminsCompanyReverifyRequired = async ({ companyId, companyName }: { companyId: string; companyName: string }) => {
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
  } catch (error: any) {
    console.error('[notificationService] Failed admin notification for company reverification', { error: error.message, companyId });
    return [];
  }
};

export const notifyAdminsNewApplication = async (
  { studentName, jobTitle, applicationId }: { studentName: string; jobTitle: string; applicationId: string }
) => {
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
          type: 'ADMIN_NEW_APPLICATION',
          title: 'New Student Application',
          message: `${studentName} applied for "${jobTitle}". Application ID: ${applicationId}.`,
          link: `/admin/applications`
        })
      )
    );
  } catch (error: any) {
    console.error('[notificationService] Failed admin notification for new application', { error: error.message, applicationId });
    return [];
  }
};

export const notifyAdminsWithdrawalRequested = async (
  { studentName, jobTitle, applicationId }: { studentName: string; jobTitle: string; applicationId: string }
) => {
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
          type: 'withdrawal_requested',
          title: 'Withdrawal Request',
          message: `${studentName} has requested to withdraw their application for "${jobTitle}". Application ID: ${applicationId}.`,
          link: `/admin/applications`
        })
      )
    );
  } catch (error: any) {
    console.error('[notificationService] Failed admin notification for withdrawal request', { error: error.message, applicationId });
    return [];
  }
};

export const notifyWithdrawalApproved = (
  studentUserId: string,
  { jobTitle, companyName }: { jobTitle: string; companyName: string }
) =>
  createNotification({
    recipientId: studentUserId,
    recipientType: 'student',
    type: 'withdrawal_approved',
    title: 'Withdrawal approved',
    message: `Your withdrawal request for "${jobTitle}" at ${companyName} has been approved.`,
    link: `/my-applications`
  });

export const notifyWithdrawalRejected = (
  studentUserId: string,
  { jobTitle, companyName }: { jobTitle: string; companyName: string }
) =>
  createNotification({
    recipientId: studentUserId,
    recipientType: 'student',
    type: 'withdrawal_rejected',
    title: 'Withdrawal rejected',
    message: `Your withdrawal request for "${jobTitle}" at ${companyName} has been rejected. Your application has been restored.`,
    link: `/my-applications`
  });

export const notifyAdminsApplicationWithdrawn = async (
  { studentName, jobTitle, applicationId }: { studentName: string; jobTitle: string; applicationId: string }
) => {
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
          type: 'APPLICATION_WITHDRAWN',
          title: 'Application Withdrawn',
          message: `${studentName} has withdrawn their application for "${jobTitle}".`,
          link: `/admin/applications`
        })
      )
    );
  } catch (error: any) {
    console.error('[notificationService] Failed admin notification for application withdrawal', { error: error.message, applicationId });
    return [];
  }
};
