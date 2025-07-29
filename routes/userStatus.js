const express = require('express');
const router = express.Router();
const db = require('../config/db');

// GET /api/user/:id/account
router.get('/user/:id/account', async (req, res) => {
  try {
    const [stats] = await db.query(`
      SELECT 
        u.balance AS total_balance,
        u.recharged AS recharged_balance,
        u.points,
        (SELECT SUM(amount) FROM earnings WHERE user_id = u.id AND DATE(created_at) = CURDATE()) AS today_income,
        (SELECT SUM(amount) FROM team_earnings WHERE user_id = u.id) AS team_income,
        (SELECT SUM(amount) FROM earnings WHERE user_id = u.id) AS total_income,
        (u.balance + u.invested) AS total_assets,
        (SELECT SUM(amount) FROM transactions WHERE user_id = u.id AND type = 'recharge') AS total_recharge,
        (SELECT SUM(amount) FROM transactions WHERE user_id = u.id AND type = 'withdrawal') AS total_withdraw
      FROM users u
      WHERE u.id = ?
    `, [req.params.id]);

    res.json(stats[0] || {});
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch account stats' });
  }
});

module.exports = router;