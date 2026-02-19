const mongoose = require('mongoose');
const bcrypt = require("bcrypt");
const { NUMBER } = require('sequelize');

/** User Schema */
const UserSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  email: {
    type: String,
    default: null,
  },
  contact_number: {
    type: String,
    default: null,
  },
  password: {
    type: String,
    required: true,
  },
  is_active: {
    type: Number,
    default: 1,
  },
}, {
  timestamps: true,
  versionKey: false,
});
UserSchema.pre("save", async function (next) {
  if (this.isModified("password")) { 
    this.password = await bcrypt.hash(this.password, 12);
  }
  next();
});
const Users = mongoose.model('users', UserSchema);



/** Roles Schema */
const RoleSchema = new mongoose.Schema({
  id:{
    type:Number,
    required: true,
  },
  name: {
    type: String,
    required: true,
  },
}, {
  versionKey: false,
});

const Roles = mongoose.model('roles', RoleSchema);

/** Permissions Schema */
const PermissionSchema = new mongoose.Schema({
   id:{
    type:Number,
    required: true,
  },
  permission_name: {
    type: String,
    required: true,
  },
  status: {
    type: Number,
    default: 0, // 1 for enable, 0 for disable
    allowNull: true,
  }
}, {
  versionKey: false,
});

const Permissions = mongoose.model('permissions', PermissionSchema);

/** User_Associate_With_Role Schema */
const UserRoleSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'users',
    required: true,
  },
  role_id: {
    type: Number,
    required: true,
  },
}, {
  versionKey: false,
});

const User_Associate_With_Role = mongoose.model('User_Associate_With_Role', UserRoleSchema);

/** Role_with_permission Schema */
const RolePermissionSchema = new mongoose.Schema({
  role_id: {
    type: Number,
    required: true,
  },
  permission_id: {
    type:Number,
    required: true,
  },
}, {
  versionKey: false,
});

const Role_with_permission = mongoose.model('Role_with_permission', RolePermissionSchema);





/** Export all models */
module.exports = {
  Users,
  Roles,
  Permissions,
  User_Associate_With_Role,
  Role_with_permission,
};
