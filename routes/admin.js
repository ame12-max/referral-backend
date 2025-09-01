const express = require('express');
const router = express.Router();
const db = require('../config/db');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

// Admin login endpoint
router.post('/login', async (req, res) => {
  const { phone, password } = req.body;
  
  try {
    const [admin] = await db.query(
      'SELECT * FROM admins WHERE phone = ?',
      [phone]
    );
    
    if (admin.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const adminData = admin[0];
    const isMatch = await bcrypt.compare(password, adminData.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = jwt.sign(
      { 
        id: adminData.id,
        role: adminData.role,
        name: adminData.name,
        phone: adminData.phone
      },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    
    res.json({ 
      success: true, 
      token,
      admin: {
        id: adminData.id,
        name: adminData.name,
        phone: adminData.phone,
        role: adminData.role
      }
    });
  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});

// Middleware to verify admin token
const authenticateAdmin = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Get admin details
router.get('/me', authenticateAdmin, (req, res) => {
  res.json({
    id: req.admin.id,
    name: req.admin.name,
    phone: req.admin.phone,
    role: req.admin.role
  });
});

// Get pending withdrawals
router.get('/withdrawals/pending', authenticateAdmin, async (req, res) => {
  try {
    const [withdrawals] = await db.query(`
      SELECT w.id, w.amount, w.account_number, w.bank_name, COALESCE(w.fee, 0) AS fee, w.status, w.created_at,
             u.id AS user_id, u.name AS user_name, u.phone AS user_phone
      FROM withdrawals w
      JOIN users u ON w.user_id = u.id
      WHERE w.status = 'pending'
    `);
    
    res.json(withdrawals);
  } catch (err) {
    console.error('Error fetching pending withdrawals:', err);
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

// Approve withdrawal
router.patch('/withdrawals/:id/approve', authenticateAdmin, async (req, res) => {
  try {
    await db.query(
      "UPDATE withdrawals SET status = 'approved' WHERE id = ?",
      [req.params.id]
    );
    
    res.json({ success: true });
  } catch (err) {
    console.error('Error approving withdrawal:', err);
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

// Reject withdrawal (FIXED)
router.patch('/withdrawals/:id/reject', authenticateAdmin, async (req, res) => {
  try {
    const [withdrawal] = await db.query(
      "SELECT user_id, amount, COALESCE(fee, 0) AS fee FROM withdrawals WHERE id = ?",
      [req.params.id]
    );
    
    if (withdrawal.length === 0) {
      return res.status(404).json({ error: 'Withdrawal not found' });
    }
    
    const { user_id, amount, fee } = withdrawal[0];
    
    // Convert to numbers to avoid string concatenation
    const amountNum = parseFloat(amount);
    const feeNum = parseFloat(fee);
    const totalAmount = amountNum + feeNum;
    
    await db.query('START TRANSACTION');
    
    // Return funds to user
    await db.query(
      "UPDATE users SET total_balance = total_balance + ? WHERE id = ?",
      [totalAmount, user_id]
    );
    
    // Update status to rejected
    await db.query(
      "UPDATE withdrawals SET status = 'rejected' WHERE id = ?",
      [req.params.id]
    );
    
    await db.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('Error rejecting withdrawal:', err);
    res.status(500).json({ 
      error: 'Database error',
      details: err.message,
      sql: err.sql,
      stack: err.stack
    });
  }
});

// Get pending recharges
router.get('/recharges/pending', authenticateAdmin, async (req, res) => {
  try {
    const [recharges] = await db.query(`
      SELECT dp.id, dp.amount, dp.method, dp.reference, dp.transaction_id, dp.created_at,
             u.id AS user_id, u.name AS user_name, u.phone AS user_phone
      FROM direct_payment dp
      JOIN users u ON dp.user_id = u.id
      WHERE dp.status = 'pending'
    `);
    
    res.json(recharges);
  } catch (err) {
    console.error('Error fetching pending recharges:', err);
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

// Approve recharge
router.patch('/recharges/:id/approve', authenticateAdmin, async (req, res) => {
  try {
    await db.query('START TRANSACTION');
    
    // Get recharge details first
    const [recharge] = await db.query(
      'SELECT user_id, amount FROM direct_payment WHERE id = ?',
      [req.params.id]
    );
    
    if (recharge.length === 0) {
      await db.query('ROLLBACK');
      return res.status(404).json({ error: 'Recharge not found' });
    }
    
    // Convert amount to number
    const amountNum = parseFloat(recharge[0].amount);
    
    // Update recharge status
    await db.query(
      'UPDATE direct_payment SET status = "completed" WHERE id = ?',
      [req.params.id]
    );
    
    // Update user balance
    await db.query(
      'UPDATE users SET total_balance = total_balance + ? WHERE id = ?',
      [amountNum, recharge[0].user_id]
    );
    
    await db.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('Error approving recharge:', err);
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

// PATCH /api/admin/recharges/:id/reject
router.patch('/recharges/:id/reject', authenticateAdmin, async (req, res) => {
  try {
    const [recharge] = await db.query(
      'SELECT * FROM direct_payment WHERE id = ? AND status = "pending"',
      [req.params.id]
    );

    if (recharge.length === 0) {
      return res.status(404).json({ error: 'Pending recharge not found' });
    }

    await db.query(
      'UPDATE direct_payment SET status = "failed" WHERE id = ?',
      [req.params.id]
    );

    res.json({ success: true, message: 'Recharge rejected' });
  } catch (err) {
    console.error('Error rejecting recharge:', err);
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

// Get pending payments
router.patch('/payments/:id', authenticateAdmin, async (req, res) => {
  const paymentId = req.params.id;
  const { status } = req.body;

  if (!status) {
    return res.status(400).json({
      error: 'Status is required',
    });
  }

  const validStatuses = ['pending', 'completed', 'failed'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({
      error: 'Invalid status value',
      validStatuses,
    });
  }

  try {
    // 1. Update payment status
    const [updateResult] = await db.query(
      'UPDATE payments SET status = ? WHERE id = ?',
      [status, paymentId]
    );

    if (updateResult.affectedRows === 0) {
      return res.status(404).json({
        error: `Payment with ID ${paymentId} not found`,
      });
    }

    // 2. If status is 'completed', insert into orders table
    if (status === 'completed') {
      const [paymentDetails] = await db.query(
        `SELECT p.user_id, u.phone, p.product_id, pr.name AS product_name, 
                COALESCE(pr.image, '/default-product.png') AS product_image, 
                p.amount, pr.returns
         FROM payments p
         JOIN users u ON p.user_id = u.id
         JOIN products pr ON p.product_id = pr.id
         WHERE p.id = ?`,
        [paymentId]
      );

      if (paymentDetails.length === 0) {
        return res.status(500).json({
          error: 'Payment details not found',
        });
      }

     const payment = paymentDetails[0];
const cleanPhone = payment.phone.replace(/[{} ]/g, '');

// Parse returns string
const returns = payment.returns.toLowerCase();
let dailyProfitPercent, validityDays;

const newFormatMatch = returns.match(/(\d+)%\s*profit\s*\/\s*(\d+)\s*hr/);
const oldFormatMatch = returns.match(/(\d+)%\s*daily\s*for\s*(\d+)\s*days/);
const simpleFormatMatch = returns.match(/(\d+)%\s*for\s*(\d+)\s*days/);
const monthlyFormatMatch = returns.match(/(\d+)%\s*monthly/);

if (newFormatMatch) {
  dailyProfitPercent = parseFloat(newFormatMatch[1]);
  const hours = parseInt(newFormatMatch[2]);
  validityDays = hours / 24;
} else if (oldFormatMatch) {
  dailyProfitPercent = parseFloat(oldFormatMatch[1]);
  validityDays = parseInt(oldFormatMatch[2]);
} else if (simpleFormatMatch) {
  dailyProfitPercent = parseFloat(simpleFormatMatch[1]);
  validityDays = parseInt(simpleFormatMatch[2]);
} else if (monthlyFormatMatch) {
  dailyProfitPercent = parseFloat(monthlyFormatMatch[1]);
  validityDays = 30; // Assume 1 month = 30 days
} else {
  return res.status(400).json({
    error: 'Invalid returns format',
  });
}

const dailyProfit = (payment.amount * dailyProfitPercent) / 100;

      const [orderResult] = await db.query(
        `INSERT INTO orders 
         (user_id, user_phone, product_id, product_name, product_image,
          price, daily_profit, validity_days, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [
          payment.user_id,
          cleanPhone,
          payment.product_id,
          payment.product_name,
          payment.product_image,
          payment.amount,
          dailyProfit,
          validityDays
        ]
      );

      return res.json({
        success: true,
        message: `Payment ${paymentId} marked as completed`,
        orderCreated: true,
        orderId: orderResult.insertId
      });
    }

    res.json({
      success: true,
      message: `Payment ${paymentId} updated to ${status}`,
    });

  } catch (err) {
    console.error('Error updating payment and creating order:', err);
    res.status(500).json({
      error: 'Server error',
      details: err.message,
    });
  }
});

router.get('/payments/pending', authenticateAdmin, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT p.id, p.amount, p.transaction_id, p.status, p.created_date,
             u.name AS user_name, u.phone AS user_phone
      FROM payments p
      JOIN users u ON p.user_id = u.id
      WHERE p.status = 'pending'
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch pending payments', details: err.message });
  }
});



// Update payment status
router.patch('/payments/:id', authenticateAdmin, async (req, res) => {
  const { status } = req.body;
  
  try {
    await db.query(
      'UPDATE payments SET status = ? WHERE id = ?',
      [status, req.params.id]
    );
    
    res.json({ success: true });
  } catch (err) {
    console.error('Error updating payment:', err);
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});

router.get('/orders', async (req, res) => {
  const { status } = req.query;

  try {
    let query = 'SELECT * FROM orders';
    const params = [];

    if (status) {
      query += ' WHERE status = ?';
      params.push(status);
    }

    const [orders] = await db.query(query, params);
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// PATCH /api/admin/orders/:id/approve
router.patch('/orders/:id/approve', async (req, res) => {
  const orderId = req.params.id;

  try {
    // Update the order status to 'active'
    const [result] = await db.query(
      'UPDATE orders SET status = ? WHERE id = ? AND status = "pending"',
      ['active', orderId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Order not found or already approved' });
    }

    res.json({ success: true, message: `Order ${orderId} approved` });
  } catch (err) {
    console.error('Error approving order:', err);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});
// Update user balance
router.patch('/users/balance', authenticateAdmin, async (req, res) => {
  const { phone, amount } = req.body;

  try {
    // Validate input
    if (!phone || !amount) {
      return res.status(400).json({ error: 'Phone and amount are required' });
    }

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      return res.status(400).json({ error: 'Amount must be a positive number' });
    }

    // Update user balance
    const [result] = await db.query(
      'UPDATE users SET total_balance = total_balance + ? WHERE phone = ?',
      [amountNum, phone]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ 
      success: true, 
      message: `Added ${amountNum} to user's balance` 
    });

  } catch (err) {
    console.error('Error updating balance:', err);
    res.status(500).json({ error: 'Database error', details: err.message });
  }
});


module.exports = router;
