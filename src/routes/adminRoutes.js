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
router.get('/jobs', adminController.getJobs);
router.patch('/jobs/:jobId', adminController.updateJob);
router.get('/applications', adminController.getApplications);
router.patch('/applications/:appId', adminController.updateApplication);

module.exports = router;
