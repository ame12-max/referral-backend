const express = require('express');
const router = express.Router();
const db = require('../config/db');

// Submit payment
router.post('/submit-payment', async (req, res) => {
  console.log('Submit payment request:', req.body);
  
  const { userId, productId, transactionId, amount } = req.body;

  // Validate all required fields
  if (userId === undefined || userId === null) {
    return res.status(400).json({ error: 'userId is required' });
  }
  if (productId === undefined || productId === null) {
    return res.status(400).json({ error: 'productId is required' });
  }
  if (!transactionId) {
    return res.status(400).json({ error: 'transactionId is required' });
  }
  if (amount === undefined || amount === null || isNaN(amount)) {
    return res.status(400).json({ error: 'Valid amount is required' });
  }

  try {
    const [result] = await db.query(
      'INSERT INTO payments (user_id, product_id, transaction_id, amount, status) VALUES (?, ?, ?, ?, ?)',
      [userId, productId, transactionId, amount, 'pending']
    );
    
    console.log(`Payment submitted with ID: ${result.insertId}`);
    res.json({ 
      message: 'Payment submitted, awaiting approval',
      paymentId: result.insertId
    });
  } catch (err) {
    console.error('Error saving payment:', err);
    res.status(500).json({ 
      error: 'Database error',
      details: err.message
    });
  }
});

// Update payment status
router.patch('/update-payment', async (req, res) => {
  console.log('Update payment request received:', req.body);

  if (!req.body || Object.keys(req.body).length === 0) {
    return res.status(400).json({ 
      error: 'Request body is empty',
      solution: 'Send JSON data with paymentId and status'
    });
  }

  const { paymentId, status } = req.body;

  if (paymentId === undefined || paymentId === null || isNaN(paymentId)) {
    return res.status(400).json({ 
      error: 'Valid paymentId is required',
      example: { paymentId: 1, status: "completed" }
    });
  }

  const validStatuses = ['pending', 'completed', 'failed'];
  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({ 
      error: 'Invalid status value',
      validStatuses,
      received: status
    });
  }

  try {
    console.log(`Updating payment ${paymentId} to status: ${status}`);
    
    // 1. Update payment status
    const [updateResult] = await db.query(
      'UPDATE payments SET status = ? WHERE id = ?',
      [status, paymentId]
    );

    if (updateResult.affectedRows === 0) {
      return res.status(404).json({ error: `Payment with ID ${paymentId} not found` });
    }

    // 2. Only create order for completed payments
    if (status === 'completed') {
      console.log('Creating order for completed payment');
      
      // Fetch payment + product details with real investment plan values
      const [paymentDetails] = await db.query(
        `SELECT p.user_id, u.phone, p.product_id, 
                pr.name AS product_name, 
                COALESCE(pr.image, '/default-product.png') AS product_image, 
                p.amount, pr.profit_rate, pr.validity_days
         FROM payments p
         JOIN users u ON p.user_id = u.id
         JOIN products pr ON p.product_id = pr.id
         WHERE p.id = ?`,
        [paymentId]
      );

      if (paymentDetails.length === 0) {
        return res.status(500).json({ error: 'Payment details not found', paymentId });
      }

      const payment = paymentDetails[0];

      // Clean phone
      const cleanPhone = payment.phone.replace(/[{} ]/g, '');

      // Calculate daily profit
     // Create order with product image and investment plan
const dailyProfit = (payment.amount * payment.profit_rate) / 100;
const validityDays = payment.validity_days;  // from products table
const totalProfit = dailyProfit * validityDays;

const [orderResult] = await db.query(
  `INSERT INTO orders 
   (user_id, user_phone, product_id, product_name, product_image,
    price, daily_profit, validity_days, total_profit, status)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
  [
    payment.user_id,
    cleanPhone,
    payment.product_id,
    payment.product_name,
    payment.product_image,
    payment.amount,
    dailyProfit,
    validityDays,
    totalProfit
  ]
);

      console.log(`Order created with ID: ${orderResult.insertId}`);
    }

    res.json({ 
      success: true,
      message: `Payment ${paymentId} updated to ${status}`,
      orderCreated: status === 'completed'
    });
  } catch (err) {
    console.error('Payment update failed:', err);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

// @route   POST /api/user/recharge
// @desc    Handle direct recharge request
// @access  Private (expects auth middleware if needed)
router.post('/recharge', async (req, res) => {
  try {
    const { userId, amount, method, reference, transactionId } = req.body;

    // ✅ Validate all dynamic fields
    if (!userId || !amount || !method || !reference || !transactionId) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    // ✅ Insert recharge with dynamic userId
    const [result] = await db.query(
      `INSERT INTO direct_payment 
       (user_id, amount, method, reference, transaction_id, status, created_at) 
       VALUES (?, ?, ?, ?, ?, 'pending', NOW())`,
      [userId, amount, method, reference, transactionId]
    );

    res.status(201).json({ 
      message: 'Recharge submitted successfully',
      paymentId: result.insertId 
    });

  } catch (err) {
    console.error('Recharge error:', err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});



module.exports = router;
