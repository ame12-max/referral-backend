const db = require('../config/db');

const applyDailyProfits = async () => {
  try {
    // Get all active orders
    const [orders] = await db.query(`
      SELECT o.id, o.user_id, o.daily_profit, o.total_profit, o.validity_days, o.created_at, u.total_balance
      FROM orders o
      JOIN users u ON o.user_id = u.id
      WHERE o.status = 'active'
    `);

    const today = new Date();

    for (const order of orders) {
      const created = new Date(order.created_at);
      const elapsedDays = Math.floor((today - created) / (1000 * 60 * 60 * 24));

      if (elapsedDays >= order.validity_days) {
        // Mark as completed if duration has passed
        await db.query(`UPDATE orders SET status = 'completed' WHERE id = ?`, [order.id]);
        continue;
      }

      // Add daily profit and update user balance
      await db.query(`
        UPDATE users SET total_balance = total_balance + ? WHERE id = ?
      `, [order.daily_profit, order.user_id]);

      await db.query(`
        UPDATE orders SET total_profit = total_profit + ? WHERE id = ?
      `, [order.daily_profit, order.id]);
    }

    console.log(`[Daily Profit Job] ✅ Applied to ${orders.length} active orders.`);
  } catch (error) {
    console.error('[Daily Profit Job] ❌ Error:', error.message);
  }
};

module.exports = applyDailyProfits;
