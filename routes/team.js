// ===============================
// backend/routes/user.js
// ===============================
const express = require('express');
const router = express.Router();
const db = require('../config/db'); // mysql2/promise pool recommended

/**
 * Helper: get referral chain based on invite_code / invited_by
 * Assumes schema:
 *  - users: id, invite_code, invited_by, total_balance, created_at, ...
 */
async function getReferralChain(userId, conn) {
  const [rows] = await conn.query(
    `SELECT
       u2.id AS level1_id,
       u3.id AS level2_id,
       u4.id AS level3_id
     FROM users u
     LEFT JOIN users u2 ON u.invited_by = u2.invite_code
     LEFT JOIN users u3 ON u2.invited_by = u3.invite_code
     LEFT JOIN users u4 ON u3.invited_by = u4.invite_code
     WHERE u.id = ?
     LIMIT 1`,
    [userId]
  );
  if (!rows.length) return { level1_id: null, level2_id: null, level3_id: null };
  const { level1_id, level2_id, level3_id } = rows[0];
  return { level1_id, level2_id, level3_id };
}

/**
 * Helper: pay commissions to up to 3 uplines.
 * - Base is the CURRENT deposit amount (NOT the cumulative balance!)
 * - We update only columns we are sure exist: total_balance
 * - We also insert earnings with types level1/level2/level3 and description
 */
async function calculateCommissions(userId, depositAmount, conn) {
  if (!Number.isFinite(+depositAmount) || +depositAmount <= 0) return;

  const chain = await getReferralChain(userId, conn);
  const plan = [
    { id: chain.level1_id, pct: 0.10, type: 'level1', level: 1 },
    { id: chain.level2_id, pct: 0.02, type: 'level2', level: 2 },
    { id: chain.level3_id, pct: 0.01, type: 'level3', level: 3 },
  ];

  for (const tier of plan) {
    if (!tier.id) continue; // skip if no upline at this level
    const commission = +(depositAmount * tier.pct).toFixed(8);

    // credit the upline's spendable balance (total_balance)
    await conn.query(
      `UPDATE users SET total_balance = total_balance + ? WHERE id = ?`,
      [commission, tier.id]
    );

    // record the earning for the upline
    await conn.query(
      `INSERT INTO earnings (user_id, amount, type, description)
       VALUES (?, ?, ?, ?)`,
      [
        tier.id,
        commission,
        tier.type,
        `Level ${tier.level} commission from user ${userId}`,
      ]
    );
  }
}

/**
 * POST /user/update-balance
 * Body: { userId: number, amount: number }
 *
 * Rules:
 *  - Add the deposit to the user's balance
 *  - If the user's NEW balance is >= 300, pay commissions based on THIS deposit
 *    (so crossing the threshold or already above it both pay commissions)
 */
router.post('/user/update-balance', async (req, res) => {
  const { userId, amount } = req.body || {};

  // basic validation
  if (!userId || !Number.isFinite(+amount)) {
    return res.status(400).json({ success: false, error: 'Invalid userId or amount' });
  }
  const deposit = +amount;
  if (deposit <= 0) {
    return res.status(400).json({ success: false, error: 'Amount must be > 0' });
  }

  let conn;
  try {
    conn = await db.getConnection();
    await conn.beginTransaction();

    // fetch previous balance
    const [beforeRows] = await conn.query(
      `SELECT total_balance FROM users WHERE id = ? FOR UPDATE`,
      [userId]
    );
    if (!beforeRows.length) {
      await conn.rollback();
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const prev = +beforeRows[0].total_balance || 0;

    // apply deposit
    await conn.query(
      `UPDATE users SET total_balance = total_balance + ?, total_assets = COALESCE(total_assets, 0) + ? WHERE id = ?`,
      [deposit, deposit, userId]
    );

    // fetch new balance
    const [afterRows] = await conn.query(
      `SELECT total_balance FROM users WHERE id = ?`,
      [userId]
    );
    const now = +afterRows[0].total_balance || 0;

    // commission trigger: NEW balance >= 300 → pay commission based on THIS deposit
    if (now >= 300) {
      await calculateCommissions(userId, deposit, conn);
    }

    await conn.commit();
    return res.json({ success: true, message: 'Balance updated and commissions processed' });
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (_) {}
    }
    console.error('Error updating balance:', err);
    return res.status(500).json({ success: false, error: 'Failed to update balance' });
  } finally {
    if (conn) conn.release();
  }
});

/**
 * GET /user/:id/team
 * Returns team lists for 3 levels + stats. Also returns per-member `earned`
 * by matching earnings.description pattern (since earnings table has no source_user_id).
 */
router.get('/user/:id/team', async (req, res) => {
  const userId = +req.params.id;
  if (!Number.isFinite(userId)) {
    return res.status(400).json({ success: false, error: 'Invalid user ID' });
  }

  try {
    // same SQL queries for level1, level2, level3 as before
    // (unchanged code copied from earlier route)

    const [level1] = await db.query(
      `SELECT u.id, u.name, u.phone, u.created_at AS joined_date, u.total_balance,
              1 AS level,
              COALESCE(SUM(e.amount), 0) AS earned
       FROM users u
       LEFT JOIN earnings e
         ON e.user_id = ?
        AND e.type = 'level1'
        AND e.description LIKE CONCAT('%from user ', u.id, '%')
       WHERE u.invited_by = (SELECT invite_code FROM users WHERE id = ?)
       GROUP BY u.id
       ORDER BY u.created_at DESC`,
      [userId, userId]
    );

    const [level2] = await db.query(
      `SELECT u.id, u.name, u.phone, u.created_at AS joined_date, u.total_balance,
              2 AS level,
              COALESCE(SUM(e.amount), 0) AS earned
       FROM users u
       JOIN users u1 ON u.invited_by = u1.invite_code
       LEFT JOIN earnings e
         ON e.user_id = ?
        AND e.type = 'level2'
        AND e.description LIKE CONCAT('%from user ', u.id, '%')
       WHERE u1.invited_by = (SELECT invite_code FROM users WHERE id = ?)
       GROUP BY u.id
       ORDER BY u.created_at DESC`,
      [userId, userId]
    );

    const [level3] = await db.query(
      `SELECT u.id, u.name, u.phone, u.created_at AS joined_date, u.total_balance,
              3 AS level,
              COALESCE(SUM(e.amount), 0) AS earned
       FROM users u
       JOIN users u1 ON u.invited_by = u1.invite_code
       JOIN users u2 ON u1.invited_by = u2.invite_code
       LEFT JOIN earnings e
         ON e.user_id = ?
        AND e.type = 'level3'
        AND e.description LIKE CONCAT('%from user ', u.id, '%')
       WHERE u2.invited_by = (SELECT invite_code FROM users WHERE id = ?)
       GROUP BY u.id
       ORDER BY u.created_at DESC`,
      [userId, userId]
    );

    const members = [...level1, ...level2, ...level3];
    const stats = {
      totalMembers: members.length,
      level1Count: level1.length,
      level2Count: level2.length,
      level3Count: level3.length,
      totalEarnings: members.reduce((s, m) => s + (+m.earned || 0), 0),
    };

    return res.json({ success: true, members, ...stats });
  } catch (err) {
    console.error('Error fetching team data:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch team data', details: err.message });
  }
});

module.exports = router;
