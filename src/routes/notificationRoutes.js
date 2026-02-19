const express = require('express');

const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { requireAuth } = require('../middleware/auth');

// All notification routes require authentication
router.use(requireAuth);

// GET /api/notifications/unread-count  — must be declared before /:id routes
router.get('/unread-count', notificationController.getUnreadCount);

// PATCH /api/notifications/read-all  — must be declared before /:id routes
router.patch('/read-all', notificationController.markAllAsRead);

// GET /api/notifications
router.get('/', notificationController.getNotifications);

// PATCH /api/notifications/:id/read
router.patch('/:id/read', notificationController.markAsRead);

module.exports = router;
