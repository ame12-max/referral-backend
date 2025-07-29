const express = require('express');
const router = express.Router();
const db = require('../config/db');

// ✅ Get recharge history for a user
router.get('/user/:id/recharges', async (req, res) => {
  const userId = req.params.id;

  try {
    const [rows] = await db.query(
      'SELECT * FROM recharges WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching recharges:', error);
    res.status(500).json({ error: 'Failed to fetch recharges' });
  }
});

// ✅ Get withdrawal history for a user
router.get('/user/:id/withdrawals', async (req, res) => {
  const userId = req.params.id;

  try {
    const [rows] = await db.query(
      'SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching withdrawals:', error);
    res.status(500).json({ error: 'Failed to fetch withdrawals' });
  }
});

module.exports = router;
