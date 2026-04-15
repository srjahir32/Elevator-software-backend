const { Permissions, Role_with_permission, Users } = require('../Models/User.model');
const { LEGACY_INSTALLATION_PERMISSION_NAMES } = require('./legacyInstallationPermissionNames');

/** Removes legacy installation-era permissions from DB, role links, and user extra_permissions. */
async function purgeLegacyInstallationPermissionsFromDb() {
  const legacyDocs = await Permissions.find({
    permission_name: { $in: LEGACY_INSTALLATION_PERMISSION_NAMES },
  }).lean();

  if (!legacyDocs.length) return 0;

  const legacyIds = legacyDocs.map((d) => d.id);
  await Role_with_permission.deleteMany({ permission_id: { $in: legacyIds } });

  for (const id of legacyIds) {
    await Users.updateMany({}, { $pull: { extra_permissions: id } });
  }

  await Permissions.deleteMany({ permission_name: { $in: LEGACY_INSTALLATION_PERMISSION_NAMES } });
  return legacyDocs.length;
}

module.exports = { purgeLegacyInstallationPermissionsFromDb };
