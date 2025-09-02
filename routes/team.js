// ===============================
// backend/routes/user.js
// ===============================
const express = require('express');
const router = express.Router();
const db = require('../config/db');

/**
 * Helper: get referral chain (level 1/2/3 uplines)
 */
async function getReferralChain(userId, conn) {
  const [rows] = await conn.query(
    `SELECT
       u1.id AS level1_id,
       u2.id AS level2_id,
       u3.id AS level3_id
     FROM users u
     LEFT JOIN users u1 ON u.referred_by = u1.id
     LEFT JOIN users u2 ON u1.referred_by = u2.id
     LEFT JOIN users u3 ON u2.referred_by = u3.id
     WHERE u.id = ?`,
    [userId]
  );
  if (!rows.length) return { level1_id: null, level2_id: null, level3_id: null };
  return rows[0];
}

/**
 * Helper: calculate and pay commissions
 */
async function payCommissions(userId, depositAmount, conn) {
  if (!depositAmount || depositAmount <= 0) return;

  const chain = await getReferralChain(userId, conn);
  const levels = [
    { id: chain.level1_id, pct: 0.10, type: 'level1', level: 1 },
    { id: chain.level2_id, pct: 0.02, type: 'level2', level: 2 },
    { id: chain.level3_id, pct: 0.01, type: 'level3', level: 3 },
  ];

  for (const lvl of levels) {
    if (!lvl.id) continue;
    const commission = +(depositAmount * lvl.pct).toFixed(2);

    await conn.query(
      `UPDATE users SET total_balance = total_balance + ? WHERE id = ?`,
      [commission, lvl.id]
    );

    await conn.query(
      `INSERT INTO earnings (user_id, amount, type, description)
       VALUES (?, ?, ?, ?)`,
      [lvl.id, commission, lvl.type, `Level ${lvl.level} commission from user ${userId}`]
    );
  }
}

/**
 * POST /user/update-balance
 * Body: { userId, amount }
 */
router.post('/user/update-balance', async (req, res) => {
  const { userId, amount } = req.body;
  if (!userId || !amount || isNaN(amount) || amount <= 0)
    return res.status(400).json({ error: 'Invalid userId or amount' });

  let conn;
  try {
    conn = await db.getConnection();
    await conn.beginTransaction();

    const [userRows] = await conn.query(
      `SELECT total_balance FROM users WHERE id = ? FOR UPDATE`,
      [userId]
    );
    if (!userRows.length) {
      await conn.rollback();
      return res.status(404).json({ error: 'User not found' });
    }

    const prevBalance = +userRows[0].total_balance || 0;

    // Add deposit
    await conn.query(
      `UPDATE users SET total_balance = total_balance + ?, total_assets = COALESCE(total_assets,0) + ? WHERE id = ?`,
      [amount, amount, userId]
    );

    const newBalance = prevBalance + +amount;

    // Pay commissions if balance >= 300
    if (newBalance >= 300) {
      await payCommissions(userId, amount, conn);
    }

    await conn.commit();
    res.json({ success: true, message: 'Balance updated and commissions processed' });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error(err);
    res.status(500).json({ error: 'Failed to update balance' });
  } finally {
    if (conn) conn.release();
  }
});

/**
 * GET /user/:id/team
 * Keep your existing team code unchanged
 */
router.get('/user/:id/team', async (req, res) => {
  try {
    const userId = req.params.id;
    if (!userId || isNaN(userId)) return res.status(400).json({ error: 'Invalid user ID' });

    // Level 1
    const [level1] = await db.query(
      `SELECT u.id, u.name, u.phone, u.created_at AS joined_date,
        COALESCE(SUM(e.amount), 0) AS earned
       FROM users u
       LEFT JOIN earnings e ON e.user_id = u.id AND e.type = 'level1'
       WHERE u.referred_by = ?
       GROUP BY u.id
       ORDER BY u.created_at DESC`,
      [userId]
    );

    // Level 2
    const [level2] = await db.query(
      `SELECT u.id, u.name, u.phone, u.created_at AS joined_date,
        COALESCE(SUM(e.amount), 0) AS earned
       FROM users u
       JOIN users u1 ON u.referred_by = u1.id
       LEFT JOIN earnings e ON e.user_id = u.id AND e.type = 'level2'
       WHERE u1.referred_by = ?
       GROUP BY u.id
       ORDER BY u.created_at DESC`,
      [userId]
    );

    // Level 3
    const [level3] = await db.query(
      `SELECT u.id, u.name, u.phone, u.created_at AS joined_date,
        COALESCE(SUM(e.amount), 0) AS earned
       FROM users u
       JOIN users u1 ON u.referred_by = u1.id
       JOIN users u2 ON u1.referred_by = u2.id
       LEFT JOIN earnings e ON e.user_id = u.id AND e.type = 'level3'
       WHERE u2.referred_by = ?
       GROUP BY u.id
       ORDER BY u.created_at DESC`,
      [userId]
    );

    const members = [...level1, ...level2, ...level3];

    const stats = {
      totalMembers: members.length,
      level1Count: level1.length,
      level2Count: level2.length,
      level3Count: level3.length,
      totalEarnings: members.reduce((sum, m) => sum + (+m.earned || 0), 0),
    };

    res.json({ success: true, members, ...stats });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch team data', details: err.message });
  }
});

module.exports = router;
