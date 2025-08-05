// routes/withdrawals.js
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const bcrypt = require('bcrypt');
const {authenticateUser} = require('../middleware/auth'); // Assuming you have an auth middleware

// Ensure you have auth middleware applied to this route group
router.post('/', authenticateUser,  async (req, res) => {
  const { amount, account_number, bank_name, password } = req.body;
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ success: false, message: "Unauthorized: Missing user ID" });
  }

  try {
    // Step 1: Verify user exists and get password
    const [userRows] = await db.query(
      "SELECT id, password, total_balance FROM users WHERE id = ?",
      [userId]
    );

    if (userRows.length === 0) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const user = userRows[0];

    // Step 2: Compare password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ success: false, message: "Invalid password" });
    }

    // Step 3: Calculate fee and validate balance
    const withdrawalFee = amount * 0.08;
    const totalDeduction = amount + withdrawalFee;

    if (user.total_balance < totalDeduction) {
      return res.status(400).json({ success: false, message: "Insufficient balance" });
    }

    // Step 4: Start DB transaction (optional but recommended for consistency)
    await db.query("START TRANSACTION");

    // Step 5: Deduct balance
    await db.query(
      "UPDATE users SET total_balance = total_balance - ? WHERE id = ?",
      [totalDeduction, userId]
    );

    // Step 6: Insert withdrawal request
    await db.query(
      "INSERT INTO withdrawals (user_id, amount, account_number, bank_name, fee) VALUES (?, ?, ?, ?, ?)",
      [userId, amount, account_number, bank_name, withdrawalFee]
    );

    // Step 7: Commit
    await db.query("COMMIT");

    return res.status(200).json({ success: true, message: "Withdrawal request submitted" });

  } catch (err) {
    // Rollback in case of error
    await db.query("ROLLBACK");
    console.error("Withdrawal error:", err);
    return res.status(500).json({ 
      success: false, 
      message: "Server error during withdrawal",
      error: err.message 
    });
  }
});

module.exports = router;
