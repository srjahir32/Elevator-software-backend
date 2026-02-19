require('dotenv').config();
exports.ACCESS_TOKEN_KEY = process.env.ACCESS_TOKEN_KEY; 
exports.REFRESH_TOKEN_KEY = process.env.REFRESH_TOKEN_KEY;
exports.JWT_SECRET = process.env.JWT_SECRET;
exports.MONGO_URL =  process.env.MONGO_URL