/**
 * UI grouping for permissions — must match names in Data/Permisssion_To_Role.js (AMC scope only).
 */
exports.permissionModuleGroups = {
  dashboard: {
    name: "Dashboard",
    permissions: ["View Dashboard"],
  },
  /** AMC base layer — must exist in DB (seed UI button or `node seedProjectPermissions.js`) */
  project: {
    name: "Projects",
    permissions: ["View Project", "Add Project", "Edit Project", "Delete Project"],
  },
  user: {
    name: "User Management",
    permissions: ["View User", "Add User", "Edit User", "Delete User"],
  },
  roles: {
    name: "Roles",
    permissions: [
      "View Roles",
      "Add Roles",
      "Edit Roles",
      "Delete Roles",
      "View Role",
      "Add Role",
      "Edit Role",
      "Delete Role",
    ],
  },
  permission: {
    name: "Permission",
    permissions: [
      "View Permissions",
      "Add Permissions",
      "Edit Permissions",
      "Delete Permissions",
      "View Permission",
      "Add Permission",
      "Edit Permission",
      "Delete Permission",
    ],
  },
  activityLog: {
    name: "Activity Log",
    permissions: [
      "View Activity log",
      "Add Activity log",
      "Edit Activity log",
      "Delete Activity log",
    ],
  },
  notification: {
    name: "Notification",
    permissions: [
      "View Notification list",
      "Add Notification list",
      "Edit Notification list",
      "Delete Notification list",
    ],
  },
  branch: {
    name: "Branch",
    permissions: ["View Branch", "Add Branch", "Edit Branch", "Delete Branch"],
  },
  amc: {
    name: "AMC Contracts",
    permissions: ["View AMC", "Add AMC", "Edit AMC", "Delete AMC"],
  },
  challan: {
    name: "Delivery Challans",
    permissions: ["View Challan", "Add Challan", "Edit Challan", "Delete Challan"],
  },
  invoice: {
    name: "Invoices",
    permissions: ["View Invoice", "Add Invoice", "Edit Invoice", "Delete Invoice"],
  },
  quotation: {
    name: "Quotations",
    permissions: [
      "View Quotation",
      "Add Quotation",
      "Edit Quotation",
      "Delete Quotation",
      "Convert Quotation",
    ],
  },
  complaint: {
    name: "Complaints",
    permissions: ["View Complaint", "Add Complaint", "Edit Complaint", "Delete Complaint"],
  },
  services: {
    name: "Services",
    permissions: ["View Service", "Add Service", "Edit Service", "Delete Service"],
  },
  licensee: {
    name: "Licensee",
    permissions: [
      "View Licensee",
      "Create Licensee",
      "Renew Licensee",
      "Edit Licensee",
      "Delete Licensee",
    ],
  },
};
