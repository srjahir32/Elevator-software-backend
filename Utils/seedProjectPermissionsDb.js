const { Permissions, Role_with_permission } = require("../Models/User.model");
const { isLegacyInstallationPermissionName } = require("../Data/legacyInstallationPermissionNames");

/** Must match Data/permissionModuleGroups.js → project.permissions */
const PROJECT_MODULE_PERMISSION_NAMES = [
  "View Project",
  "Add Project",
  "Edit Project",
  "Delete Project",
];

const SUPERVISOR_PROJECT_PERMISSION_NAMES = ["View Project", "Add Project", "Edit Project"];

/**
 * Inserts Project module permissions if missing; links Admin (1) and Supervisor (2).
 * @returns {Promise<{ created: Array, alreadyPresent: string[], supervisorLinksAdded: number }>}
 */
async function ensureProjectPermissionsInDb() {
  const created = [];
  const alreadyPresent = [];

  for (const permission_name of PROJECT_MODULE_PERMISSION_NAMES) {
    if (isLegacyInstallationPermissionName(permission_name)) {
      continue;
    }

    let doc = await Permissions.findOne({ permission_name });
    if (!doc) {
      const lastPermission = await Permissions.findOne().sort({ id: -1 });
      const newId = lastPermission ? lastPermission.id + 1 : 1;
      doc = await Permissions.create({
        id: newId,
        permission_name,
        status: 1,
      });
      created.push({ id: doc.id, permission_name: doc.permission_name });
    } else {
      alreadyPresent.push(permission_name);
    }

    const adminLink = await Role_with_permission.findOne({
      role_id: 1,
      permission_id: doc.id,
    });
    if (!adminLink) {
      await Role_with_permission.create({ role_id: 1, permission_id: doc.id });
    }
  }

  const supervisorPerms = await Permissions.find({
    permission_name: { $in: SUPERVISOR_PROJECT_PERMISSION_NAMES },
  });
  let supervisorLinksAdded = 0;
  for (const p of supervisorPerms) {
    const link = await Role_with_permission.findOne({
      role_id: 2,
      permission_id: p.id,
    });
    if (!link) {
      await Role_with_permission.create({ role_id: 2, permission_id: p.id });
      supervisorLinksAdded += 1;
    }
  }

  return { created, alreadyPresent, supervisorLinksAdded };
}

module.exports = {
  ensureProjectPermissionsInDb,
  PROJECT_MODULE_PERMISSION_NAMES,
};
