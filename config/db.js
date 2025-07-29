// config/db.js
const mysql = require('mysql2/promise');
require('dotenv').config(); // Make sure to load environment variables

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root', // Default to root user
  password: process.env.DB_PASSWORD || '', // Use empty string if no password
  database: process.env.DB_NAME || 'reffering', // Your database name
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Test connection
pool.getConnection()
  .then(connection => {
    console.log('Connected to MySQL database!');
    connection.release();
  })
  .catch(err => {
    console.error('Database connection failed:', err);
    process.exit(1);
  });

module.exports = pool;