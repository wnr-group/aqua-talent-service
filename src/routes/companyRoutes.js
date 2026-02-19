const express = require('express');
const router = express.Router();

const companyController = require('../controllers/companyController');
const { requireAuth, requireUserType } = require('../middleware/auth');
const { upload } = require('../middleware/upload');

// All routes require authentication and company user type
router.use(requireAuth);
router.use(requireUserType('company'));

const logoUploadMiddleware = (req, res, next) => {
	upload.single('logo')(req, res, (err) => {
		if (err) {
			return res.status(400).json({ error: err.message });
		}
		next();
	});
};

router.get('/profile', companyController.getProfile);
router.patch('/profile', companyController.updateProfile);
router.post('/profile/logo', logoUploadMiddleware, companyController.uploadLogo);

router.get('/dashboard', companyController.getDashboard);
router.get('/jobs', companyController.getJobs);
router.post('/jobs', companyController.createJob);
router.get('/jobs/:jobId', companyController.getJob);
router.patch('/jobs/:jobId', companyController.updateJob);
router.get('/jobs/:jobId/applications', companyController.getJobApplications);
router.get('/applications', companyController.getAllApplications);
router.patch('/applications/:appId', companyController.updateApplication);

module.exports = router;
