const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { authenticateUser } = require('../middleware/auth');

// Registration
router.post('/register', userController.registerUser);

// Login
router.post('/login', userController.loginUser);

// Get bank info (protected)
router.get('/bank', authenticateUser, userController.getBankInfo);

// Get team data (protected)
router.get('/team', authenticateUser, userController.getTeam);

// Get account data (protected)
router.get('/account', authenticateUser, userController.getAccountData);

// Token verification
router.get('/verify', userController.verifyToken);

module.exports = router;