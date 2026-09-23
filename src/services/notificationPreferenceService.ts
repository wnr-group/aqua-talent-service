import { getSupabaseClient } from '../lib/supabase/client';

export const NOTIFICATION_CHANNELS = {
  EMAIL: 'email'
};

export const EMAIL_NOTIFICATION_TYPES = {
  APPLICATION_SUBMITTED: 'application_submitted',
  APPLICATION_APPROVED: 'application_approved',
  APPLICATION_REJECTED: 'application_rejected',
  APPLICATION_HIRED: 'application_hired',
  COMPANY_APPROVED: 'company_approved',
  COMPANY_REJECTED: 'company_rejected'
};

export const shouldSendEmail = async ({
  userId,
  emailType,
  channel = NOTIFICATION_CHANNELS.EMAIL
}: { userId?: string | null; emailType?: string | null; channel?: string }): Promise<boolean> => {
  if (!userId || !emailType) {
    return true;
  }

  try {
    const supabase = getSupabaseClient();
    const { data: preference } = await supabase
      .from('notification_preferences')
      .select('opted_out')
      .eq('user_id', userId)
      .eq('email_type', emailType)
      .eq('channel', channel)
      .maybeSingle();

    if (!preference) {
      return true;
    }

    return preference.opted_out !== true;
  } catch (error: any) {
    console.error('Failed to read notification preferences', { error: error.message, userId, emailType });
    return true;
  }
};
