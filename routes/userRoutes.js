const express = require('express');
const router = express.Router();
const {
  registerUser,
  loginUser,
  saveBankInfo,
  getBankInfo,
  getTeam
} = require('../controllers/userController');

router.post('/register', registerUser);
router.post('/login', loginUser);

// ✅ Add these routes if missing:
router.post('/:id/bank', saveBankInfo);
router.get('/:id/bank', getBankInfo);

// ✅ Optional: Team route
router.get('/:id/team', getTeam);

module.exports = router;
