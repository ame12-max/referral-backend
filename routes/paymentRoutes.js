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

  // Validate request exists
  if (!req.body || Object.keys(req.body).length === 0) {
    return res.status(400).json({ 
      error: 'Request body is empty',
      solution: 'Send JSON data with paymentId and status'
    });
  }

  const { paymentId, status } = req.body;

  // Validate paymentId
  if (paymentId === undefined || paymentId === null || isNaN(paymentId)) {
    return res.status(400).json({ 
      error: 'Valid paymentId is required',
      example: { paymentId: 1, status: "completed" }
    });
  }

  // Validate status
  if (!status) {
    return res.status(400).json({ 
      error: 'status is required',
      validStatuses: ['pending', 'completed', 'failed']
    });
  }

  // Validate status value
  const validStatuses = ['pending', 'completed', 'failed'];
  if (!validStatuses.includes(status)) {
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

    // Check if payment was found
    if (updateResult.affectedRows === 0) {
      console.warn(`Payment not found: ${paymentId}`);
      return res.status(404).json({ 
        error: `Payment with ID ${paymentId} not found`
      });
    }

    console.log(`Payment ${paymentId} updated to ${status}`);

    // 2. Only create order for completed payments
    if (status === 'completed') {
      console.log('Creating order for completed payment');
      
      // Get payment details
      const [paymentDetails] = await db.query(
        `SELECT p.user_id, u.phone, p.product_id, pr.name AS product_name, 
                p.amount, pr.returns
         FROM payments p
         JOIN users u ON p.user_id = u.id
         JOIN products pr ON p.product_id = pr.id
         WHERE p.id = ?`,
        [paymentId]
      );

      if (paymentDetails.length === 0) {
        console.error(`Payment details not found for ID: ${paymentId}`);
        return res.status(500).json({
          error: 'Payment details not found after update',
          paymentId
        });
      }

      const payment = paymentDetails[0];
      console.log('Payment details:', payment);

      // Clean phone number
      const cleanPhone = payment.phone.replace(/[{} ]/g, '');
      console.log('Cleaned phone:', cleanPhone);

      // Parse returns string with multiple format support
      const returns = payment.returns.toLowerCase();
      let dailyProfitPercent, validityDays;

      // Try to match "X% profit / Yhr" format (e.g. "18% profit / 24hr")
      const newFormatMatch = returns.match(/(\d+)%\s*profit\s*\/\s*(\d+)\s*hr/);
      
      // Try to match "X% daily for Y days" format (e.g. "5% daily for 30 days")
      const oldFormatMatch = returns.match(/(\d+)%\s*daily\s*for\s*(\d+)\s*days/);
      
      // Try to match "X% for Y days" format (fallback)
      const simpleFormatMatch = returns.match(/(\d+)%\s*for\s*(\d+)\s*days/);

      if (newFormatMatch) {
        // Format: "X% profit / Y hr"
        dailyProfitPercent = parseFloat(newFormatMatch[1]);
        const hours = parseInt(newFormatMatch[2]);
        validityDays = hours / 24;  // Convert hours to days
      } else if (oldFormatMatch) {
        // Format: "X% daily for Y days"
        dailyProfitPercent = parseFloat(oldFormatMatch[1]);
        validityDays = parseInt(oldFormatMatch[2]);
      } else if (simpleFormatMatch) {
        // Format: "X% for Y days"
        dailyProfitPercent = parseFloat(simpleFormatMatch[1]);
        validityDays = parseInt(simpleFormatMatch[2]);
      } else {
        console.error('Invalid returns format:', payment.returns);
        return res.status(400).json({
          error: 'Invalid returns format',
          expectedFormats: [
            'X% profit / Yhr (e.g., 18% profit / 24hr)',
            'X% daily for Y days (e.g., 5% daily for 30 days)',
            'X% for Y days (e.g., 10% for 7 days)'
          ],
          received: payment.returns
        });
      }

      console.log('Parsed returns:', { dailyProfitPercent, validityDays });

      // Calculate daily profit
      const dailyProfit = (payment.amount * dailyProfitPercent) / 100;
      console.log('Calculated daily profit:', dailyProfit);

      // Create order
      const [orderResult] = await db.query(
        `INSERT INTO orders 
        (user_id, user_phone, product_id, product_name, 
         price, daily_profit, validity_days, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [
          payment.user_id,
          cleanPhone,
          payment.product_id,
          payment.product_name,
          payment.amount,
          dailyProfit,
          validityDays
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
    res.status(500).json({ 
      error: 'Server error',
      details: err.message
    });
  }
});

module.exports = router;