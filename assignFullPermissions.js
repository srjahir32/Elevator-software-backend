const mongoose = require('mongoose');
const dotenv = require('dotenv');
const { Permissions, Role_with_permission } = require('./Models/User.model');
const connectDB = require('./Models/Config/mongoose.config.js');

dotenv.config();

const ADMIN_ROLE_ID = 1;

async function assignFullPermissions() {
    try {
        await connectDB();
        console.log('Connected to MongoDB');

        const allPermissions = await Permissions.find({});
        console.log(`\nFound ${allPermissions.length} total permissions in DB.`);

        let newAssignments = 0;
        let existingAssignments = 0;

        for (const permission of allPermissions) {
            const existing = await Role_with_permission.findOne({
                role_id: ADMIN_ROLE_ID,
                permission_id: permission.id
            });

            if (existing) {
                existingAssignments++;
            } else {
                await Role_with_permission.create({
                    role_id: ADMIN_ROLE_ID,
                    permission_id: permission.id
                });
                console.log(`✓ Assigned "${permission.permission_name}" (ID: ${permission.id}) to Admin`);
                newAssignments++;
            }
        }

        console.log(`\n✅ Finished!`);
        console.log(`- New assignments: ${newAssignments}`);
        console.log(`- Already assigned: ${existingAssignments}`);

        process.exit(0);
    } catch (error) {
        console.error('❌ Error assigning permissions:', error);
        process.exit(1);
    }
}

assignFullPermissions();
