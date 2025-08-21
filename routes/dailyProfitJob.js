// routes/dailyProfitJob.js
const db = require('../config/db');

async function applyDailyProfits() {
  try {
    // 1. Get all active orders
    const [orders] = await db.query(`
      SELECT o.id, o.user_id, o.daily_profit, o.validity_days,
             o.total_profit, o.created_at, o.profit_collected, 
             o.last_profit_at, u.total_balance
      FROM orders o
      JOIN users u ON o.user_id = u.id
      WHERE o.status = 'completed' 
        AND o.profit_collected = 0
    `);

    for (const order of orders) {
      const createdAt = new Date(order.created_at);
      const now = new Date();
      const lastProfitAt = order.last_profit_at ? new Date(order.last_profit_at) : createdAt;

      // 2. Check how many full days have passed since last payout
      const diffDays = Math.floor((now - lastProfitAt) / (1000 * 60 * 60 * 24));

      if (diffDays >= 1) {
        // Calculate how many payouts are still allowed
        const totalDaysPassed = Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));
        if (totalDaysPassed <= order.validity_days) {
          const payoutAmount = order.daily_profit * diffDays;

          await db.query('START TRANSACTION');

          // 3. Update user balance
          await db.query(
            `UPDATE users SET total_balance = total_balance + ? WHERE id = ?`,
            [payoutAmount, order.user_id]
          );

          // 4. Update order last_profit_at
          await db.query(
            `UPDATE orders SET last_profit_at = NOW() WHERE id = ?`,
            [order.id]
          );

          // 5. If fully matured, mark collected
          if (totalDaysPassed >= order.validity_days) {
            await db.query(
              `UPDATE orders SET profit_collected = 1 WHERE id = ?`,
              [order.id]
            );
          }

          await db.query('COMMIT');
          console.log(`✅ Credited ${payoutAmount} to user ${order.user_id} for order ${order.id}`);
        }
      }
    }
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('❌ Daily profit job failed:', err);
  }
}

module.exports = applyDailyProfits;
