/**
 * One-time / ops: add Project permissions to MongoDB so they appear in Manage Role.
 *
 *   cd avadh-amc-backend
 *   node seedProjectPermissions.js
 *
 * Requires MONGO_URI in .env (same as the API).
 */
require("dotenv").config();
const connectDB = require("./Models/Config/mongoose.config.js");
const { ensureProjectPermissionsInDb } = require("./Utils/seedProjectPermissionsDb");

async function main() {
  await connectDB();
  console.log("MongoDB connected.");

  const { created, alreadyPresent, supervisorLinksAdded } = await ensureProjectPermissionsInDb();

  console.log("\n--- Project permissions ---");
  if (created.length) {
    console.log("Created:", created);
  } else {
    console.log("Created: (none — all four names already existed)");
  }
  console.log("Already in DB:", alreadyPresent.length ? alreadyPresent : "(none)");
  console.log("New Supervisor (role 2) links added:", supervisorLinksAdded);
  console.log("\nDone. Refresh Manage Role in the browser.\n");

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
