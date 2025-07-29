const express = require('express');
const router = express.Router();
const db = require('../config/db');

// Save payment info
router.post('/submit-payment', async (req, res) => {
  const { userId, productId, transactionId, amount } = req.body;

  if (!userId || !productId || !transactionId || !amount) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    await db.query(
      'INSERT INTO payments (user_id, product_id, transaction_id, amount, status) VALUES (?, ?, ?, ?, ?)',
      [userId, productId, transactionId, amount, 'pending']
    );
    res.json({ message: 'Payment submitted, awaiting approval' });
  } catch (err) {
    console.error('Error saving payment:', err);
    res.status(500).json({ error: 'Database error' });
  }
});


module.exports = router;