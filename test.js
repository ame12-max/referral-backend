const bcrypt = require('bcrypt');
const saltRounds = 10;
const hashedPassword = bcrypt.hashSync('12345678', saltRounds);
console.log(hashedPassword);