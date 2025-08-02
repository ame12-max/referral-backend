const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { authenticateUser } = require('../middleware/auth');

// Registration
router.post('/register', userController.registerUser);

// Login
router.post('/login', userController.loginUser);

// Bank endpoints
router.get('/bank', authenticateUser, userController.getBankInfo);
router.put('/bank', authenticateUser, userController.updateBankInfo);

// Team data
router.get('/team', authenticateUser, userController.getTeam);

// Account data
router.get('/account', authenticateUser, userController.getAccountData);

// Token verification
router.get('/verify', userController.verifyToken);

module.exports = router;