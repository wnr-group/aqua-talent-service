import { getSupabaseClient } from '../lib/supabase/client';
import { getApplicationLimit } from './subscriptionService';

export const getSubscriptionUsage = async (studentId: string) => {
  const supabase = getSupabaseClient();
  const { data: student } = await supabase.from('students').select('current_subscription_id').eq('id', studentId).maybeSingle();

  if (!student?.current_subscription_id) {
    return { applicationsUsed: 0, subscription: null as any };
  }

  const { data: subscription } = await supabase
    .from('active_subscriptions')
    .select('*')
    .eq('id', student.current_subscription_id)
    .maybeSingle();

  if (!subscription) {
    return { applicationsUsed: 0, subscription: null as any };
  }

  return {
    applicationsUsed: subscription.applications_used || 0,
    subscription
  };
};

export const incrementApplicationCount = async (studentId: string) => {
  const supabase = getSupabaseClient();
  const { data: student } = await supabase.from('students').select('current_subscription_id').eq('id', studentId).maybeSingle();

  if (!student?.current_subscription_id) {
    return null;
  }

  const { data: current } = await supabase
    .from('active_subscriptions')
    .select('applications_used')
    .eq('id', student.current_subscription_id)
    .maybeSingle();

  const { data: subscription } = await supabase
    .from('active_subscriptions')
    .update({ applications_used: (current?.applications_used || 0) + 1 })
    .eq('id', student.current_subscription_id)
    .select()
    .maybeSingle();

  return subscription;
};

export const decrementApplicationCount = async (studentId: string) => {
  const supabase = getSupabaseClient();
  const { data: student } = await supabase.from('students').select('current_subscription_id').eq('id', studentId).maybeSingle();

  if (!student?.current_subscription_id) {
    return null;
  }

  // Only decrement if applications_used > 0
  const { data: current } = await supabase
    .from('active_subscriptions')
    .select('applications_used')
    .eq('id', student.current_subscription_id)
    .gt('applications_used', 0)
    .maybeSingle();

  if (!current) {
    return null;
  }

  const { data: subscription } = await supabase
    .from('active_subscriptions')
    .update({ applications_used: current.applications_used - 1 })
    .eq('id', student.current_subscription_id)
    .select()
    .maybeSingle();

  return subscription;
};

export const canApply = async (studentId: string) => {
  const supabase = getSupabaseClient();
  const { data: student } = await supabase.from('students').select('*').eq('id', studentId).maybeSingle();

  if (!student) {
    return { canApply: false as const, reason: 'not_found' };
  }

  if (student.is_hired) {
    return { canApply: false as const, reason: 'hired' };
  }

  const applicationLimit = await getApplicationLimit(studentId);
  const { applicationsUsed } = await getSubscriptionUsage(studentId);

  if (student.subscription_tier === 'free') {
    const { count: submittedApplications } = await supabase
      .from('applications')
      .select('*', { count: 'exact', head: true })
      .eq('student_id', studentId);

    if ((submittedApplications ?? 0) >= applicationLimit) {
      return {
        canApply: false as const,
        reason: 'free_tier_limit',
        applicationsUsed: submittedApplications ?? 0,
        applicationLimit,
        message: 'Free tier allows only 2 job applications'
      };
    }
  }

  if (applicationLimit === Infinity) {
    return { canApply: true as const, applicationsUsed, applicationLimit: null };
  }

  if (applicationsUsed >= applicationLimit) {
    return { canApply: false as const, reason: 'limit', applicationsUsed, applicationLimit };
  }

  return { canApply: true as const, applicationsUsed, applicationLimit };
};

/**
 * Business rule: a student may request withdrawal when their application is
 * in `pending` or `reviewed` (shortlisted) state. For every other status the
 * request is denied so callers can surface a useful error without throwing.
 */
export const validateWithdrawal = (application: { status: string }) => {
  const allowedStatuses = ['pending', 'reviewed'];

  if (!allowedStatuses.includes(application.status)) {
    return {
      allowed: false,
      message: `Withdrawal request is not allowed for applications with status '${application.status}'.`
    };
  }

  return { allowed: true };
};
