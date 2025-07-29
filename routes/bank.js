const express = require('express');
const router = express.Router();
const db = require('../config/db');

// GET bank info
router.get('/user/:id/bank', async (req, res) => {
  try {
    const userId = req.params.id;
    
    // Validate user ID
    if (!userId || isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }

    const [result] = await db.query(
      'SELECT bank_name, account_holder, account_number FROM bank_accounts WHERE user_id = ?',
      [userId]
    );

    res.json(result[0] || null);
  } catch (error) {
    console.error('Error fetching bank info:', error);
    res.status(500).json({ 
      error: 'Failed to fetch bank information',
      message: error.message
    });
  }
});

// Create or Update bank info
router.post('/user/:id/bank', async (req, res) => {
  try {
    const userId = req.params.id;
    const { bank, name, number } = req.body;
    
    // Validate input
    if (!bank || !name || !number) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    
    if (number.length < 6) {
      return res.status(400).json({ error: 'Account number must be at least 6 digits' });
    }

    // Check if bank info exists
    const [existing] = await db.query(
      'SELECT id FROM bank_accounts WHERE user_id = ?',
      [userId]
    );

    if (existing.length > 0) {
      // Update existing
      await db.query(
        `UPDATE bank_accounts SET 
          bank_name = ?,
          account_holder = ?,
          account_number = ?,
          updated_at = NOW()
        WHERE user_id = ?`,
        [bank, name, number, userId]
      );
    } else {
      // Create new
      await db.query(
        `INSERT INTO bank_accounts 
        (user_id, bank_name, account_holder, account_number)
        VALUES (?, ?, ?, ?)`,
        [userId, bank, name, number]
      );
    }

    // Return updated bank info
    const [updated] = await db.query(
      'SELECT bank_name, account_holder, account_number FROM bank_accounts WHERE user_id = ?',
      [userId]
    );

    res.json(updated[0]);
  } catch (error) {
    console.error('Error saving bank info:', error);
    res.status(500).json({ 
      error: 'Failed to save bank information',
      message: error.message
    });
  }
});

module.exports = router;