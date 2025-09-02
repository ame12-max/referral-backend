const db = require('../config/db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'yourSecretKey';

/**
 * Check and update referral bonuses when a user's balance changes
 * This function can be called from various points (recharge, manual update, etc.)
 */
const checkAndUpdateReferralBonuses = async (userId) => {
  try {
    // Get user's current balance and check if it reached 500
    const [userRows] = await db.query(
      "SELECT total_balance, invited_by FROM users WHERE id = ?",
      [userId]
    );
    
    if (userRows.length === 0 || userRows[0].total_balance < 500) return;
    
    const userBalance = userRows[0].total_balance;
    const invitedBy = userRows[0].invited_by;
    
    if (!invitedBy) return; // No referrer
    
    // Get the referral chain (level1, level2, level3)
    const [referrerRows] = await db.query(
      "SELECT id, level1_id, level2_id, level3_id FROM users WHERE invite_code = ?",
      [invitedBy]
    );
    
    if (referrerRows.length === 0) return;
    
    const referrer = referrerRows[0];
    
    // Check if bonuses already awarded for this user
    const [bonusCheck] = await db.query(
      "SELECT id FROM bonus_payments WHERE awarded_to = ? AND type = 'balance_threshold'",
      [userId]
    );
    
    if (bonusCheck.length > 0) return; // Bonuses already awarded
    
    // Calculate bonuses (10%, 2%, 1%)
    const level1Bonus = userBalance * 0.10; // 50 Birr for 500 balance
    const level2Bonus = userBalance * 0.02; // 10 Birr for 500 balance
    const level3Bonus = userBalance * 0.01; // 5 Birr for 500 balance
    
    // Award level1 bonus (direct referrer)
    if (referrer.id) {
      await db.query(
        "UPDATE users SET total_balance = total_balance + ? WHERE id = ?",
        [level1Bonus, referrer.id]
      );
      
      await db.query(
        "INSERT INTO earnings (user_id, from_user, amount, type) VALUES (?, ?, ?, ?)",
        [referrer.id, userId, level1Bonus, "level1_bonus"]
      );
    }
    
    // Award level2 bonus
    if (referrer.level1_id) {
      await db.query(
        "UPDATE users SET total_balance = total_balance + ? WHERE id = ?",
        [level2Bonus, referrer.level1_id]
      );
      
      await db.query(
        "INSERT INTO earnings (user_id, from_user, amount, type) VALUES (?, ?, ?, ?)",
        [referrer.level1_id, userId, level2Bonus, "level2_bonus"]
      );
    }
    
    // Award level3 bonus
    if (referrer.level2_id) {
      await db.query(
        "UPDATE users SET total_balance = total_balance + ? WHERE id = ?",
        [level3Bonus, referrer.level2_id]
      );
      
      await db.query(
        "INSERT INTO earnings (user_id, from_user, amount, type) VALUES (?, ?, ?, ?)",
        [referrer.level2_id, userId, level3Bonus, "level3_bonus"]
      );
    }
    
    // Record that bonuses were awarded for this user
    await db.query(
      "INSERT INTO bonus_payments (awarded_to, awarded_by, amount, type) VALUES (?, ?, ?, ?)",
      [userId, referrer.id, level1Bonus, 'balance_threshold']
    );
    
    console.log(`Bonuses awarded for user ${userId} reaching ${userBalance} balance`);
    
  } catch (err) {
    console.error('Referral bonus error:', err);
  }
};

/**
 * Register user
 */
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

/**
 * Login user
 */
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

/**
 * Recharge user balance
 */
const recharge = async (req, res) => {
  try {
    const { amount } = req.body;
    const userId = req.user.id;

    if (!amount || amount <= 0) {
      return res.status(400).json({ msg: "Invalid recharge amount" });
    }

    // Update user balance
    await db.query(
      "UPDATE users SET recharged_balance = recharged_balance + ?, total_balance = total_balance + ? WHERE id = ?",
      [amount, amount, userId]
    );

    // Check if this recharge qualifies for referral bonuses
    await checkAndUpdateReferralBonuses(userId);

    res.status(200).json({ success: true, msg: "Recharge successful" });
  } catch (err) {
    console.error("Recharge error:", err);
    res.status(500).json({ msg: "Server error during recharge" });
  }
};

/**
 * Manual balance update endpoint (for testing/admin)
 */
const updateBalance = async (req, res) => {
  try {
    const { userId, amount } = req.body;
    
    // Check if user is admin or has permission
    if (!req.user || !req.user.isAdmin) {
      return res.status(403).json({ msg: "Permission denied" });
    }

    if (!userId || !amount || amount <= 0) {
      return res.status(400).json({ msg: "Invalid parameters" });
    }

    // Update user balance
    await db.query(
      "UPDATE users SET total_balance = ? WHERE id = ?",
      [amount, userId]
    );

    // Check if this update qualifies for referral bonuses
    await checkAndUpdateReferralBonuses(userId);

    res.status(200).json({ success: true, msg: "Balance updated successfully" });
  } catch (err) {
    console.error("Balance update error:", err);
    res.status(500).json({ msg: "Server error during balance update" });
  }
};

/**
 * Get team details
 */
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

    // Level 1
    const [level1] = await db.query(`
      SELECT 
        u.id,
        COALESCE(u.name, 'Unnamed Member') AS name,
        u.phone,
        u.created_at AS joinedAt,
        COALESCE(SUM(e.amount), 0) AS earned,
        CASE 
          WHEN u.total_balance >= 500 THEN COALESCE(SUM(e.amount), 0) * 0.10
          ELSE 0
        END AS commission,
        1 AS level
      FROM users u
      JOIN users inviter ON inviter.invite_code = u.invited_by
      LEFT JOIN earnings e ON e.user_id = u.id AND e.type = 'level1'
      WHERE inviter.id = ?
      GROUP BY u.id, u.total_balance
    `, [userId]);

    // Level 2
    const [level2] = await db.query(`
      SELECT 
        u.id,
        COALESCE(u.name, 'Unnamed Member') AS name,
        u.phone,
        u.created_at AS joinedAt,
        COALESCE(SUM(e.amount), 0) AS earned,
        CASE 
          WHEN u.total_balance >= 500 THEN COALESCE(SUM(e.amount), 0) * 0.02
          ELSE 0
        END AS commission,
        2 AS level
      FROM users u
      JOIN users u1 ON u.invited_by = u1.invite_code
      JOIN users inviter2 ON inviter2.id = ?
      LEFT JOIN earnings e ON e.user_id = u.id AND e.type = 'level2'
      WHERE u1.invited_by = inviter2.invite_code
      GROUP BY u.id, u.total_balance
    `, [userId]);

    // Level 3
    const [level3] = await db.query(`
      SELECT 
        u.id,
        COALESCE(u.name, 'Unnamed Member') AS name,
        u.phone,
        u.created_at AS joinedAt,
        COALESCE(SUM(e.amount), 0) AS earned,
        CASE 
          WHEN u.total_balance >= 500 THEN COALESCE(SUM(e.amount), 0) * 0.01
          ELSE 0
        END AS commission,
        3 AS level
      FROM users u
      JOIN users u1 ON u.invited_by = u1.invite_code
      JOIN users u2 ON u1.invited_by = u2.invite_code
      JOIN users inviter3 ON inviter3.id = ?
      LEFT JOIN earnings e ON e.user_id = u.id AND e.type = 'level3'
      WHERE u2.invited_by = inviter3.invite_code
      GROUP BY u.id, u.total_balance
    `, [userId]);

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

/**
 * Get account data
 */
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
        total_assets: totalAssets,
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

/**
 * Verify token
 */
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

/**
 * Get bank info
 */
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

/**
 * Update bank info
 */
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

/**
 * Check all users for bonus eligibility (for cron job or manual trigger)
 */
const checkAllUsersForBonuses = async (req, res) => {
  try {
    // Get all users with balance >= 500 who haven't triggered bonuses yet
    const [users] = await db.query(`
      SELECT u.id 
      FROM users u 
      WHERE u.total_balance >= 500 
      AND NOT EXISTS (
        SELECT 1 FROM bonus_payments bp 
        WHERE bp.awarded_to = u.id AND bp.type = 'balance_threshold'
      )
    `);
    
    let processed = 0;
    
    for (const user of users) {
      await checkAndUpdateReferralBonuses(user.id);
      processed++;
    }
    
    if (res) {
      res.status(200).json({ 
        success: true, 
        message: `Processed ${processed} users for bonuses` 
      });
    }
  } catch (err) {
    console.error('Check all users error:', err);
    if (res) {
      res.status(500).json({ 
        success: false, 
        message: 'Error processing users for bonuses',
        error: err.message 
      });
    }
  }
};

module.exports = {
  registerUser,
  loginUser,
  recharge,
  updateBalance,
  getBankInfo,
  updateBankInfo,
  getTeam,
  getAccountData,
  verifyToken,
  checkAllUsersForBonuses
};
