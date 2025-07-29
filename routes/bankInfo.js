
const express = require('express');
const router = express.Router();
const db = require('../config/db');

// Get bank info
router.get('/user/:id/bank', async (req, res) => {
  try {
    const userId = req.params.id;
    
    const [result] = await db.query(`
      SELECT bank_name AS bankName, account_number AS accountNumber, account_holder AS accountHolder 
      FROM bank_accounts 
      WHERE user_id = ? 
      ORDER BY is_primary DESC 
      LIMIT 1
    `, [userId]);

    res.json(result[0] || {
      bankName: '',
      accountNumber: '',
      accountHolder: ''
    });
    
  } catch (error) {
    console.error('Error fetching bank info:', error);
    res.status(500).json({ error: 'Failed to fetch bank information' });
  }
});

// Update bank info
router.put('/user/:id/bank', async (req, res) => {
  try {
    const userId = req.params.id;
    const { bankName, accountNumber, accountHolder } = req.body;

    // Check if exists
    const [existing] = await db.query(
      'SELECT id FROM bank_accounts WHERE user_id = ?',
      [userId]
    );

    if (existing.length > 0) {
      await db.query(`
        UPDATE bank_accounts 
        SET 
          bank_name = ?,
          account_number = ?,
          account_holder = ?
        WHERE user_id = ?
      `, [bankName, accountNumber, accountHolder, userId]);
    } else {
      await db.query(`
        INSERT INTO bank_accounts 
        (user_id, bank_name, account_number, account_holder, is_primary)
        VALUES (?, ?, ?, ?, 1)
      `, [userId, bankName, accountNumber, accountHolder]);
    }

    res.json({ message: 'Bank information updated successfully' });
    
  } catch (error) {
    console.error('Error updating bank info:', error);
    res.status(500).json({ error: 'Failed to update bank information' });
  }
});

module.exports = router;