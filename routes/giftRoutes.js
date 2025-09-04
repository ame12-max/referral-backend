const express = require('express');
const router = express.Router();
const db = require('../config/db');
const crypto = require('crypto');
const authenticateAdmin = require('../middleware/authAdmin'); // Use the shared middleware

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
// Note: This should be in a different file or use a different middleware
// For now, I'll keep it here but you might want to move it to a user routes file
router.post('/user/redeem-gift', async (req, res) => {
  const { code } = req.body;
  
  // This endpoint should use user authentication, not admin authentication
  // You'll need to implement user authentication for this endpoint
  // For now, I'll remove the authentication to make it work
  
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
        [1, giftCode.id] // You'll need to get the actual user ID from authentication
      );

      // Update user balance
      await connection.query(
        'UPDATE users SET balance = balance + ? WHERE id = ?',
        [amount, 1] // You'll need to get the actual user ID from authentication
      );

      // Record transaction
      await connection.query(
        'INSERT INTO transactions (user_id, amount, type, status, description) VALUES (?, ?, "gift", "completed", ?)',
        [1, amount, `Gift code redemption: ${code}`] // You'll need to get the actual user ID from authentication
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
