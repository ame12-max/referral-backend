const express = require('express');
const router = express.Router();
const db = require('../config/db');
const crypto = require('crypto');
const { authenticateUser } = require('../middleware/auth');
const authenticateAdmin = require('../middleware/adminAuth');

// ✅ Generate gift code (Admin endpoint) - Fixed without max_uses
router.post('/admin/generate-gift', authenticateAdmin, async (req, res) => {
  const { amount } = req.body;
  
  try {
    // Validate amount
    if (!amount || amount > 10 || amount <= 0) {
      return res.status(400).json({ error: 'Valid amount is required (0-10 Birr)' });
    }

    // Generate unique code
    const code = crypto.randomBytes(6).toString('hex').toUpperCase();
    const expiresAt = new Date(Date.now() + 10 * 60000); // 30 minutes from now

    // Save to database without max_uses column
    await db.query(
      'INSERT INTO gift_codes (code, amount, expires_at) VALUES (?, ?, ?)',
      [code, amount, expiresAt]
    );

    res.json({ 
      success: true, 
      message: 'Gift code generated successfully',
      code,
      amount,
      expires_at: expiresAt
    });
  } catch (error) {
    console.error('Error generating gift code:', error);
    res.status(500).json({ error: 'Failed to generate gift code' });
  }
});

// ✅ Redeem gift code (User endpoint) - Updated for multiple redemptions
router.post('/user/redeem-gift', authenticateUser, async (req, res) => {
  const { code } = req.body;
  const userId = req.user.id;

  try {
    if (!code) {
      return res.status(400).json({ error: 'Gift code is required' });
    }

    // Check if code exists and is not expired
    const [giftCodes] = await db.query(
      'SELECT * FROM gift_codes WHERE code = ? AND expires_at > NOW()',
      [code]
    );

    if (giftCodes.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired gift code' });
    }

    const giftCode = giftCodes[0];
    const amount = parseFloat(giftCode.amount);

    // Verify user exists
    const [users] = await db.query('SELECT id FROM users WHERE id = ?', [userId]);
    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if user has already redeemed this code
    const [existingRedemptions] = await db.query(
      'SELECT * FROM gift_code_redemptions WHERE code_id = ? AND user_id = ?',
      [giftCode.id, userId]
    );

    if (existingRedemptions.length > 0) {
      return res.status(400).json({ error: 'You have already redeemed this gift code' });
    }

    // Start transaction
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // Record the redemption
      await connection.query(
        'INSERT INTO gift_code_redemptions (code_id, user_id) VALUES (?, ?)',
        [giftCode.id, userId]
      );

      // Update user balance
      await connection.query(
        'UPDATE users SET total_balance = total_balance + ? WHERE id = ?',
        [amount, userId]
      );

      // Try to record transaction (if transactions table exists)
      try {
        await connection.query(
          'INSERT INTO transactions (user_id, amount, type, status, description) VALUES (?, ?, "gift", "completed", ?)',
          [userId, amount, `Gift code redemption: ${code}`]
        );
      } catch (transactionError) {
        console.warn('Could not record transaction (table might not exist):', transactionError.message);
        // Continue without recording the transaction
      }

      await connection.commit();
      res.json({ 
        success: true, 
        message: `Successfully redeemed ${amount} Birr gift code`,
        amount 
      });
    } catch (error) {
      await connection.rollback();
      console.error('Transaction error:', error);
      
      // Handle foreign key constraint error specifically
      if (error.code === 'ER_NO_REFERENCED_ROW_2' || error.code === 'ER_NO_REFERENCED_ROW') {
        return res.status(400).json({ error: 'Invalid user account' });
      }
      
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Error redeeming gift code:', error);
    res.status(500).json({ error: 'Failed to redeem gift code' });
  }
});

// ✅ Get gift code statistics (Admin endpoint)
router.get('/admin/gift-codes', authenticateAdmin, async (req, res) => {
  try {
    const [codes] = await db.query(`
      SELECT gc.*, COUNT(gcr.id) as redemption_count 
      FROM gift_codes gc 
      LEFT JOIN gift_code_redemptions gcr ON gc.id = gcr.code_id 
      GROUP BY gc.id
      ORDER BY gc.created_at DESC
    `);
    
    res.json(codes);
  } catch (error) {
    console.error('Error fetching gift codes:', error);
    res.status(500).json({ error: 'Failed to fetch gift codes' });
  }
});

// ✅ Get gift code redemption details (Admin endpoint)
router.get('/admin/gift-codes/:codeId/redemptions', authenticateAdmin, async (req, res) => {
  try {
    const { codeId } = req.params;
    
    const [redemptions] = await db.query(`
      SELECT gcr.*, u.phone, u.name 
      FROM gift_code_redemptions gcr 
      JOIN users u ON gcr.user_id = u.id 
      WHERE gcr.code_id = ?
      ORDER BY gcr.redeemed_at DESC
    `, [codeId]);
    
    res.json(redemptions);
  } catch (error) {
    console.error('Error fetching gift code redemptions:', error);
    res.status(500).json({ error: 'Failed to fetch gift code redemptions' });
  }
});

module.exports = router;
