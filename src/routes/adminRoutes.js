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
router.patch('/students/:studentId/status', adminController.setStudentActiveStatus);

// Company status toggle
router.patch('/companies/:companyId/status', adminController.setCompanyActiveStatus);

// Subscription plan management
router.get('/subscription-plans', adminController.getSubscriptionPlans);
router.get('/subscription-plans/:planId', adminController.getSubscriptionPlan);
router.post('/subscription-plans', adminController.createSubscriptionPlan);
router.patch('/subscription-plans/:planId', adminController.updateSubscriptionPlan);
router.delete('/subscription-plans/:planId', adminController.deleteSubscriptionPlan);

// Zone management
router.get('/zones', adminController.getZones);
router.post('/zones', adminController.createZone);
router.patch('/zones/:zoneId', adminController.updateZone);
router.delete('/zones/:zoneId', adminController.deleteZone);

// Country management within zones
router.post('/zones/:zoneId/countries', adminController.addCountryToZone);
router.delete('/zones/:zoneId/countries/:countryId', adminController.removeCountryFromZone);

// Plan zone management
router.get('/plans/:planId/zones', adminController.getPlanZones);
router.put('/plans/:planId/zones', adminController.setPlanZones);

// Free tier configuration
router.get('/config/free-tier', adminController.getFreeTierConfig);
router.patch('/config/free-tier', adminController.updateFreeTierConfig);

// Addon management
router.get('/addons', adminController.getAddons);
router.post('/addons', adminController.createAddon);
router.patch('/addons/:addonId', adminController.updateAddon);
router.delete('/addons/:addonId', adminController.deleteAddon);

module.exports = router;
