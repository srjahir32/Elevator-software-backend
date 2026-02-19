const jwt = require('jsonwebtoken');
const { ACCESS_TOKEN_KEY,REFERSH_TOKEN_KEY } = require('../config');

const sendToken = async (user) => {
  const token = jwt.sign(user, ACCESS_TOKEN_KEY, {
    expiresIn: '365d',
  });
  console.log("token", token);
  return { token, expiresin: '365d' };
};

const sendRefreshToken = async (user) => {
  console.log("REFERSH_TOKEN_KEY",ACCESS_TOKEN_KEY)
  const refresh_token = jwt.sign(user, ACCESS_TOKEN_KEY, {
    expiresIn: '365d',
  });
  console.log("refresh_token", refresh_token);
  return { refresh_token, expiresin: '365d' };
};

module.exports = { sendToken,sendRefreshToken };
