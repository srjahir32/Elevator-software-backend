require("dotenv").config();
const mongoose = require("mongoose");
const { Permissions, Role_with_permission } = require("../Models/User.model");

async function run() {
  await mongoose.connect(process.env.DB_URI);

  const permission = await Permissions.findOneAndUpdate(
    { id: 43 },
    {
      $setOnInsert: { id: 43, permission_name: "Add Payment" },
      $set: { status: 1 },
    },
    { upsert: true, new: true }
  );

  await Role_with_permission.updateOne(
    { role_id: 1, permission_id: 43 },
    { $set: { role_id: 1, permission_id: 43 } },
    { upsert: true }
  );

  const assigned = await Role_with_permission.exists({ role_id: 1, permission_id: 43 });
  console.log(
    `Admin permission assigned: ${Boolean(assigned)} | Permission: ${permission.permission_name}`
  );
}

run()
  .then(async () => {
    await mongoose.disconnect();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("Failed to assign permission:", error);
    try {
      await mongoose.disconnect();
    } catch (_) {}
    process.exit(1);
  });
