const express = require('express');
const router = express.Router();
const db = require('../config/db');
const crypto = require('crypto');
const { authenticateUser } = require('../middleware/auth'); // Your user auth middleware
const authenticateAdmin = require('../middleware/authAdmin'); // Your admin auth middleware

// ✅ Generate gift code (Admin endpoint)
router.post('/admin/generate-gift', authenticateAdmin, async (req, res) => {
  const { amount } = req.body;
  
  try {
    // Validate amount
    if (!amount || amount > 10 || amount <= 0) {
      return res.status(400).json({ error: 'Valid amount is required (0-10 Birr)' });
    }

    // Generate unique code
    const code = crypto.randomBytes(6).toString('hex').toUpperCase();
    const expiresAt = new Date(Date.now() + 30 * 60000); // 30 minutes from now

    // Save to database
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

// ✅ Redeem gift code (User endpoint)
router.post('/user/redeem-gift', authenticateUser, async (req, res) => {
  const { code } = req.body;
  const userId = req.user.id;

  try {
    if (!code) {
      return res.status(400).json({ error: 'Gift code is required' });
    }

    // Check if code exists and is valid
    const [giftCodes] = await db.query(
      'SELECT * FROM gift_codes WHERE code = ? AND is_used = FALSE AND expires_at > NOW()',
      [code]
    );

    if (giftCodes.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired gift code' });
    }

    const giftCode = giftCodes[0];
    const amount = parseFloat(giftCode.amount);

    // Start transaction
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // Mark code as used
      await connection.query(
        'UPDATE gift_codes SET is_used = TRUE, used_by = ?, used_at = NOW() WHERE id = ?',
        [userId, giftCode.id]
      );

      // Update user balance
      await connection.query(
        'UPDATE users SET balance = balance + ? WHERE id = ?',
        [amount, userId]
      );

      // Record transaction
      await connection.query(
        'INSERT INTO transactions (user_id, amount, type, status, description) VALUES (?, ?, "gift", "completed", ?)',
        [userId, amount, `Gift code redemption: ${code}`]
      );

      await connection.commit();
      res.json({ 
        success: true, 
        message: `Successfully redeemed ${amount} Birr gift code`,
        amount 
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Error redeeming gift code:', error);
    res.status(500).json({ error: 'Failed to redeem gift code' });
  }
});

module.exports = router;
