// routes/dailyProfitJob.js
const db = require('../config/db');

async function applyDailyProfits() {
  try {
    // 1. Get all active (completed, not fully collected) orders
    const [orders] = await db.query(`
      SELECT o.id, o.user_id, o.daily_profit, o.validity_days,
             o.total_profit, o.created_at, o.profit_collected, 
             o.last_profit_at
      FROM orders o
      WHERE o.status = 'active' 
        AND o.profit_collected = 0
    `);

    console.log(`📦 Found ${orders.length} orders to process`);

    for (const order of orders) {
      const createdAt = new Date(order.created_at);
      const now = new Date();
      const lastProfitAt = order.last_profit_at ? new Date(order.last_profit_at) : createdAt;

      // Calculate full days passed since last profit
      const diffDays = Math.floor((now - lastProfitAt) / (1000 * 60 * 60 * 24));
      console.log(`➡️ Order ${order.id}: diffDays = ${diffDays}`);

      if (diffDays >= 1) {
        const payoutAmount = order.daily_profit * diffDays;

        await db.query('START TRANSACTION');

        // 2. Update only today_income for the user
        await db.query(
  `UPDATE users 
   SET today_income = today_income + ?, 
       total_balance = total_balance + ?
   WHERE id = ?`,
  [payoutAmount, payoutAmount, order.user_id]
);

        // 3. Update last_profit_at
        await db.query(
          `UPDATE orders 
           SET last_profit_at = NOW() 
           WHERE id = ?`,
          [order.id]
        );

        // 4. If order reached validity, mark as collected
        const totalDaysPassed = Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));
        if (totalDaysPassed >= order.validity_days) {
          await db.query(
            `UPDATE orders 
             SET profit_collected = 1 
             WHERE id = ?`,
            [order.id]
          );
        }

        await db.query('COMMIT');
        console.log(`✅ Credited ${payoutAmount} to user ${order.user_id} (today_income)`);
      } else {
        console.log(`⏩ Order ${order.id}: skipping (not enough time passed)`);
      }
    }
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('❌ Daily profit job failed:', err);
  }
}

module.exports = applyDailyProfits;
