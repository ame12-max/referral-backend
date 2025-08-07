const bcrypt = require('bcrypt');
const db = require('./config/db');

async function createAdmin() {
  const phone = '1234567890'; // Replace with your admin phone
  const password = 'admin123'; // Replace with your admin password
  const fullName = 'Admin User';
  
  try {
    // Hash password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    
    // Create admin
    const [result] = await db.query(
      `INSERT INTO admins (phone, password, full_name, role)
       VALUES (?, ?, ?, 'superadmin')`,
      [phone, hashedPassword, fullName]
    );
    
    console.log(`✅ Admin created successfully! ID: ${result.insertId}`);
  } catch (err) {
    console.error('❌ Error creating admin:', err.message);
  }
}

createAdmin();