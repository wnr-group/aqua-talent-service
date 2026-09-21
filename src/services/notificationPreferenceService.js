"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldSendEmail = exports.EMAIL_NOTIFICATION_TYPES = exports.NOTIFICATION_CHANNELS = void 0;
const client_1 = require("../lib/supabase/client");
exports.NOTIFICATION_CHANNELS = {
    EMAIL: 'email'
};
exports.EMAIL_NOTIFICATION_TYPES = {
    APPLICATION_SUBMITTED: 'application_submitted',
    APPLICATION_APPROVED: 'application_approved',
    APPLICATION_REJECTED: 'application_rejected',
    APPLICATION_HIRED: 'application_hired',
    COMPANY_APPROVED: 'company_approved',
    COMPANY_REJECTED: 'company_rejected'
};
const shouldSendEmail = async ({ userId, emailType, channel = exports.NOTIFICATION_CHANNELS.EMAIL }) => {
    if (!userId || !emailType) {
        return true;
    }
    try {
        const supabase = (0, client_1.getSupabaseClient)();
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
    }
    catch (error) {
        console.error('Failed to read notification preferences', { error: error.message, userId, emailType });
        return true;
    }
};
exports.shouldSendEmail = shouldSendEmail;
//# sourceMappingURL=notificationPreferenceService.js.map