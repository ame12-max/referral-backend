const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');

const {
  registerUser,
  loginUser,
  saveBankInfo,
  getBankInfo,
  getTeam,
  getAccountData,
  verifyToken
} = require('../controllers/userController');

// Public routes
router.post('/register', registerUser);
router.post('/login', loginUser);
router.get('/verify-token', verifyToken); // Debug endpoint

// Protected routes (require authentication)
router.get('/account', protect, getAccountData);
router.get('/team', protect, getTeam);

// User-specific bank routes
router.post('/:id/bank', protect, saveBankInfo);
router.get('/:id/bank', protect, getBankInfo);

module.exports = router;