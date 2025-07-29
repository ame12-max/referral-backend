const db = require('../config/db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'yourSecretKey';

const registerUser = async (req, res) => {
  const { phone, password, referral } = req.body;

  if (!phone || !password) {
    return res.status(400).json({ msg: "Phone and password are required" });
  }

  try {
    // Remove .promise() - use db.query() directly
    const [existing] = await db.query("SELECT * FROM users WHERE phone = ?", [phone]);
    if (existing.length > 0) {
      return res.status(409).json({ msg: "Phone already registered" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    let level1 = null, level2 = null, level3 = null;
    let invitedBy = referral;

    if (invitedBy) {
      const [inviter] = await db.query("SELECT * FROM users WHERE invite_code = ?", [invitedBy]);
      if (!inviter.length) return res.status(400).json({ msg: "Invalid referral code" });

      level1 = inviter[0].id;
      level2 = inviter[0].level1_id;
      level3 = inviter[0].level2_id;
    }

    await db.query(
      "INSERT INTO users (phone, password, invite_code, invited_by, level1_id, level2_id, level3_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [phone, hashedPassword, inviteCode, invitedBy || null, level1, level2, level3]
    );

    res.status(201).json({ success: true, msg: "User registered successfully", inviteCode });
  } catch (err) {
    console.error("Registration Error:", err);
    res.status(500).json({ msg: "Server error during registration" });
  }
};

const loginUser = async (req, res) => {
  const { phone, password } = req.body;

  if (!phone || !password) {
    return res.status(400).json({ msg: "Phone and password required." });
  }

  try {
    // Remove .promise() - use db.query() directly
    const [rows] = await db.query("SELECT * FROM users WHERE phone = ?", [phone]);
    if (rows.length === 0) return res.status(404).json({ msg: "User not found." });

    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ msg: "Invalid credentials." });

    const token = jwt.sign({ id: user.id, phone: user.phone }, JWT_SECRET, { expiresIn: "7d" });

    res.status(200).json({
      success: true,
      msg: "Login successful",
      token,
      user: {
        id: user.id,
        phone: user.phone,
        invite_code: user.invite_code,
        total_balance: user.total_balance,
        recharged_balance: user.recharged_balance,
        withdrawable_balance: user.withdrawable_balance,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Server error" });
  }
};

const saveBankInfo = async (req, res) => {
  const { id } = req.params;
  const { bank, name, number } = req.body;

  if (!bank || !name || !number) {
    return res.status(400).json({ msg: "All bank fields are required." });
  }

  try {
    // Remove .promise() - use db.query() directly
    const [existing] = await db.query(
      "SELECT * FROM bank_details WHERE user_id = ?",
      [id]
    );

    if (existing.length > 0) {
      // Update existing record
      await db.query(
        "UPDATE bank_details SET bank_name = ?, account_holder = ?, account_number = ? WHERE user_id = ?",
        [bank, name, number, id]
      );
    } else {
      // Insert new record
      await db.query(
        "INSERT INTO bank_details (user_id, bank_name, account_holder, account_number) VALUES (?, ?, ?, ?)",
        [id, bank, name, number]
      );
    }

    res.status(200).json({ bank_name: bank, account_holder: name, account_number: number });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Server error." });
  }
};

const getBankInfo = async (req, res) => {
  const { id } = req.params;

  try {
    // Remove .promise() - use db.query() directly
    const [rows] = await db.query(
      "SELECT bank_name, account_holder, account_number FROM bank_details WHERE user_id = ?",
      [id]
    );
    if (!rows.length) return res.status(404).json({ msg: "Bank info not found" });
    res.status(200).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Failed to get bank info" });
  }
};

const getTeam = async (req, res) => {
  const { id } = req.params;

  try {
    // Remove .promise() - use db.query() directly
    const [level1] = await db.query(
      `SELECT phone FROM users 
       WHERE level1_id = ? AND recharged_balance > 0 
       AND id IN (SELECT user_id FROM orders)`,
      [id]
    );

    const [level2] = await db.query(
      `SELECT phone FROM users 
       WHERE level2_id = ? AND recharged_balance > 0 
       AND id IN (SELECT user_id FROM orders)`,
      [id]
    );

    const [level3] = await db.query(
      `SELECT phone FROM users 
       WHERE level3_id = ? AND recharged_balance > 0 
       AND id IN (SELECT user_id FROM orders)`,
      [id]
    );

    res.json({ level1, level2, level3 });
  } catch (err) {
    console.error("Team Fetch Error:", err);
    res.status(500).json({ msg: "Server error" });
  }
};

module.exports = {
  registerUser,
  loginUser,
  saveBankInfo,
  getBankInfo,
  getTeam,
};