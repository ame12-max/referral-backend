const db = require('../config/db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

exports.login = async (req, res) => {
  const { phone, password } = req.body;
  console.log(`Admin login attempt for phone: ${phone}`);

  try {
    const [admins] = await db.query(
      "SELECT id, phone, password, full_name, role FROM admins WHERE phone = ?",
      [phone]
    );

    console.log(`Found ${admins.length} admin(s) with that phone`);

    if (admins.length === 0) {
      console.log("No admin found with that phone");
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const admin = admins[0];
    console.log(`Admin found: ${admin.full_name} (ID: ${admin.id})`);
    
    const isMatch = await bcrypt.compare(password, admin.password);
    console.log(`Password match: ${isMatch}`);

    if (!isMatch) {
      console.log("Password does not match");
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      { adminId: admin.id },
      process.env.ADMIN_JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      success: true,
      token,
      admin: {
        id: admin.id,
        phone: admin.phone,
        full_name: admin.full_name,
        role: admin.role
      }
    });
  }  catch (err) {
    console.error("Full login error:", err);
    res.status(500).json({ error: "Server error during authentication" });
  }
};

// Get pending withdrawals
exports.getPendingWithdrawals = async (req, res) => {
  try {
    const [withdrawals] = await db.query(`
      SELECT w.id, u.username, w.amount, w.account_number, w.bank_name, w.created_at
      FROM withdrawals w
      JOIN users u ON w.user_id = u.id
      WHERE w.status = 'pending'
    `);
    res.json(withdrawals);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};

// Approve/reject withdrawal
exports.updateWithdrawalStatus = async (req, res) => {
  const { status } = req.body;
  const withdrawalId = req.params.id;

  try {
    await db.query("START TRANSACTION");
    
    // Update status
    await db.query(
      "UPDATE withdrawals SET status = ? WHERE id = ?",
      [status, withdrawalId]
    );

    // Refund if rejected
    if (status === 'rejected') {
      const [[withdrawal]] = await db.query(
        "SELECT user_id, amount, fee FROM withdrawals WHERE id = ?",
        [withdrawalId]
      );
      
      if (withdrawal) {
        const total = withdrawal.amount + withdrawal.fee;
        await db.query(
          "UPDATE users SET total_balance = total_balance + ? WHERE id = ?",
          [total, withdrawal.user_id]
        );
      }
    }

    await db.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await db.query("ROLLBACK");
    res.status(500).json({ error: "Update failed" });
  }
};

// Get pending recharges
exports.getPendingRecharges = async (req, res) => {
  try {
    const [recharges] = await db.query(`
      SELECT d.id, u.username, d.amount, d.method, d.reference, d.created_at
      FROM direct_payment d
      JOIN users u ON d.user_id = u.id
      WHERE d.status = 'pending'
    `);
    res.json(recharges);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};

// Approve/reject recharge
exports.updateRechargeStatus = async (req, res) => {
  const { status } = req.body;
  const rechargeId = req.params.id;

  try {
    await db.query("START TRANSACTION");
    
    // Update status
    await db.query(
      "UPDATE direct_payment SET status = ? WHERE id = ?",
      [status, rechargeId]
    );

    // Add balance if approved
    if (status === 'approved') {
      const [[recharge]] = await db.query(
        "SELECT user_id, amount FROM direct_payment WHERE id = ?",
        [rechargeId]
      );
      
      if (recharge) {
        await db.query(
          "UPDATE users SET total_balance = total_balance + ? WHERE id = ?",
          [recharge.amount, recharge.user_id]
        );
      }
    }

    await db.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await db.query("ROLLBACK");
    res.status(500).json({ error: "Update failed" });
  }
};

// Get pending payments
exports.getPendingPayments = async (req, res) => {
  try {
    const [payments] = await db.query(`
      SELECT p.id, u.username, p.amount, p.transaction_id, p.created_at
      FROM payments p
      JOIN users u ON p.user_id = u.id
      WHERE p.status = 'pending'
    `);
    res.json(payments);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};

// Update payment status
exports.updatePaymentStatus = async (req, res) => {
  const { paymentId, status } = req.body;

  try {
    // Reuse your existing update-payment logic
    console.log(`Updating payment ${paymentId} to status: ${status}`);
    
    // 1. Update payment status
    const [updateResult] = await db.query(
      'UPDATE payments SET status = ? WHERE id = ?',
      [status, paymentId]
    );

    if (updateResult.affectedRows === 0) {
      return res.status(404).json({ error: "Payment not found" });
    }

    let orderCreated = false;
    
    // 2. Only create order for completed payments
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
        return res.status(500).json({ error: 'Payment details not found' });
      }

      const payment = paymentDetails[0];
      const cleanPhone = payment.phone.replace(/[{} ]/g, '');
      const returns = payment.returns.toLowerCase();
      let dailyProfitPercent, validityDays;

      const newFormatMatch = returns.match(/(\d+)%\s*profit\s*\/\s*(\d+)\s*hr/);
      const oldFormatMatch = returns.match(/(\d+)%\s*daily\s*for\s*(\d+)\s*days/);
      const simpleFormatMatch = returns.match(/(\d+)%\s*for\s*(\d+)\s*days/);

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
      } else {
        return res.status(400).json({ error: 'Invalid returns format' });
      }

      const dailyProfit = (payment.amount * dailyProfitPercent) / 100;

      await db.query(
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

      orderCreated = true;
    }

    res.json({ 
      success: true,
      message: `Payment ${paymentId} updated to ${status}`,
      orderCreated
    });
  } catch (err) {
    console.error('Payment update failed:', err);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
};