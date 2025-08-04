const jwt = require('jsonwebtoken');

const authenticateUser = (req, res, next) => {
  console.log('Incoming Headers:', req.headers); // Log headers for debugging
  
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    console.error('Authorization header missing');
    return res.status(401).json({ error: 'Authorization header missing' });
  }

  if (!authHeader.startsWith('Bearer ')) {
    console.error('Invalid authorization format:', authHeader);
    return res.status(401).json({ error: 'Authorization header must start with "Bearer "' });
  }

  const token = authHeader.split(' ')[1];
  
  if (!token) {
    console.error('Token not found in authorization header');
    return res.status(401).json({ error: 'Token not found in authorization header' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'yourSecretKey');
    
    if (!decoded.id) {
      console.error('Invalid token payload - missing user ID');
      return res.status(401).json({ error: 'Invalid token payload: Missing user ID' });
    }
    
    console.log('✅ Token verified for user ID:', decoded.id);
    req.user = { id: decoded.id };
    next();
  } catch (err) {
    console.error('❌ JWT Verification Error:', err.message);
    
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Malformed token' });
    }
    
    res.status(401).json({ error: 'Invalid token' });
  }
};

module.exports = { authenticateUser };