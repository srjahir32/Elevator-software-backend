const mongoose = require('mongoose');
const dotenv = require('dotenv');
const { Permissions, Role_with_permission } = require('./Models/User.model');
const connectDB = require('./Models/Config/mongoose.config.js');

dotenv.config();

async function checkPermissions() {
    try {
        await connectDB();
        const totalPerms = await Permissions.countDocuments();
        const adminPerms = await Role_with_permission.countDocuments({ role_id: 1 });

        console.log(`Total Permissions in DB: ${totalPerms}`);
        console.log(`Permissions assigned to Admin (Role 1): ${adminPerms}`);

        const unassigned = await Permissions.aggregate([
            {
                $lookup: {
                    from: 'role_with_permissions',
                    localField: 'id',
                    foreignField: 'permission_id',
                    as: 'assigned'
                }
            },
            {
                $match: {
                    'assigned.role_id': { $ne: 1 }
                }
            }
        ]);

        console.log(`\nPermissions NOT assigned to Admin:`);
        unassigned.forEach(p => console.log(`- ${p.permission_name} (ID: ${p.id})`));

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
checkPermissions();
