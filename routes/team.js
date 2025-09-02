const express = require('express');
const router = express.Router();
const db = require('../config/db');

// Function to calculate commissions based on your schema
async function calculateCommissions(userId, amount) {
  try {
    // Get user's referral chain using the level fields from your schema
    const [user] = await db.query(
      `SELECT level1_id, level2_id, level3_id FROM users WHERE id = ?`,
      [userId]
    );
    
    if (!user.length) return;
    
    const { level1_id, level2_id, level3_id } = user[0];
    
    // Calculate and distribute commissions
    const commissions = [
      { userId: level1_id, percentage: 0.10, level: 1 },
      { userId: level2_id, percentage: 0.02, level: 2 },
      { userId: level3_id, percentage: 0.01, level: 3 }
    ];

    for (const commission of commissions) {
      if (commission.userId) {
        const commissionAmount = amount * commission.percentage;
        
        // Add commission to referrer's total_balance
        await db.query(
          `UPDATE users 
           SET total_balance = total_balance + ?,
               withdrawable_balance = withdrawable_balance + ?,
               today_income = today_income + ?,
               total_assets = total_assets + ?
           WHERE id = ?`,
          [commissionAmount, commissionAmount, commissionAmount, commissionAmount, commission.userId]
        );
        
        // Record the commission transaction
        await db.query(
          `INSERT INTO earnings (user_id, amount, type, description) 
           VALUES (?, ?, 'commission', ?)`,
          [commission.userId, commissionAmount, `Level ${commission.level} commission from user ${userId}`]
        );
      }
    }
  } catch (error) {
    console.error('Error calculating commissions:', error);
  }
}

// Add this endpoint to handle balance updates and commission calculations
router.post('/user/update-balance', async (req, res) => {
  try {
    const { userId, amount } = req.body;
    
    // Update user balance
    await db.query(
      `UPDATE users 
       SET total_balance = total_balance + ?,
           total_assets = total_assets + ?
       WHERE id = ?`,
      [amount, amount, userId]
    );
    
    // Check if balance now exceeds 300 and commissions haven't been paid yet
    const [user] = await db.query(
      `SELECT total_balance, commissions_paid FROM users WHERE id = ?`,
      [userId]
    );
    
    if (user.length && user[0].total_balance >= 300 && !user[0].commissions_paid) {
      // Calculate and distribute commissions
      await calculateCommissions(userId, user[0].total_balance);
      
      // Mark commissions as paid for this user
      await db.query(
        `UPDATE users SET commissions_paid = 1 WHERE id = ?`,
        [userId]
      );
    }
    
    res.json({ success: true, message: 'Balance updated successfully' });
  } catch (error) {
    console.error('Error updating balance:', error);
    res.status(500).json({ error: 'Failed to update balance' });
  }
});

// Your existing team route with adjustments for your schema
router.get('/user/:id/team', async (req, res) => {
  try {
    const userId = req.params.id;
    
    // Validate user ID
    if (!userId || isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    // Level 1: Direct referrals (using invited_by field)
    const [level1] = await db.query(
      `SELECT u.id, u.name, u.phone, u.created_at AS joined_date,
        u.total_balance, u.commissions_paid,
        COALESCE(SUM(e.amount), 0) AS earned
       FROM users u
       LEFT JOIN earnings e ON e.user_id = u.id AND e.type = 'level1'
       WHERE u.invited_by = (SELECT invite_code FROM users WHERE id = ?)
       GROUP BY u.id
       ORDER BY u.created_at DESC`,
      [userId]
    );

    // Level 2: Indirect referrals
    const [level2] = await db.query(
      `SELECT u.id, u.name, u.phone, u.created_at AS joined_date,
        u.total_balance, u.commissions_paid,
        COALESCE(SUM(e.amount), 0) AS earned
       FROM users u
       JOIN users u1 ON u.invited_by = u1.invite_code
       LEFT JOIN earnings e ON e.user_id = u.id AND e.type = 'level2'
       WHERE u1.invited_by = (SELECT invite_code FROM users WHERE id = ?)
       GROUP BY u.id
       ORDER BY u.created_at DESC`,
      [userId]
    );

    // Level 3: Further indirect referrals
    const [level3] = await db.query(
      `SELECT u.id, u.name, u.phone, u.created_at AS joined_date,
        u.total_balance, u.commissions_paid,
        COALESCE(SUM(e.amount), 0) AS earned
       FROM users u
       JOIN users u1 ON u.invited_by = u1.invite_code
       JOIN users u2 ON u1.invited_by = u2.invite_code
       LEFT JOIN earnings e ON e.user_id = u.id AND e.type = 'level3'
       WHERE u2.invited_by = (SELECT invite_code FROM users WHERE id = ?)
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
