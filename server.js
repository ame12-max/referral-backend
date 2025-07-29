const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const userRoutes = require("./routes/userRoutes");
const paymentRoutes = require('./routes/paymentRoutes');
const productRoutes = require('./routes/productRoutes');
const transactionsRoutes = require('./routes/transactions');
const userStatsRouter = require('./routes/userStatus');


const app = express();
dotenv.config();

app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use("/api/user", userRoutes); // <== this must match
app.use('/api/products', productRoutes);
app.use('/api', userStatsRouter);

app.use('/api/payment', paymentRoutes);
app.use('/api/products', productRoutes);
app.use('/api', transactionsRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
