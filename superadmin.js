const bcrypt = require('bcrypt');
const { RolesData } = require('./Data/Roles');
const { PermissionsData } = require('./Data/Permisssion_To_Role');
const { Roles, Permissions , Role_with_permission,Users,User_Associate_With_Role} = require('./Models/User.model');
const { StaticData } = require('./Data/StaticData');
const { Static_Data_Schema } = require('./Models/StaticData.model')
const {PermissionRolesData} = require('./Data/Permisssion_To_Role')
const { Status_Type } = require('./Models/Status.model');
const { Status_types_Data } = require('./Data/StatusData');

exports.MakeData = async () => {
  try {
    //Roles
    await Promise.all(
      RolesData.map(async (role) => {
        await Roles.findOneAndUpdate(
          { name: role.name },
          { $set: { id: role.id , name: role.name } },
          { upsert: true, new: true }
        );
      })
    );

    //Permissions
    await Promise.all(
      PermissionsData.map(async (permission) => {
        await Permissions.findOneAndUpdate(
          { permission_name: permission.permission_name },
          { $set: { id: permission.id , permission_name: permission.permission_name } },
          { upsert: true, new: true }
        );
      })
    );

    //static data
    await Promise.all(
      StaticData.map(async (data) => {
        
        await Static_Data_Schema.findOneAndUpdate(
          { data_name: data.data_name, type: data.type },
          { $set: { id: data.id ,data_name: data.data_name, type: data.type } },
          { upsert: true, new: true }
        );
      })
    );

    //Permission to Role
    await Promise.all(
  PermissionRolesData.map(async (data) => {
    await Role_with_permission.findOneAndUpdate(
      {
        role_id: data.role_id,
        permission_id: data.permission_id,
      },
      {
        $set: {
          id:data.id,
          role_id: data.role_id,
          permission_id: data.permission_id,
        },
      },
      {
        upsert: true,
        new: true,
      }
    );
  })
);

    console.log('RolePermission count:', PermissionRolesData.length);

    //Status Types
    await Promise.all(
      Status_types_Data.map(async (status) => {
        await Status_Type.findOneAndUpdate(
          { id: status.id },
          { $set: { id: status.id, data_name: status.dataname } },
          { upsert: true, new: true }
        );
      })
    );


  // Create a superadmin user with role
async function createUserWithRole(email, password,full_name,contact_number) {
  try {
    const existingUser = await Users.findOne({
                $or: [
                    email ? { email } : null,
                ].filter(Boolean)
            });    
  
    if (existingUser) {
      console.log(`User with email ${email} already exists.`);
      return;
    }
    const hashedPassword = await bcrypt.hash(password, 10); 
    const newUser = await Users.create({
      name: full_name,
      email,
      password,
      contact_number
    });
    const UserWithRole = await User_Associate_With_Role.create({
      role_id:1,
      user_id:newUser.id,
    })

    console.log('User created successfully:', newUser.email);
  } catch (err) {
    console.error('Error creating user:', err.message);
  }
}
await createUserWithRole('avadhadmin@yopmail.com', 'avadh@419','Superadmin','1234567890');

    console.log('Database seeding completed successfully');
  } catch (error) {
    console.error('Error seeding database:', error);
    throw error;
  }
};