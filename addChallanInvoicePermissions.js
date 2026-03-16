const mongoose = require('mongoose');
const dotenv = require('dotenv');
const { Permissions, Role_with_permission } = require('./Models/User.model');
const connectDB = require('./Models/Config/mongoose.config.js');

dotenv.config();

const NEW_PERMISSIONS = [
    { id: 84, permission_name: "View Challan" },
    { id: 85, permission_name: "Add Challan" },
    { id: 86, permission_name: "Edit Challan" },
    { id: 87, permission_name: "Delete Challan" },
    { id: 88, permission_name: "View Invoice" },
    { id: 89, permission_name: "Add Invoice" },
    { id: 90, permission_name: "Edit Invoice" },
    { id: 91, permission_name: "Delete Invoice" },
];

const ADMIN_ROLE_ID = 1;

async function addPermissions() {
    try {
        await connectDB();
        console.log('Connected to MongoDB');

        console.log('\nAdding Challan and Invoice permissions...');
        for (const permission of NEW_PERMISSIONS) {
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

        console.log('\nAssigning permissions to Admin role...');
        // Start after the last assignment
        const lastAssignment = await Role_with_permission.findOne().sort({ id: -1 });
        let assignmentId = (lastAssignment ? lastAssignment.id : 0) + 1;

        for (const permission of NEW_PERMISSIONS) {
            const existingAssignment = await Role_with_permission.findOne({
                role_id: ADMIN_ROLE_ID,
                permission_id: permission.id
            });

            if (existingAssignment) {
                console.log(`Permission "${permission.permission_name}" already assigned to Admin`);
            } else {
                await Role_with_permission.create({
                    id: assignmentId,
                    role_id: ADMIN_ROLE_ID,
                    permission_id: permission.id
                });
                console.log(`✓ Assigned "${permission.permission_name}" to Admin (Assignment ID: ${assignmentId})`);
                assignmentId++;
            }
        }

        console.log('\n✅ Challan and Invoice permissions added completely!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error updating permissions:', error);
        process.exit(1);
    }
}

addPermissions();
