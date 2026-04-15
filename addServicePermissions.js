/**
 * Inserts Service permissions (ids 46–49) and role links to match Data/Permisssion_To_Role.js.
 * Run from avadh-amc-backend: node addServicePermissions.js
 * (or npm run add-service-permissions)
 */
const dotenv = require('dotenv');
const { Permissions, Role_with_permission } = require('./Models/User.model');
const connectDB = require('./Models/Config/mongoose.config.js');

dotenv.config();

/** Canonical ids — keep in sync with Data/Permisssion_To_Role.js */
const SERVICE_PERMISSIONS = [
  { id: 46, permission_name: 'View Service' },
  { id: 47, permission_name: 'Add Service' },
  { id: 48, permission_name: 'Edit Service' },
  { id: 49, permission_name: 'Delete Service' },
];

const ADMIN_ROLE_ID = 1;
const SUPERVISOR_ROLE_ID = 2;
const TECHNICIAN_ROLE_ID = 3;

/** Same as SUPERVISOR_PERMISSION_IDS service subset in Permisssion_To_Role.js */
const SUPERVISOR_SERVICE_IDS = [46, 47, 48];
/** Technician: view service visits only */
const TECHNICIAN_SERVICE_IDS = [46];

async function ensurePermissionRow(p) {
  const existing = await Permissions.findOne({
    $or: [{ id: p.id }, { permission_name: p.permission_name }],
  });

  if (existing) {
    console.log(
      `Permission "${p.permission_name}" already exists (ID: ${existing.id})`,
    );
    if (existing.id !== p.id) {
      await Permissions.findOneAndUpdate(
        { permission_name: p.permission_name },
        { $set: { id: p.id, status: 1 } },
        { new: true },
      );
      console.log(`Updated permission ID to ${p.id}`);
    }
    return;
  }

  await Permissions.create({
    id: p.id,
    permission_name: p.permission_name,
    status: 1,
  });
  console.log(`✓ Added permission: "${p.permission_name}" (ID: ${p.id})`);
}

async function ensureRoleLink(roleId, permissionId) {
  const existing = await Role_with_permission.findOne({
    role_id: roleId,
    permission_id: permissionId,
  });
  if (existing) return false;
  await Role_with_permission.create({
    role_id: roleId,
    permission_id: permissionId,
  });
  return true;
}

async function addServicePermissions() {
  try {
    await connectDB();
    console.log('Connected to MongoDB');

    console.log('\nAdding Service permissions (46–49)...');
    for (const p of SERVICE_PERMISSIONS) {
      await ensurePermissionRow(p);
    }

    console.log('\nLinking permissions to Admin (all four)...');
    for (const p of SERVICE_PERMISSIONS) {
      const added = await ensureRoleLink(ADMIN_ROLE_ID, p.id);
      if (added) {
        console.log(`✓ Admin ← "${p.permission_name}" (${p.id})`);
      } else {
        console.log(`Admin already has "${p.permission_name}"`);
      }
    }

    console.log('\nLinking to Supervisor (View / Add / Edit Service)...');
    for (const id of SUPERVISOR_SERVICE_IDS) {
      const added = await ensureRoleLink(SUPERVISOR_ROLE_ID, id);
      const name = SERVICE_PERMISSIONS.find((x) => x.id === id).permission_name;
      if (added) console.log(`✓ Supervisor ← "${name}" (${id})`);
      else console.log(`Supervisor already has "${name}"`);
    }

    console.log('\nLinking to Technician (View Service only)...');
    for (const id of TECHNICIAN_SERVICE_IDS) {
      const added = await ensureRoleLink(TECHNICIAN_ROLE_ID, id);
      const name = SERVICE_PERMISSIONS.find((x) => x.id === id).permission_name;
      if (added) console.log(`✓ Technician ← "${name}" (${id})`);
      else console.log(`Technician already has "${name}"`);
    }

    console.log('\n✅ Service permissions and role links are up to date.');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error adding Service permissions:', error);
    process.exit(1);
  }
}

addServicePermissions();
