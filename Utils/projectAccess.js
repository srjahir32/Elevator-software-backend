const mongoose = require("mongoose");
const { User_Associate_With_Role, Roles } = require("../Models/User.model");

/** Admin and Supervisor — same gate as AMC create/edit for operational consistency. */
async function canManageProjects(req) {
  if (!req.auth?.id) return false;
  const userRole = await User_Associate_With_Role.findOne({
    user_id: new mongoose.Types.ObjectId(req.auth.id),
  });
  if (!userRole) return false;
  const role = await Roles.findOne({ id: userRole.role_id });
  if (!role) return false;
  const name = (role.name || "").toLowerCase();
  return name === "admin" || name === "supervisor";
}

module.exports = { canManageProjects };
