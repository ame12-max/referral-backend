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

const getTeam = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const [userData] = await db.query(
      `SELECT invite_code FROM users WHERE id = ?`,
      [userId]
    );
    
    if (!userData || userData.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    const currentInviteCode = userData[0].invite_code;

    // Level 1: Direct referrals with commission calculation
    const [level1] = await db.query(
      `SELECT 
        u.id, 
        COALESCE(u.name, 'Unnamed Member') AS name,
        u.phone,
        u.balance,
        u.created_at AS joinedAt,
        COALESCE(SUM(e.amount), 0) AS earned,
        CASE 
          WHEN u.balance > 300 THEN COALESCE(SUM(e.amount), 0) * 0.10
          ELSE 0 
        END AS commission,
        1 AS level
      FROM users u
      LEFT JOIN earnings e ON e.user_id = u.id AND e.type = 'level1'
      WHERE u.invited_by = ?
      GROUP BY u.id`,
      [currentInviteCode]
    );

    // Level 2: Referrals of referrals with commission calculation
    const [level2] = await db.query(
      `SELECT 
        u.id,
        COALESCE(u.name, 'Unnamed Member') AS name,
        u.phone,
        u.balance,
        u.created_at AS joinedAt,
        COALESCE(SUM(e.amount), 0) AS earned,
        CASE 
          WHEN u.balance > 300 THEN COALESCE(SUM(e.amount), 0) * 0.02
          ELSE 0 
        END AS commission,
        2 AS level
      FROM users u
      JOIN users u1 ON u.invited_by = u1.invite_code
      LEFT JOIN earnings e ON e.user_id = u.id AND e.type = 'level2'
      WHERE u1.invited_by = ?
      GROUP BY u.id`,
      [currentInviteCode]
    );

    // Level 3: Referrals of referrals of referrals with commission calculation
    const [level3] = await db.query(
      `SELECT 
        u.id,
        COALESCE(u.name, 'Unnamed Member') AS name,
        u.phone,
        u.balance,
        u.created_at AS joinedAt,
        COALESCE(SUM(e.amount), 0) AS earned,
        CASE 
          WHEN u.balance > 300 THEN COALESCE(SUM(e.amount), 0) * 0.01
          ELSE 0 
        END AS commission,
        3 AS level
      FROM users u
      JOIN users u1 ON u.invited_by = u1.invite_code
      JOIN users u2 ON u1.invited_by = u2.invite_code
      LEFT JOIN earnings e ON e.user_id = u.id AND e.type = 'level3'
      WHERE u2.invited_by = ?
      GROUP BY u.id`,
      [currentInviteCode]
    );

    const members = [...level1, ...level2, ...level3];
    
    // Calculate total commission
    const totalCommission = members.reduce((sum, m) => sum + parseFloat(m.commission), 0);
    
    res.json({
      success: true,
      members,
      totalMembers: members.length,
      totalEarnings: members.reduce((sum, m) => sum + parseFloat(m.earned), 0),
      totalCommission: totalCommission,
      level1Count: level1.length,
      level2Count: level2.length,
      level3Count: level3.length
    });

  } catch (err) {
    console.error('getTeam error:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Server error fetching team data',
      error: err.message 
    });
  }
};

const getAccountData = async (req, res) => {
  try {
    const [userRows] = await db.query(
      `SELECT 
        id, phone, invite_code, 
        total_balance, today_income
      FROM users 
      WHERE id = ?`,
      [req.user.id]
    );

    if (userRows.length === 0) {
      return res.status(404).json({ 
        success: false,
        msg: "User not found" 
      });
    }

    const user = userRows[0];

    // Calculate total assets dynamically
    const totalBalance = Number(user.total_balance) || 0;
    const todayIncome = Number(user.today_income) || 0;
    const totalAssets = totalBalance + todayIncome;

    const [bankRows] = await db.query(
      "SELECT bank_name, account_holder, account_number FROM bank_details WHERE user_id = ?",
      [req.user.id]
    );

    res.status(200).json({
      success: true,
      user: {
        ...user,
        total_assets: totalAssets, // override with calculated value
        bank: bankRows[0] || null
      }
    });
  } catch (err) {
    console.error("Account Data Error:", err);
    res.status(500).json({ 
      success: false,
      msg: "Server error during account data fetch",
      error: err.message
    });
  }
};

const verifyToken = async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(400).json({ 
      success: false,
      error: 'No token provided' 
    });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({
      success: true,
      valid: true,
      userId: decoded.id,
      expiresAt: new Date(decoded.exp * 1000).toLocaleString()
    });
  } catch (error) {
    res.status(401).json({
      success: false,
      valid: false,
      error: error.message
    });
  }
};

const getBankInfo = async (req, res) => {
  const userId = req.user.id;

  try {
    const [rows] = await db.query(
      "SELECT bank_name, account_holder, account_number FROM bank_details WHERE user_id = ?",
      [userId]
    );
    
    if (!rows.length) return res.status(404).json({ msg: "Bank info not found" });
    res.status(200).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Failed to get bank info" });
  }
};

const updateBankInfo = async (req, res) => {
  try {
    const userId = req.user.id;
    const { bank, name, number } = req.body;

    if (!bank || !name || !number) {
      return res.status(400).json({ msg: "All bank fields are required." });
    }

    const [existing] = await db.query(
      "SELECT * FROM bank_details WHERE user_id = ?",
      [userId]
    );

    if (existing.length > 0) {
      await db.query(
        "UPDATE bank_details SET bank_name = ?, account_holder = ?, account_number = ? WHERE user_id = ?",
        [bank, name, number, userId]
      );
    } else {
      await db.query(
        "INSERT INTO bank_details (user_id, bank_name, account_holder, account_number) VALUES (?, ?, ?, ?)",
        [userId, bank, name, number]
      );
    }

    res.status(200).json({ 
      bank_name: bank, 
      account_holder: name, 
      account_number: number 
    });
  } catch (err) {
    console.error("Bank save error:", err);
    res.status(500).json({ 
      msg: "Server error",
      error: err.message
    });
  }
};

module.exports = {
  registerUser,
  loginUser,
  getBankInfo,
  updateBankInfo,
  getTeam,
  getAccountData,
  verifyToken
};
