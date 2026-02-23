const mongoose = require('mongoose');
const dotenv = require('dotenv');
const { Permissions, Role_with_permission } = require('./Models/User.model');
const connectDB = require('./Models/Config/mongoose.config.js');

// Load environment variables
// For production, you can set MONGO_URI environment variable directly
dotenv.config();

// Check if MONGO_URI is provided via environment variable (for production)
if (process.env.MONGO_URI) {
  console.log('Using MONGO_URI from environment variable');
}

const AMC_PERMISSIONS = [
  { id: 80, permission_name: "View AMC" },
  { id: 81, permission_name: "Add AMC" },
  { id: 82, permission_name: "Edit AMC" },
  { id: 83, permission_name: "Delete AMC" },
];

const ADMIN_ROLE_ID = 1;

async function addAMCPermissions() {
  try {
    // Connect to database
    await connectDB();
    console.log('Connected to MongoDB');

    // Add permissions
    console.log('\nAdding AMC permissions...');
    for (const permission of AMC_PERMISSIONS) {
      const existingPermission = await Permissions.findOne({ 
        $or: [
          { id: permission.id },
          { permission_name: permission.permission_name }
        ]
      });

      if (existingPermission) {
        console.log(`Permission "${permission.permission_name}" already exists (ID: ${existingPermission.id})`);
        
        // Update if ID doesn't match
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

    // Assign permissions to Admin role
    console.log('\nAssigning AMC permissions to Admin role...');
    let assignmentId = 124; // Starting ID for role-permission assignments
    
    for (const permission of AMC_PERMISSIONS) {
      const existingAssignment = await Role_with_permission.findOne({
        role_id: ADMIN_ROLE_ID,
        permission_id: permission.id
      });

      if (existingAssignment) {
        console.log(`Permission "${permission.permission_name}" already assigned to Admin`);
      } else {
        // Find the last assignment ID to avoid conflicts
        const lastAssignment = await Role_with_permission.findOne()
          .sort({ id: -1 })
          .exec();
        
        if (lastAssignment && lastAssignment.id >= assignmentId) {
          assignmentId = lastAssignment.id + 1;
        }

        await Role_with_permission.create({
          id: assignmentId,
          role_id: ADMIN_ROLE_ID,
          permission_id: permission.id
        });
        console.log(`✓ Assigned "${permission.permission_name}" to Admin (Assignment ID: ${assignmentId})`);
        assignmentId++;
      }
    }

    console.log('\n✅ AMC permissions added and assigned to Admin successfully!');
    console.log('\nSummary:');
    console.log('- View AMC (ID: 80)');
    console.log('- Add AMC (ID: 81)');
    console.log('- Edit AMC (ID: 82)');
    console.log('- Delete AMC (ID: 83)');
    console.log('\nAll permissions have been assigned to Admin role (role_id: 1)');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error adding AMC permissions:', error);
    process.exit(1);
  }
}

// Run the script
addAMCPermissions();

