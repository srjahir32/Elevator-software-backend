/** @deprecated For this repo, seed with `superadmin` MakeData instead — technician IDs are now 38–41. */
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const { Permissions, Role_with_permission } = require('./Models/User.model');
const connectDB = require('./Models/Config/mongoose.config.js');

dotenv.config();

const TECHNICIAN_PERMISSIONS = [
    { id: 92, permission_name: "View Technician" },
    { id: 93, permission_name: "Add Technician" },
    { id: 94, permission_name: "Edit Technician" },
    { id: 95, permission_name: "Delete Technician" },
];

const ADMIN_ROLE_ID = 1;

async function addTechnicianPermissions() {
    try {
        await connectDB();
        console.log('Connected to MongoDB');

        console.log('\nAdding Technician permissions...');
        for (const permission of TECHNICIAN_PERMISSIONS) {
            const existingPermission = await Permissions.findOne({
                $or: [
                    { id: permission.id },
                    { permission_name: permission.permission_name }
                ]
            });

            if (existingPermission) {
                console.log(`Permission "${permission.permission_name}" already exists (ID: ${existingPermission.id})`);
                if (existingPermission.id !== permission.id) {
                    await Permissions.findOneAndUpdate(
                        { permission_name: permission.permission_name },
                        { $set: { id: permission.id, status: 1 } },
                        { upsert: true, new: true }
                    );
                    console.log(`Updated permission ID to ${permission.id}`);
                }
            } else {
                await Permissions.create({
                    id: permission.id,
                    permission_name: permission.permission_name,
                    status: 1
                });
                console.log(`✓ Added permission: "${permission.permission_name}" (ID: ${permission.id})`);
            }
        }

        console.log('\nAssigning Technician permissions to Admin role...');

        for (const permission of TECHNICIAN_PERMISSIONS) {
            const existingAssignment = await Role_with_permission.findOne({
                role_id: ADMIN_ROLE_ID,
                permission_id: permission.id
            });

            if (existingAssignment) {
                console.log(`Permission "${permission.permission_name}" already assigned to Admin`);
            } else {
                const newAssignment = await Role_with_permission.create({
                    role_id: ADMIN_ROLE_ID,
                    permission_id: permission.id
                });
                console.log(`✓ Assigned "${permission.permission_name}" to Admin (Assignment ID: ${newAssignment._id})`);
            }
        }

        console.log('\n✅ Technician permissions added and assigned to Admin successfully!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error adding Technician permissions:', error);
        process.exit(1);
    }
}

addTechnicianPermissions();
