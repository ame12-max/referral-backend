const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticateUser } = require('../middleware/auth');

// Get user's recharge transactions
router.get('/recharges', authenticateUser, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, amount, method, status, created_at 
       FROM recharges 
       WHERE user_id = ? 
       ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.status(200).json(rows);
  } catch (err) {
    console.error('Recharges error:', err);
    res.status(500).json({ error: 'Server error fetching recharges' });
  }
});

// Get user's withdrawal transactions
router.get('/withdrawals', authenticateUser, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, amount, status, account_number, created_at 
       FROM withdrawals 
       WHERE user_id = ? 
       ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.status(200).json(rows);
  } catch (err) {
    console.error('Withdrawals error:', err);
    res.status(500).json({ error: 'Server error fetching withdrawals' });
  }
});

module.exports = router;