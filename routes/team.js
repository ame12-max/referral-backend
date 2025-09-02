const express = require('express');
const router = express.Router();
const db = require('../config/db');

router.get('/user/:id/team', async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (!userId) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    const applyCommission = (balance, rate) =>
      balance > 300 ? parseFloat(balance) * rate : 0;

    // Level 1: directly referred by this user
    const [level1] = await db.query(
      `SELECT id, name, phone, created_at, total_balance
       FROM users
       WHERE level1_id = ?
       ORDER BY created_at DESC`,
      [userId]
    );

    const level1WithCommission = level1.map(m => ({
      ...m,
      earned: applyCommission(m.total_balance, 0.10),
      level: 1
    }));

    // Level 2: referred by level 1
    const [level2] = await db.query(
      `SELECT id, name, phone, created_at, total_balance
       FROM users
       WHERE level2_id = ?
       ORDER BY created_at DESC`,
      [userId]
    );

    const level2WithCommission = level2.map(m => ({
      ...m,
      earned: applyCommission(m.total_balance, 0.02),
      level: 2
    }));

    // Level 3: referred by level 2
    const [level3] = await db.query(
      `SELECT id, name, phone, created_at, total_balance
       FROM users
       WHERE level3_id = ?
       ORDER BY created_at DESC`,
      [userId]
    );

    const level3WithCommission = level3.map(m => ({
      ...m,
      earned: applyCommission(m.total_balance, 0.01),
      level: 3
    }));

    // Stats
    const stats = {
      totalMembers:
        level1WithCommission.length +
        level2WithCommission.length +
        level3WithCommission.length,
      level1Count: level1WithCommission.length,
      level2Count: level2WithCommission.length,
      level3Count: level3WithCommission.length,
      totalEarnings:
        level1WithCommission.reduce((s, m) => s + m.earned, 0) +
        level2WithCommission.reduce((s, m) => s + m.earned, 0) +
        level3WithCommission.reduce((s, m) => s + m.earned, 0)
    };

    res.json({
      success: true,
      members: [
        ...level1WithCommission,
        ...level2WithCommission,
        ...level3WithCommission
      ],
      ...stats
    });
  } catch (error) {
    console.error('Error fetching team data:', error);
    res.status(500).json({
      error: 'Failed to fetch team data',
      details: error.message
    });
  }
});


module.exports = router;
