const { ErrorHandler, ResponseOk } = require("../../Utils/ResponseHandler");
const mongoose = require("mongoose");
const { ActivityLog } = require("../../Models/Activitylog.model");
const { Project } = require("../../Models/Project.model");
const { Users, User_Associate_With_Role, Roles } = require('../../Models/User.model');

// const GetAllActivityLogs = async (req, res) => {
//   try {
//     const activityLogs = await ActivityLog.find().sort({ createdAt: -1 });;

//     if (!activityLogs || activityLogs.length === 0) {
//       return ErrorHandler(res, 404, "No activity logs found");
//     }
//     return ResponseOk(res, 200, "Activity Logs Retrieved successfully", activityLogs);
//   } catch (error) {
//     console.log("error", error);
//     return ErrorHandler(res, 500, "Server error while retrieving acitivity logs");
//   }
// };

const GetAllActivityLogs = async (req, res) => {
  try {
    // 🔒 Build role-based filter → find which projects the user can see
    let logFilter = {};

    if (req.auth && req.auth.id) {
      const userRole = await User_Associate_With_Role.findOne({
        user_id: new mongoose.Types.ObjectId(req.auth.id),
      });

      if (userRole) {
        const role = await Roles.findOne({ id: userRole.role_id });

        // If not Admin, filter by user's assigned branches
        if (role && role.name !== "Admin") {
          const user = await Users.findById(req.auth.id);
          if (user && user.branches && user.branches.length > 0) {
            const allowedProjectIds = await Project.find({
              branch_id: { $in: user.branches },
            }).distinct("_id");

            // If user has no projects in their branches, short-circuit with "no logs"
            if (allowedProjectIds.length === 0) {
              return ErrorHandler(res, 404, "No activity logs found");
            }

            logFilter.project_id = { $in: allowedProjectIds };
          } else {
            // User has no branches assigned, return no logs
            return ErrorHandler(res, 404, "No activity logs found");
          }
        }
      }
    }

    const activityLogs = await ActivityLog.find(logFilter)
      .sort({ createdAt: -1 })
      .lean();

    if (!activityLogs || activityLogs.length === 0) {
      return ErrorHandler(res, 404, "No activity logs found");
    }

    return ResponseOk(res, 200, "Activity Logs Retrieved successfully", activityLogs);
  } catch (error) {
    console.log("error", error);
    return ErrorHandler(res, 500, "Server error while retrieving acitivity logs");
  }
};

const GetAllActivityLogsByProjectId = async (req, res) => {
  try {
    const activityLogs = await ActivityLog.find({ project_id: req.query.project_id }).sort({ createdAt: -1 });

    if (!activityLogs || activityLogs.length === 0) {
      return ErrorHandler(res, 404, "No activity logs found");
    }
    return ResponseOk(res, 200, "Activity Logs Retrieved successfully", activityLogs);
  } catch (error) {
    console.log("error", error);
    return ErrorHandler(res, 500, "Server error while retrieving acitivity logs");
  }
};

// const GetAllActivityLogsDashboard = async (req, res) => {
//   try {
//     const page = parseInt(req.query.page) || 1;
//     const limit = parseInt(req.query.limit) || 10;
//     const skip = (page - 1) * limit;

//     if (page < 1 || limit < 1 || limit > 100) {
//       return ErrorHandler(res, 400, "Invalid pagination parameters. Page must be >= 1, limit must be between 1 and 100");
//     }

//     const totalCount = await ActivityLog.countDocuments();

//     const activityLogs = await ActivityLog.find()
//       .sort({ createdAt: -1 })
//       .skip(skip)
//       .limit(limit)
//       .lean(); 
//     if (!activityLogs || activityLogs.length === 0) {
//       return ErrorHandler(res, 200, "No activity logs found");
//     }

//     const projectIds = activityLogs.map(log => log.project_id).filter(id => id);
//     const projects = await Project.find({ _id: { $in: projectIds } })
//       .select('_id site_name')
//       .lean();

//     const projectMap = projects.reduce((acc, project) => {
//       acc[project._id.toString()] = project.site_name;
//       return acc;
//     }, {});

//     const enrichedActivityLogs = activityLogs.map(log => ({
//       ...log,
//       project_name: projectMap[log.project_id?.toString()] || null
//     }));

//     const totalPages = Math.ceil(totalCount / limit);
//     const hasNextPage = page < totalPages;
//     const hasPrevPage = page > 1;

//     const paginationInfo = {
//       currentPage: page,
//       totalPages: totalPages,
//       totalItems: totalCount,
//       itemsPerPage: limit,
//       hasNextPage: hasNextPage,
//       hasPrevPage: hasPrevPage,
//       nextPage: hasNextPage ? page + 1 : null,
//       prevPage: hasPrevPage ? page - 1 : null
//     };

