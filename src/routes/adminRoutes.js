const express = require('express');
const router = express.Router();

const adminController = require('../controllers/adminController');
const { requireAuth, requireUserType } = require('../middleware/auth');

// All routes require authentication and admin user type
router.use(requireAuth);
router.use(requireUserType('admin'));

router.get('/dashboard', adminController.getDashboard);
router.get('/companies', adminController.getCompanies);
router.patch('/companies/:companyId', adminController.updateCompany);
router.get('/companies/:companyId', adminController.getCompanyProfileAdmin);
router.get('/companies/:companyId/profile', adminController.getCompanyProfileAdmin);
router.patch('/companies/:companyId/profile', adminController.updateCompanyProfileAdmin);
router.get('/jobs', adminController.getJobs);
router.get('/jobs/:jobId', adminController.getJob);
router.patch('/jobs/:jobId', adminController.updateJob);
router.get('/applications', adminController.getApplications);
router.patch('/applications/:appId', adminController.updateApplication);

// Student management
router.get('/students', adminController.getStudents);
router.get('/students/:studentId', adminController.getStudentProfile);
router.patch('/students/:studentId/subscription', adminController.assignStudentSubscription);

// Subscription plan management
router.get('/subscription-plans', adminController.getSubscriptionPlans);
router.get('/subscription-plans/:planId', adminController.getSubscriptionPlan);
router.post('/subscription-plans', adminController.createSubscriptionPlan);
router.patch('/subscription-plans/:planId', adminController.updateSubscriptionPlan);
router.delete('/subscription-plans/:planId', adminController.deleteSubscriptionPlan);

// Free tier configuration
router.get('/config/free-tier', adminController.getFreeTierConfig);
router.patch('/config/free-tier', adminController.updateFreeTierConfig);

module.exports = router;
