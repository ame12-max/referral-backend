const express = require('express');
const router = express.Router();
const db = require('../config/db');

router.get('/user/:id/team', async (req, res) => {
  try {
    const userId = req.params.id;
    
    // Validate user ID
    if (!userId || isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    // Level 1: Direct referrals
    const [level1] = await db.query(
      `SELECT u.id, u.name, u.phone, u.created_at AS joined_date,
        COALESCE(SUM(e.amount), 0) AS earned
       FROM users u
       LEFT JOIN earnings e ON e.user_id = u.id AND e.type = 'level1'
       WHERE u.referred_by = ?
       GROUP BY u.id
       ORDER BY u.created_at DESC`,
      [userId]
    );

    // Level 2: Indirect referrals (user's referrals' referrals)
    const [level2] = await db.query(
      `SELECT u.id, u.name, u.phone, u.created_at AS joined_date,
        COALESCE(SUM(e.amount), 0) AS earned
       FROM users u
       JOIN users u1 ON u.referred_by = u1.id
       LEFT JOIN earnings e ON e.user_id = u.id AND e.type = 'level2'
       WHERE u1.referred_by = ?
       GROUP BY u.id
       ORDER BY u.created_at DESC`,
      [userId]
    );

    // Level 3: Further indirect referrals
    const [level3] = await db.query(
      `SELECT u.id, u.name, u.phone, u.created_at AS joined_date,
        COALESCE(SUM(e.amount), 0) AS earned
       FROM users u
       JOIN users u1 ON u.referred_by = u1.id
       JOIN users u2 ON u1.referred_by = u2.id
       LEFT JOIN earnings e ON e.user_id = u.id AND e.type = 'level3'
       WHERE u2.referred_by = ?
       GROUP BY u.id
       ORDER BY u.created_at DESC`,
      [userId]
    );

    // Calculate team statistics
    const stats = {
      totalMembers: level1.length + level2.length + level3.length,
      level1Count: level1.length,
      level2Count: level2.length,
      level3Count: level3.length,
      totalEarnings: 
        level1.reduce((sum, m) => sum + m.earned, 0) +
        level2.reduce((sum, m) => sum + m.earned, 0) +
        level3.reduce((sum, m) => sum + m.earned, 0)
    };

    res.json({
      members: [...level1, ...level2, ...level3],
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