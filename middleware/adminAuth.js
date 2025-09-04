const jwt = require('jsonwebtoken');
const db = require('../config/db');

const authenticateAdmin = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header missing or invalid' });
  }

  const token = authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Token not found in authorization header' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    if (!decoded.id) {
      return res.status(401).json({ error: 'Invalid token payload: Missing admin ID' });
    }
    
    // Verify admin exists in database
    const [admins] = await db.query(
      "SELECT id, phone, role FROM admins WHERE id = ?",
      [decoded.id]
    );
    
    if (admins.length === 0) {
      return res.status(401).json({ error: "Invalid admin credentials" });
    }

    req.admin = admins[0];
    next();
  } catch (err) {
    console.error('Admin token verification error:', err.message);
    
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Admin session expired' });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Malformed token' });
    }
    
    res.status(401).json({ error: 'Invalid token' });
  }
};

module.exports = authenticateAdmin;
