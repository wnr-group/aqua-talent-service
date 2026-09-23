import { Request, Response } from 'express';

import { getSupabaseClient } from '../lib/supabase/client';

type AuthedRequest = Request & { user?: { userId: string; userType: string } };

const supabase = getSupabaseClient();

const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isValidUuid = (value: any): boolean => typeof value === 'string' && UUID_RE.test(value);

/**
 * GET /api/notifications
 * Returns paginated notifications for the authenticated user.
 * Query params: page (default 1), limit (default 20), unread (true/false)
 */
exports.getNotifications = async (req: AuthedRequest, res: Response) => {
  try {
    const { page = 1, limit = DEFAULT_PAGE_SIZE, unread } = req.query as Record<string, any>;

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(limit) || DEFAULT_PAGE_SIZE));
    const from = (pageNum - 1) * limitNum;
    const to = from + limitNum - 1;

    let query = supabase.from('notifications').select('*', { count: 'exact' }).eq('recipient_id', req.user!.userId);

    if (unread === 'true') {
      query = query.eq('is_read', false);
    } else if (unread === 'false') {
      query = query.eq('is_read', true);
    }

    const { data: notifications, count, error } = await query.order('created_at', { ascending: false }).range(from, to);
    if (error) throw error;

    return res.json({
      notifications: notifications || [],
      pagination: { page: pageNum, limit: limitNum, total: count ?? 0, totalPages: Math.ceil((count ?? 0) / limitNum) }
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * GET /api/notifications/unread-count
 * Returns the number of unread notifications for the authenticated user.
 */
exports.getUnreadCount = async (req: AuthedRequest, res: Response) => {
  try {
    const { count } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('recipient_id', req.user!.userId)
      .eq('is_read', false);

    return res.json({ count: count ?? 0 });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * PATCH /api/notifications/:id/read
 * Marks a single notification as read.
 */
exports.markAsRead = async (req: AuthedRequest, res: Response) => {
  try {
    const { id } = req.params as { id: string };

    if (!isValidUuid(id)) {
      return res.status(400).json({ error: 'Invalid notification ID' });
    }

    const { data: notification, error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', id)
      .eq('recipient_id', req.user!.userId)
      .select()
      .maybeSingle();
    if (error) throw error;

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    return res.json(notification);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * PATCH /api/notifications/read-all
 * Marks all unread notifications as read for the authenticated user.
 */
exports.markAllAsRead = async (req: AuthedRequest, res: Response) => {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('recipient_id', req.user!.userId)
      .eq('is_read', false)
      .select('id');
    if (error) throw error;

    return res.json({ updated: (data || []).length });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Server error' });
  }
};
