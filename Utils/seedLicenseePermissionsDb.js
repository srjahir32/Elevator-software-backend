const { Permissions, Role_with_permission } = require("../Models/User.model");
const { isLegacyInstallationPermissionName } = require("../Data/legacyInstallationPermissionNames");

/** Must match Data/permissionModuleGroups.js → licensee.permissions */
const LICENSEE_MODULE_PERMISSION_NAMES = [
  "View Licensee",
  "Create Licensee",
  "Renew Licensee",
  "Edit Licensee",
  "Delete Licensee",
];

/**
 * Inserts Licensee module permissions if missing; links Admin (1).
 * @returns {Promise<{ created: Array, alreadyPresent: string[] }>}
 */
async function ensureLicenseePermissionsInDb() {
  const created = [];
  const alreadyPresent = [];

  for (const permission_name of LICENSEE_MODULE_PERMISSION_NAMES) {
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

  return { created, alreadyPresent };
}

module.exports = {
  ensureLicenseePermissionsInDb,
  LICENSEE_MODULE_PERMISSION_NAMES,
};
