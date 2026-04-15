/**
 * One-time / ops: add Licensee permissions to MongoDB so they appear in Manage Role.
 *
 *   cd avadh-amc-backend
 *   node seedLicenseePermissions.js
 *
 * Requires MONGO_URI in .env (same as the API).
 */
require("dotenv").config();
const connectDB = require("./Models/Config/mongoose.config.js");
const { ensureLicenseePermissionsInDb } = require("./Utils/seedLicenseePermissionsDb");

async function main() {
  await connectDB();
  console.log("MongoDB connected.");

  const { created, alreadyPresent } = await ensureLicenseePermissionsInDb();

  console.log("\n--- Licensee permissions ---");
  if (created.length) {
    console.log("Created:", created);
  } else {
    console.log("Created: (none — all names already existed)");
  }
  console.log("Already in DB:", alreadyPresent.length ? alreadyPresent : "(none)");
  console.log("\nDone. Refresh Manage Role in the browser.\n");

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
