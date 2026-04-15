const mongoose = require("mongoose");
const {
  Users,
  User_Associate_With_Role,
  Roles,
  Role_with_permission,
  Permissions,
} = require("../Models/User.model");
const { isLegacyInstallationPermissionName } = require("../Data/legacyInstallationPermissionNames");
const { ErrorHandler } = require("./ResponseHandler");

/**
 * @returns {Promise<Set<string>|null>} null = Admin (all access), else permission names
 */
async function getUserAppPermissionSet(userId) {
  if (!userId) return new Set();
  const oid = new mongoose.Types.ObjectId(userId);
  const uar = await User_Associate_With_Role.findOne({ user_id: oid });
  if (!uar) return new Set();
  const role = await Roles.findOne({ id: uar.role_id });
  if (role && role.name === "Admin") return null;

  const links = await Role_with_permission.find({ role_id: uar.role_id }).lean();
  const user = await Users.findById(oid).select("extra_permissions").lean();
  const ids = new Set([
    ...links.map((l) => l.permission_id),
    ...((user && user.extra_permissions) || []),
  ]);
  const permDocs = await Permissions.find({ id: { $in: [...ids] } })
    .select("permission_name")
    .lean();
  const names = new Set();
  for (const p of permDocs) {
    if (p.permission_name && !isLegacyInstallationPermissionName(p.permission_name)) {
      names.add(p.permission_name);
    }
  }
  return names;
}

function requireAnyAppPermission(permissionNames) {
  return async (req, res, next) => {
    try {
      const set = await getUserAppPermissionSet(req.auth?.id);
      if (set === null) return next();
      const ok = permissionNames.some((n) => set.has(n));
      if (!ok) {
        return ErrorHandler(res, 403, "You do not have permission for this action");
      }
      return next();
    } catch (e) {
      console.error("[requireAnyAppPermission]", e);
      return ErrorHandler(res, 500, "Permission check failed");
    }
  };
}

module.exports = {
  getUserAppPermissionSet,
  requireAnyAppPermission,
};
