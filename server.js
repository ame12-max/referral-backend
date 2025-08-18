const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const cron = require('node-cron');

dotenv.config();
const app = express();

// ✅ Middleware
const allowedOrigins = ['http://localhost:5174', 'http://localhost:5173','https://referral-backend-ui9q.onrender.com','https://referal-admin.vercel.app','https://orium-nine.vercel.app'];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control'],
}));


// Add health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date(),
    environment: process.env.NODE_ENV || 'development'
  });
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ✅ Routes
const userRoutes = require("./routes/userRoutes");
const paymentRoutes = require('./routes/paymentRoutes');
const productRoutes = require('./routes/productRoutes');
const transactionsRoutes = require('./routes/transactions');
const userStatsRouter = require('./routes/userStatus');
const withdrawalsRoutes = require('./routes/withdrawals');
const orderRoutes  = require('./routes/orderRoutes');
const applyDailyProfits = require('./routes/dailyProfitJob');

cron.schedule('10 0 * * *', async () => {
  console.log('⏰ Running daily profit job...');
  await applyDailyProfits();
});

// ✅ Admin routes (ADD THIS SECTION)
const adminRoutes = require('./routes/admin');
app.use('/api/admin', adminRoutes);

app.use('/api/orders', orderRoutes);
app.use('/api/test', (req, res) => res.json({ message: "Test route works!" }));

app.use("/api/user", userRoutes);
app.use('/api', paymentRoutes);
app.use('/api/user', paymentRoutes);
app.use('/api/products', productRoutes);
app.use('/api/stats', userStatsRouter);
app.use('/api/transactions', transactionsRoutes);
app.use('/api/withdrawals', withdrawalsRoutes);

app.get('/test',(req,res) =>{
  res.send('server is working')
})
// ✅ Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    error: 'Internal Server Error',
    message: err.message 
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
