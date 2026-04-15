/**
 * Removed from AMC-only product; stripped from DB (MakeData) and hidden from APIs if stale rows exist.
 * Note: "View/Add/Edit/Delete Project" are NOT listed here — they are active AMC base-layer permissions (ids 50–53).
 */
exports.LEGACY_INSTALLATION_PERMISSION_NAMES = [
  "Add Erector",
  "View Erector",
  "Edit Erector",
  "Delete Erector",
  "View Elevator",
  "Add Elevator",
  "Edit Elevator",
  "Delete Elevator",
  "View Pre Installation Steps",
  "Add Pre Installation Steps",
  "Edit Pre Installation Steps",
  "Delete Pre Installation Steps",
  "View Vender order",
  "Add Vender order",
  "Edit Vender order",
  "Delete Vender order",
  "View Delivery List",
  "Add Delivery List",
  "Edit Delivery List",
  "Delete Delivery List",
  "View QC",
  "Add QC",
  "Edit QC",
  "Delete QC",
  "View Payment",
  "Add Payment",
  "Edit Payment",
  "Delete Payment",
  "View Handover",
  "Add Handover",
  "Edit Handover",
  "Delete Handover",
  "View Mechanical Qc",
  "Add Mechanical Qc",
  "Edit Mechanical Qc",
  "Delete Mechanical Qc",
  "View Report",
  "Add Report",
  "Edit Report",
  "Delete Report",
  "View Vender list",
  "Add Vender list",
  "Edit Vender list",
  "Delete Vender list",
  "View Vender Order list",
  "View Erector list",
  "Add Erector list",
  "Edit Erector list",
  "Delete Erector list",
  "View Erector list (New)",
];

exports.isLegacyInstallationPermissionName = (name) => {
  const n = String(name || "").trim().toLowerCase();
  return exports.LEGACY_INSTALLATION_PERMISSION_NAMES.some(
    (x) => x.trim().toLowerCase() === n
  );
};
