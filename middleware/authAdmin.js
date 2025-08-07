const jwt = require('jsonwebtoken');
const db = require('../config/db');

module.exports = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: "Admin token required" });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.ADMIN_JWT_SECRET);
    
    const [admin] = await db.query(
      "SELECT id, phone, role FROM admins WHERE id = ?",
      [decoded.adminId]
    );
    
    if (admin.length === 0) {
      return res.status(401).json({ error: "Invalid admin credentials" });
    }

    req.admin = admin[0];
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: "Admin session expired" });
    }
    res.status(401).json({ error: "Admin authentication failed" });
  }
};