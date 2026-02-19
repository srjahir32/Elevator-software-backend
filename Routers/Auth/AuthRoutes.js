const { Router } = require("express");


const User = require('../../Models/User.model');
const { RegisterUser, LoginUser, GetProfile, UpdateProfile, GetAccessToken } = require("../../Controllers/Auth/Auth.controllers.js");



const AuthRouter = Router();

AuthRouter.post('/register', RegisterUser);
AuthRouter.post('/login', LoginUser);
AuthRouter.get('/get_profile', GetProfile);
AuthRouter.post('/update_profile_user', UpdateProfile);
AuthRouter.get('/get_access_token', GetAccessToken);

module.exports = AuthRouter;