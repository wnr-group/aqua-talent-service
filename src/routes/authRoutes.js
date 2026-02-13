const express = require('express');
const router = express.Router();

const authController = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');


console.log(authController);

router.post('/login', authController.login);
router.post('/logout', authController.logout);
router.get('/me', requireAuth, authController.getMe);
router.post('/register/company', authController.registerCompany);
router.post('/register/student', authController.registerStudent);


exports.login = async (req, res) => {
   
};

exports.logout = async (req, res) => {
   res.json({ success: true, message: 'Logged out successfully' });
};

exports.getMe = async (req, res) => {
   
};



module.exports = router;