//     const response = {
//       activityLogs: enrichedActivityLogs,
//       // pagination: paginationInfo
//     };

//     return ResponseOk(res, 200, "Activity Logs Retrieved successfully", enrichedActivityLogs);
//   } catch (error) {
//     console.error("error", error);
//     return ErrorHandler(res, 500, "Server error while retrieving activity logs");
//   }
// };


// Reuse the same role-based restriction you used earlier
async function getRoleBasedProjectIds(req) {
  // If the user is a Supervisor, return only their project IDs.
  // Otherwise (no role / not Supervisor), return null to indicate "no restriction".
  let match = {};

  if (req.auth && req.auth.id) {
    const userRole = await User_Associate_With_Role.findOne({
      user_id: new mongoose.Types.ObjectId(req.auth.id),
    });

    if (userRole) {
      const role = await Roles.findOne({ id: userRole.role_id });
      const isAdmin = role && role.name === "Admin";

      if (!isAdmin) {
        const user = await Users.findById(req.auth.id);
        if (user) {
          // If not admin, restrict by their assigned branches
          match.branch_id = { $in: user.branches || [] };
        }
      } else {
        // If Admin and branchId is passed in the request (handled in caller), it's applied there.
        // For Admin with no branchId, we return null to see all.
      }
    }
  }

  // If no restriction, return null (caller won’t filter by project)
  if (Object.keys(match).length === 0) {
    return null;
  }

  // Get only the project IDs the user can see
  const projectIds = await Project.find(match).distinct("_id");
  return projectIds;
}

const GetAllActivityLogsDashboard = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);
    const skip = (page - 1) * limit;

    // 🔒 Determine which projects this user is allowed to see
    const allowedProjectIds = await getRoleBasedProjectIds(req);

    const branchId = req.query.branchId;
    let finalProjectMatch = {};

    if (allowedProjectIds) {
      finalProjectMatch._id = { $in: allowedProjectIds };
    }

    if (branchId) {
      finalProjectMatch.branch_id = new mongoose.Types.ObjectId(branchId);
    }

    // Get the IDs after applying both role-based and branch-based filters
    const projectIds = await Project.find(finalProjectMatch).distinct("_id");

    // Build the ActivityLog filter
    const logFilter = {};
    if (projectIds.length === 0 && (allowedProjectIds !== null || branchId)) {
      // User has no projects matching the filters → return empty
      return ResponseOk(res, 200, "No activity logs found", []);
    }

    if (projectIds.length > 0) {
      logFilter.project_id = { $in: projectIds };
    }
    // else if projectIds is empty and NO restriction (isAdmin & no branchId), see all logs

    // Count with the same filter
    const totalCount = await ActivityLog.countDocuments(logFilter);

    // Fetch logs
    const activityLogs = await ActivityLog.find(logFilter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    if (!activityLogs || activityLogs.length === 0) {
      return ErrorHandler(res, 200, "No activity logs found");
    }

    // Enrich with project name (only for the projects we have in the page)
    const projectIdsOnPage = activityLogs
      .map(l => l.project_id)
      .filter(Boolean);

    const projects = await Project.find({ _id: { $in: projectIdsOnPage } })
      .select("_id site_name")
      .lean();

    const projectMap = projects.reduce((acc, p) => {
      acc[p._id.toString()] = p.site_name;
      return acc;
    }, {});

    const enrichedActivityLogs = activityLogs.map(log => ({
      ...log,
      project_name: projectMap[log.project_id?.toString()] || null,
    }));

    // If you want to return pagination meta, uncomment and include it
    // const totalPages = Math.ceil(totalCount / limit);
    // const pagination = {
    //   currentPage: page,
    //   totalPages,
    //   totalItems: totalCount,
    //   itemsPerPage: limit,
    //   hasNextPage: page < totalPages,
    //   hasPrevPage: page > 1,
    //   nextPage: page < totalPages ? page + 1 : null,
    //   prevPage: page > 1 ? page - 1 : null,
    // };

    return ResponseOk(
      res,
      200,
      "Activity Logs Retrieved successfully",
      enrichedActivityLogs
      // { activityLogs: enrichedActivityLogs, pagination }
    );
  } catch (error) {
    console.error("GetAllActivityLogsDashboard error", error);
    return ErrorHandler(res, 500, "Server error while retrieving activity logs");
  }
};

module.exports = {
  GetAllActivityLogs,
  GetAllActivityLogsByProjectId,
  GetAllActivityLogsDashboard
}