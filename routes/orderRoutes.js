const express = require('express');
const router = express.Router();
const db = require('../config/db');

// Get user orders
router.get('/user/:phone', async (req, res) => {
  try {
    // Clean phone number parameter
    const phone = req.params.phone.replace(/[{} ]/g, '');
    
    const [orders] = await db.query(
      `SELECT id, product_name, status, price, 
              daily_profit, validity_days, total_profit, 
              profit_collected, created_at
       FROM orders 
       WHERE user_phone = ?`,
      [phone]
    );
    
    res.json(orders);
  } catch (err) {
    console.error('Order fetch error:', err);
    res.status(500).json({ 
      error: 'Database error',
      details: err.message
    });
  }
});

// Collect profit endpoint
router.post('/collect/:orderId', async (req, res) => {
  try {
    await db.query('START TRANSACTION');

    // Get order details
    const [order] = await db.query(
      `SELECT user_id, total_profit 
       FROM orders 
       WHERE id = ? AND status = 'completed' 
         AND profit_collected = 0
       FOR UPDATE`,
      [req.params.orderId]
    );

    if (order.length === 0) {
      return res.status(400).json({ msg: 'Profit already collected or invalid order' });
    }

    const { user_id, total_profit } = order[0];

    // Update user balance
    await db.query(
      `UPDATE users 
       SET balance = balance + ? 
       WHERE id = ?`,
      [total_profit, user_id]
    );

    // Mark profit as collected
    await db.query(
      `UPDATE orders 
       SET profit_collected = 1 
       WHERE id = ?`,
      [req.params.orderId]
    );

    await db.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('Profit collection failed:', err);
    res.status(500).json({ 
      error: 'Server error',
      details: err.message
    });
  }
});

module.exports = router;