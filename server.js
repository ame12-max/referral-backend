// server.js
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const jwt = require('jsonwebtoken'); // Add this import
const userRoutes = require("./routes/userRoutes");
const paymentRoutes = require('./routes/paymentRoutes');
const productRoutes = require('./routes/productRoutes');
const transactionsRoutes = require('./routes/transactions');
const userStatsRouter = require('./routes/userStatus');
const db = require('./config/db');

const app = express();
dotenv.config();

app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE']
}));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Routes
app.use("/api/user", userRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/products', productRoutes);
app.use('/api/stats', userStatsRouter);
app.use('/api/transactions', transactionsRoutes);

// Bank endpoint
app.put('/api/user/bank', async (req, res) => {
  try {
    // Extract token from headers
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'Authorization token required' });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'yourSecretKey');
    const userId = decoded.id;
    
    const { bank, name, number } = req.body;

    if (!bank || !name || !number) {
      return res.status(400).json({ msg: "All bank fields are required." });
    }

    // Database logic
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
});

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