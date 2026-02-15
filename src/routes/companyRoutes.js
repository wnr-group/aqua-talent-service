const express = require('express');
const router = express.Router();

const companyController = require('../controllers/companyController');
const { requireAuth, requireUserType } = require('../middleware/auth');

// All routes require authentication and company user type
router.use(requireAuth);
router.use(requireUserType('company'));

router.get('/dashboard', companyController.getDashboard);
router.get('/jobs', companyController.getJobs);
router.post('/jobs', companyController.createJob);
router.get('/jobs/:jobId', companyController.getJob);
router.patch('/jobs/:jobId', companyController.updateJob);
router.get('/jobs/:jobId/applications', companyController.getJobApplications);
router.get('/applications', companyController.getAllApplications);
router.patch('/applications/:appId', companyController.updateApplication);

module.exports = router;
