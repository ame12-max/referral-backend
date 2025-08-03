const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

const app = express();
dotenv.config();

// Add this before your routes
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'http://localhost:5173');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Routes
const userRoutes = require("./routes/userRoutes");
const paymentRoutes = require('./routes/paymentRoutes'); // Adjust path as needed
const productRoutes = require('./routes/productRoutes');
const transactionsRoutes = require('./routes/transactions');
const userStatsRouter = require('./routes/userStatus');
const withdrawalsRoutes = require('./routes/withdrawals');
const orderRoutes  = require('./routes/orderRoutes');



app.use((req, res, next) => {
  req.url = req.url.replace(/\/{2,}/g, '/');
  next();
});

// Mount order routes
app.use('/api/orders', orderRoutes);

// Add this test route
app.get('/api/test', (req, res) => {
  res.json({ message: "Test route works!" });
});

app.use("/api/user", userRoutes);
app.use('/api', paymentRoutes); // 👈 This makes routes accessible at /api/
app.use('/api/products', productRoutes);
app.use('/api/stats', userStatsRouter);
app.use('/api/transactions', transactionsRoutes);
app.use('/api/withdrawals', withdrawalsRoutes);


// Error handling middleware
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