const express = require('express');
const router = express.Router();
const db = require('../config/db');

// ✅ Get user account stats
router.get('/user/:id/account', async (req, res) => {
  const userId = req.params.id;

  try {
    // Validate user ID
    if (!userId || isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    // Get user balance and points
    const [userData] = await db.query(
      'SELECT balance, points FROM users WHERE id = ?',
      [userId]
    );

    if (userData.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get today's date in YYYY-MM-DD format
    const today = new Date().toISOString().split('T')[0];
    
    // Get transaction summaries
    const [transactions] = await db.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN type = 'deposit' AND status = 'completed' THEN amount ELSE 0 END), 0) AS total_recharge,
        COALESCE(SUM(CASE WHEN type = 'withdrawal' AND status = 'completed' THEN amount ELSE 0 END), 0) AS total_withdraw,
        COALESCE(SUM(CASE WHEN type = 'interest' AND DATE(created_at) = ? THEN amount ELSE 0 END), 0) AS today_income,
        COALESCE(SUM(CASE WHEN type = 'interest' THEN amount ELSE 0 END), 0) AS total_income
      FROM transactions
      WHERE user_id = ?
    `, [today, userId]);

    // Get team earnings
    const [teamEarnings] = await db.query(
      'SELECT COALESCE(SUM(amount), 0) AS team_income FROM team_earnings WHERE user_id = ?',
      [userId]
    );

    // Get investments (assets)
    const [investments] = await db.query(
      'SELECT
  COALESCE(SUM(CASE WHEN type IN ('deposit', 'interest') AND status = 'active' THEN amount ELSE 0 END), 0)
  AS total_assets
FROM transactions
WHERE user_id = ?
',
      [userId]
    );

    res.json({
      total_balance: userData[0].balance || 0,
      recharged_balance: transactions[0].total_recharge || 0,
      points: userData[0].points || 0,
      today_income: transactions[0].today_income || 0,
      team_income: teamEarnings[0].team_income || 0,
      total_income: transactions[0].total_income || 0,
      total_assets: investments[0].total_assets || 0,
      total_recharge: transactions[0].total_recharge || 0,
      total_withdraw: transactions[0].total_withdraw || 0
    });
  } catch (error) {
    console.error('Error fetching account stats:', error);
    res.status(500).json({ 
      error: 'Failed to fetch account stats',
      message: error.message
    });
  }
});

module.exports = router;
