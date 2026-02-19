const Notification = require('../models/Notification');

const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;

/**
 * GET /api/notifications
 * Returns paginated notifications for the authenticated user.
 * Query params: page (default 1), limit (default 20), unread (true/false)
 */
exports.getNotifications = async (req, res) => {
  try {
    const { page = 1, limit = DEFAULT_PAGE_SIZE, unread } = req.query;

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(limit) || DEFAULT_PAGE_SIZE));
    const skip = (pageNum - 1) * limitNum;

    const filter = { recipientId: req.user.userId };

    if (unread === 'true') {
      filter.isRead = false;
    } else if (unread === 'false') {
      filter.isRead = true;
    }

    const [notifications, total] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Notification.countDocuments(filter)
    ]);

    return res.json({
      notifications,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
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
exports.getUnreadCount = async (req, res) => {
  try {
    const count = await Notification.countDocuments({
      recipientId: req.user.userId,
      isRead: false
    });

    return res.json({ count });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * PATCH /api/notifications/:id/read
 * Marks a single notification as read.
 */
exports.markAsRead = async (req, res) => {
  try {
    const { id } = req.params;

    const notification = await Notification.findOneAndUpdate(
      { _id: id, recipientId: req.user.userId },
      { $set: { isRead: true } },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    return res.json(notification);
  } catch (error) {
    if (error.name === 'CastError') {
      return res.status(400).json({ error: 'Invalid notification ID' });
    }
    console.error(error);
    return res.status(500).json({ error: 'Server error' });
  }
};

/**
 * PATCH /api/notifications/read-all
 * Marks all unread notifications as read for the authenticated user.
 */
exports.markAllAsRead = async (req, res) => {
  try {
    const result = await Notification.updateMany(
      { recipientId: req.user.userId, isRead: false },
      { $set: { isRead: true } }
    );

    return res.json({ updated: result.modifiedCount });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Server error' });
  }
};
