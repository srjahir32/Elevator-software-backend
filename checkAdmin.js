const mongoose = require('mongoose');
const dotenv = require('dotenv');
const { Roles, Users, User_Associate_With_Role, Permissions, Role_with_permission } = require('./Models/User.model');
const connectDB = require('./Models/Config/mongoose.config.js');

dotenv.config();

async function checkAdmin() {
    try {
        await connectDB();
        console.log('Connected to MongoDB');

        const roles = await Roles.find({});
        console.log('\nRoles:');
        roles.forEach(r => console.log(`- ${r.name} (ID: ${r.id})`));

        const adminRole = await Roles.findOne({ name: /admin/i });
        if (!adminRole) {
            console.log('\nNo Admin role found!');
        } else {
            console.log(`\nFound Admin role: ${adminRole.name} (ID: ${adminRole.id})`);

            const adminPermissions = await Role_with_permission.find({ role_id: adminRole.id });
            console.log(`Admin has ${adminPermissions.length} permissions assigned.`);

            const adminUsers = await User_Associate_With_Role.find({ role_id: adminRole.id }).populate('user_id');
            console.log(`\nUsers with Admin role:`);
            adminUsers.forEach(au => {
                if (au.user_id) {
                    console.log(`- ${au.user_id.name} (${au.user_id.email})`);
                }
            });
        }

        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

checkAdmin();
