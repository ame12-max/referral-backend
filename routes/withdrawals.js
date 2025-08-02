// In your backend routes (e.g., routes/withdrawals.js)
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const bcrypt = require('bcrypt');

router.post('/', async (req, res) => {
  const { amount, account_number, bank_name, password } = req.body;
  const userId = req.user.id; // From authentication middleware

  try {
    // Verify password
    const [userRows] = await db.query(
      "SELECT password FROM users WHERE id = ?",
      [userId]
    );
    
    if (userRows.length === 0) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    
    const isPasswordValid = await bcrypt.compare(password, userRows[0].password);
    if (!isPasswordValid) {
      return res.status(401).json({ success: false, message: "Invalid password" });
    }
    
    // Calculate withdrawal fee (8%)
    const withdrawalFee = amount * 0.08;
    const totalDeduction = amount + withdrawalFee;
    
    // Check user balance
    const [balanceRows] = await db.query(
      "SELECT total_balance FROM users WHERE id = ?",
      [userId]
    );
    
    if (balanceRows.length === 0 || balanceRows[0].total_balance < totalDeduction) {
      return res.status(400).json({ 
        success: false, 
        message: "Insufficient balance" 
      });
    }
    
    // Deduct from balance
    await db.query(
      "UPDATE users SET total_balance = total_balance - ? WHERE id = ?",
      [totalDeduction, userId]
    );
    
    // Create withdrawal record
    await db.query(
      "INSERT INTO withdrawals (user_id, amount, account_number, bank_name, fee) VALUES (?, ?, ?, ?, ?)",
      [userId, amount, account_number, bank_name, withdrawalFee]
    );
    
    res.status(200).json({ 
      success: true,
      message: "Withdrawal request submitted"
    });
    
  } catch (err) {
    console.error("Withdrawal error:", err);
    res.status(500).json({ 
      success: false, 
      message: "Server error during withdrawal",
      error: err.message
    });
  }
});

module.exports = router;