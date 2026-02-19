const { Project } = require('../../Models/Project.model');
const { Users, User_Associate_With_Role, Roles } = require('../../Models/User.model');
const { ResponseOk, ErrorHandler } = require('../../Utils/ResponseHandler');
const { ActivityLog } = require('../../Models/Activitylog.model');
const mongoose = require("mongoose");
const bcrypt = require('bcryptjs');


const CreateProject = async (req, res) => {
  try {
    const {
      site_name,
      aggrement_no,
      aggrement_date,
      site_address,
      client_name,
      client_mobile,
      client_email,
      Site_Supervisor,
      gst_no,
      payment_amount,
      additional_notes,
      map_url,
      cash_amount_project,
      bank_amount_project,
      total_amount_project,
      payment_count_project,
      branch_id,
    } = req.body;

    if (
      !site_name || !site_address || !client_name ||
      !payment_amount || !Site_Supervisor || !map_url
    ) {
      return ErrorHandler(res, 200, "All required fields must be provided");
    }

    const project = await Project.create({
      site_name,
      aggrement_no,
      aggrement_date,
      site_address,
      client_name,
      client_mobile,
      client_email,
      Site_Supervisor,
      gst_no,
      payment_amount,
      additional_notes,
      map_url,
      cash_amount_project,
      bank_amount_project,
      total_amount_project,
      total_amount_project,
      payment_count_project,
      branch_id,
    });
    const user_details = await Users.findById(req.auth.id)
    await ActivityLog.create({
      user_id: req.auth?.id || null,
      user_name: user_details.name,
      action: 'ADD_PROJECT',
      type: 'Create',
      description: `${user_details.name} has created project named as ${site_name}.`,
      title: 'Project Added',
      project_id: project._id,
    });

    return ResponseOk(res, 201, "Project created successfully", project);
  } catch (error) {
    console.error("[CreateProject]", error);
    return ErrorHandler(res, 500, "Server error while creating project");
  }
};

const ViewProject = async (req, res) => {
  try {
    const {
      supervisor,
      fromDate,
      toDate,
      minPayment,
      maxPayment,
      minReceived,
      maxReceived,
      minRemaining,
      maxRemaining
    } = req.query;

    const matchStage = {};

    // Branch visibility logic
    if (req.auth && req.auth.id) {
      const userRole = await User_Associate_With_Role.findOne({
        user_id: new mongoose.Types.ObjectId(req.auth.id)
      });

      if (userRole) {
        const role = await Roles.findOne({ id: userRole.role_id });

        // If not Admin, enforce branch-based filtering
        if (role && role.name !== "Admin") {
          const { branchId } = req.query;
          if (branchId) {
            // Check if user is assigned to this branch
            const user = await Users.findById(req.auth.id);
            const isAssigned = user.branches.some(b => b.toString() === branchId);

            if (isAssigned) {
              matchStage.branch_id = new mongoose.Types.ObjectId(branchId);
            } else {
              return ErrorHandler(res, 403, "You are not assigned to this branch");
            }
          } else {
            // If no branchId provided, return projects for ALL assigned branches
            const user = await Users.findById(req.auth.id);
            matchStage.branch_id = { $in: user.branches };
          }
        } else if (req.query.branchId) {
          // Admins can filter by any branchId if provided
          matchStage.branch_id = new mongoose.Types.ObjectId(req.query.branchId);
        }
      }
    }

    if (supervisor) {
      matchStage.Site_Supervisor = supervisor;
    }

    if (fromDate || toDate) {
      matchStage.aggrement_date = {};
      if (fromDate) matchStage.aggrement_date.$gte = new Date(fromDate);
      if (toDate) matchStage.aggrement_date.$lte = new Date(toDate);
    }

    const projects = await Project.aggregate([
      {
        $lookup: {
          from: "paymententries",
          localField: "_id",
          foreignField: "project_id",
          as: "payment_details"
        }
      },
      {
        $addFields: {
          amount_received: {
            $sum: "$payment_details.payment_Made"
          },
        }
      },
      {
        $addFields: {
          amount_remaining: {
            $subtract: ["$payment_amount", "$amount_received"]
          },
          payment_progress: {
            $cond: [
              { $gt: ["$payment_amount", 0] },
              {
                $round: [
                  {
                    $multiply: [
                      { $divide: ["$amount_received", "$payment_amount"] },
                      100
                    ]
                  },
                  2
                ]
              },
              0
            ]
          }
        }
      },
      {
        $match: {
          ...matchStage,
          ...(minPayment || maxPayment
            ? {
              payment_amount: {
                ...(minPayment ? { $gte: Number(minPayment) } : {}),
                ...(maxPayment ? { $lte: Number(maxPayment) } : {})
              }
            }
            : {}),
          ...(minReceived || maxReceived
            ? {
              amount_received: {
                ...(minReceived ? { $gte: Number(minReceived) } : {}),
                ...(maxReceived ? { $lte: Number(maxReceived) } : {})
              }
            }
            : {}),
          ...(minRemaining || maxRemaining
            ? {
              amount_remaining: {
                ...(minRemaining ? { $gte: Number(minRemaining) } : {}),
                ...(maxRemaining ? { $lte: Number(maxRemaining) } : {})
              }
            }
            : {})
        }
      },
      {
        $project: {
          _id: 1,
          site_name: 1,
          aggrement_no: 1,
          aggrement_date: 1,
          site_address: 1,
          client_name: 1,
          client_mobile: 1,
          client_email: 1,
          gst_no: 1,
          Site_Supervisor: 1,
          status: 1,
          payment_amount: 1,
          amount_received: 1,
          amount_remaining: 1,
          payment_progress: 1,
          additional_notes: 1,
          map_url: 1,
          cash_amount_project: 1,
          bank_amount_project: 1,
          total_amount_project: 1,
          payment_count_project: 1,
        }
      }
    ]);

    if (!projects || projects.length === 0) {
      return ErrorHandler(res, 200, "No projects found");
    }

    return ResponseOk(res, 200, "Projects retrieved successfully", projects);
  } catch (error) {
    console.error("[ViewProject]", error);
    return ErrorHandler(res, 500, "Server error while retrieving projects");
  }
};

const UpdateProject = async (req, res) => {
  try {
    const projectId = req.query.projectId

    if (!projectId) {
      return ErrorHandler(res, 200, "Project ID is required");
    }

    const query = { _id: projectId };

    // Branch visibility logic for Authorization
    if (req.auth && req.auth.id) {
      const userRole = await User_Associate_With_Role.findOne({
        user_id: new mongoose.Types.ObjectId(req.auth.id),
      });

      if (userRole) {
        const role = await Roles.findOne({ id: userRole.role_id });
        if (role && role.name !== "Admin") {
          const user = await Users.findById(req.auth.id);
          query.branch_id = { $in: user.branches || [] };
        }
      }
    }

    const checkProject = await Project.findOne(query);
    if (!checkProject) {
      return ErrorHandler(res, 404, "Project not found or unauthorized to update");
    }

    const allowedFields = [
      "site_name",
      "aggrement_no",
      "aggrement_date",
      "site_address",
      "client_name",
      "client_mobile",
      "client_email",
      "Site_Supervisor",
      "gst_no",
      "payment_amount",
      "additional_notes",
      "map_url",
      "cash_amount_project",
      "bank_amount_project",
      "total_amount_project",
      "payment_count_project",
    ];

    const updateData = {};
    for (const key of allowedFields) {
      if (req.body[key] !== undefined) {
        updateData[key] = req.body[key];
      }
    }

    const updatedProject = await Project.findByIdAndUpdate(
      projectId,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    if (!updatedProject) {
      return ErrorHandler(res, 200, "Project not found");
    }

    const user_details = await Users.findById(req.auth.id)
    await ActivityLog.create({
      user_id: req.auth?.id || null,
      user_name: user_details.name,
      action: 'UPDATE_PROJECT',
      type: 'Update',
      description: `${user_details.name} has updated ${req.body.site_name} project .`,
      title: 'Project Updated',
      project_id: projectId,
    });
    return ResponseOk(res, 200, "Project updated successfully", updatedProject);
  } catch (error) {
    console.error("[UpdateProject]", error);
    return ErrorHandler(res, 500, "Server error while updating project");
  }
};

const ViewListOfSupervisors = async (req, res) => {
  try {
    const supervisors_Role = await User_Associate_With_Role.find({
      role_id: { $ne: 1 }
    });

    const userIds = supervisors_Role.map(entry => entry.user_id);

    const supervisors = await Users.find({ _id: { $in: userIds } });

    if (!supervisors || supervisors.length === 0) {
      return ErrorHandler(res, 200, "No supervisors found");
    }

    return ResponseOk(res, 200, "Supervisors retrieved successfully", supervisors);
  } catch (error) {
    console.error("error", error);
    return ErrorHandler(res, 500, "Server error while retrieving supervisors");
  }
};

// const GetProjectShortDetails = async (req, res) => {
//   try {
//     const {
//       supervisor,
//       fromDate,
//       toDate,
//       minPayment,
//       maxPayment,
//       minReceived,
//       maxReceived,
//       minRemaining,
//       maxRemaining
//     } = req.query;

//     const matchConditions = {};

//     if (supervisor) {
//       matchConditions.Site_Supervisor = supervisor;
//     }

//     if (fromDate || toDate) {
//       matchConditions.aggrement_date = {};
//       if (fromDate) matchConditions.aggrement_date.$gte = new Date(fromDate);
//       if (toDate) matchConditions.aggrement_date.$lte = new Date(toDate);
//     }

//     if (minPayment || maxPayment) {
//       matchConditions.payment_amount = {};
//       if (minPayment) matchConditions.payment_amount.$gte = Number(minPayment);
//       if (maxPayment) matchConditions.payment_amount.$lte = Number(maxPayment);
//     }

//     if (minReceived || maxReceived) {
//       matchConditions.amount_received = {};
//       if (minReceived) matchConditions.amount_received.$gte = Number(minReceived);
//       if (maxReceived) matchConditions.amount_received.$lte = Number(maxReceived);
//     }

//     if (minRemaining || maxRemaining) {
//       matchConditions.amount_remaining = {};
//       if (minRemaining) matchConditions.amount_remaining.$gte = Number(minRemaining);
//       if (maxRemaining) matchConditions.amount_remaining.$lte = Number(maxRemaining);
//     }

//     const pipeline = [
//       {
//         $lookup: {
//           from: "paymententries",
//           localField: "_id",
//           foreignField: "project_id",
//           as: "payment_details"
//         }
//       },
//       {
//         $addFields: {
//           amount_received: { $sum: "$payment_details.payment_Made" }
//         }
//       },
//       {
//         $addFields: {
//           amount_remaining: { $subtract: ["$payment_amount", "$amount_received"] },
//           payment_progress: {
//             $cond: [
//               { $gt: ["$payment_amount", 0] },
//               {
//                 $round: [
//                   { $multiply: [{ $divide: ["$amount_received", "$payment_amount"] }, 100] },
//                   2
//                 ]
//               },
//               0
//             ]
//           },
//            project_status: {
//             $cond: [{ $eq: ["$payment_amount", "$amount_received"] }, "Completed", "Due"]
//           }
//         }
//       },
//     ];

//     if (Object.keys(matchConditions).length > 0) {
//       pipeline.push({ $match: matchConditions });
//     }

//     pipeline.push({ $sort: { createdAt: -1 } });

//     pipeline.push({
//       $project: {
//         _id: 1,
//         site_name: 1,
//         aggrement_no: 1,
//         aggrement_date: 1,
//         site_address: 1,
//         client_name: 1,
//         client_mobile: 1,
//         client_email: 1,
//         Site_Supervisor: 1,
//         map_url: 1,
//         status: 1,
//         payment_amount: 1,
//         amount_received: 1,
//         amount_remaining: 1,
//         payment_progress: 1,
//         project_status:1
//       }
//     });

//     const projects = await Project.aggregate(pipeline);

//     if (!projects || projects.length === 0) {
//       return ErrorHandler(res, 200, "No projects found");
//     }

//     return ResponseOk(res, 200, "Projects retrieved successfully", projects);
//   } catch (error) {
//     console.error("Error in GetProjectShortDetails:", error);
//     return ErrorHandler(res, 500, "Failed to retrieve project short details", error);
//   }
// };


const GetProjectShortDetails = async (req, res) => {
  try {
    const {
      supervisor,
      fromDate,
      toDate,
      minPayment,
      maxPayment,
      minReceived,
      maxReceived,
      minRemaining,
      maxRemaining
    } = req.query;

    const matchConditions = {};

    // Branch visibility logic
    if (req.auth && req.auth.id) {
      const userRole = await User_Associate_With_Role.findOne({
        user_id: new mongoose.Types.ObjectId(req.auth.id)
      });

      if (userRole) {
        const role = await Roles.findOne({ id: userRole.role_id });

        // If not Admin, enforce branch-based filtering
        if (role && role.name !== "Admin") {
          const { branchId, supervisor: supervisorQuery } = req.query;

          if (branchId) {
            // Check if user is assigned to this branch
            const user = await Users.findById(req.auth.id);
            const isAssigned = user.branches.some(b => b.toString() === branchId);

            if (isAssigned) {
              matchConditions.branch_id = new mongoose.Types.ObjectId(branchId);
            } else {
              return ErrorHandler(res, 403, "You are not assigned to this branch");
            }
          } else {
            // If no branchId provided, return projects for ALL assigned branches
            const user = await Users.findById(req.auth.id);
            matchConditions.branch_id = { $in: user.branches };
          }
        } else if (req.query.branchId) {
          // Admins can filter by any branchId if provided
          matchConditions.branch_id = new mongoose.Types.ObjectId(req.query.branchId);
        }
      }
    }

    if (supervisor && !matchConditions.Site_Supervisor) {
      matchConditions.Site_Supervisor = supervisor;
    }

    if (fromDate || toDate) {
      matchConditions.aggrement_date = {};
      if (fromDate) matchConditions.aggrement_date.$gte = new Date(fromDate);
      if (toDate) matchConditions.aggrement_date.$lte = new Date(toDate);
    }

    if (minPayment || maxPayment) {
      matchConditions.payment_amount = {};
      if (minPayment) matchConditions.payment_amount.$gte = Number(minPayment);
      if (maxPayment) matchConditions.payment_amount.$lte = Number(maxPayment);
    }

    if (minReceived || maxReceived) {
      matchConditions.amount_received = {};
      if (minReceived) matchConditions.amount_received.$gte = Number(minReceived);
      if (maxReceived) matchConditions.amount_received.$lte = Number(maxReceived);
    }

    if (minRemaining || maxRemaining) {
      matchConditions.amount_remaining = {};
      if (minRemaining) matchConditions.amount_remaining.$gte = Number(minRemaining);
      if (maxRemaining) matchConditions.amount_remaining.$lte = Number(maxRemaining);
    }

    const pipeline = [
      {
        $lookup: {
          from: "paymententries",
          localField: "_id",
          foreignField: "project_id",
          as: "payment_details"
        }
      },
      {
        $lookup: {
          from: "elevators",
          localField: "_id",
          foreignField: "project_id",
          as: "elevator"
        }
      },
      {
        $addFields: {
          amount_received: { $sum: "$payment_details.payment_Made" },
          elevator_count: { $size: { $ifNull: ["$elevator", []] } }
        }
      },
      {
        $addFields: {
          amount_remaining: { $subtract: ["$payment_amount", "$amount_received"] },
          payment_progress: {
            $cond: [
              { $gt: ["$payment_amount", 0] },
              {
                $round: [
                  { $multiply: [{ $divide: ["$amount_received", "$payment_amount"] }, 100] },
                  2
                ]
              },
              0
            ]
          },
          project_status: {
            $cond: [{ $eq: ["$payment_amount", "$amount_received"] }, "Completed", "Due"]
          }
        }
      },
    ];

    if (Object.keys(matchConditions).length > 0) {
      pipeline.push({ $match: matchConditions });
    }

    pipeline.push({ $sort: { createdAt: -1 } });

    pipeline.push({
      $project: {
        _id: 1,
        site_name: 1,
        aggrement_no: 1,
        aggrement_date: 1,
        site_address: 1,
        client_name: 1,
        client_mobile: 1,
        client_email: 1,
        Site_Supervisor: 1,
        map_url: 1,
        status: 1,
        payment_amount: 1,
        amount_received: 1,
        amount_remaining: 1,
        payment_progress: 1,
        project_status: 1,
        elevator_count: 1,
        cash_amount_project: 1,
        bank_amount_project: 1,
        total_amount_project: 1,
        payment_count_project: 1,
      }
    });

    const projects = await Project.aggregate(pipeline);

    if (!projects || projects.length === 0) {
      return ErrorHandler(res, 200, "No projects found");
    }

    return ResponseOk(res, 200, "Projects retrieved successfully", projects);
  } catch (error) {
    console.error("Error in GetProjectShortDetails:", error);
    return ErrorHandler(res, 500, "Failed to retrieve project short details", error);
  }
};


const GetProjectDetailsById = async (req, res) => {
  try {
    const projectId = req.query.projectId

    if (!projectId) {
      return ErrorHandler(res, 200, "Project ID is required");
    }

    const query = { _id: projectId };

    // Branch visibility logic
    if (req.auth && req.auth.id) {
      const userRole = await User_Associate_With_Role.findOne({
        user_id: new mongoose.Types.ObjectId(req.auth.id),
      });

      if (userRole) {
        const role = await Roles.findOne({ id: userRole.role_id });
        if (role && role.name !== "Admin") {
          const user = await Users.findById(req.auth.id);
          query.branch_id = { $in: user.branches || [] };
        }
      }
    }

    const findProjectDetails = await Project.findOne(query);

    if (!findProjectDetails) {
      return ErrorHandler(res, 404, "Project not found or access denied");
    }

    return ResponseOk(res, 200, "Project details retrieved successfully", findProjectDetails);

  } catch (error) {
    return ErrorHandler(res, 500, "Failed to retrieve project details", error);
  }
}

const ViewProjectOverviewById = async (req, res) => {
  try {
    const {
      supervisor,
      fromDate,
      toDate,
      minPayment,
      maxPayment,
      minReceived,
      maxReceived,
      minRemaining,
      maxRemaining
    } = req.query;

    const matchStage = {};

    // Branch visibility logic (Consistency Check)
    if (req.auth && req.auth.id) {
      const userRole = await User_Associate_With_Role.findOne({
        user_id: new mongoose.Types.ObjectId(req.auth.id)
      });

      if (userRole) {
        const role = await Roles.findOne({ id: userRole.role_id });

        if (role && role.name !== "Admin") {
          const user = await Users.findById(req.auth.id);
          matchStage.branch_id = { $in: user.branches };
        }
      }
    }

    if (supervisor) {
      matchStage.Site_Supervisor = supervisor;
    }

    if (fromDate || toDate) {
      matchStage.aggrement_date = {};
      if (fromDate) matchStage.aggrement_date.$gte = new Date(fromDate);
      if (toDate) matchStage.aggrement_date.$lte = new Date(toDate);
    }

    const projects = await Project.aggregate([
      {
        $match: {
          ...matchStage,
          _id: new mongoose.Types.ObjectId(req.query.projectId)
        }
      },
      {
        $lookup: {
          from: "paymententries",
          localField: "_id",
          foreignField: "project_id",
          as: "payment_details"
        }
      },
      {
        $addFields: {
          amount_received: {
            $sum: "$payment_details.payment_Made"
          },
        },
      },
      {
        $addFields: {
          amount_remaining: {
            $subtract: ["$payment_amount", "$amount_received"]
          },
          payment_progress: {
            $cond: [
              { $gt: ["$payment_amount", 0] },
              {
                $round: [
                  {
                    $multiply: [
                      { $divide: ["$amount_received", "$payment_amount"] },
                      100
                    ]
                  },
                  2
                ]
              },
              0
            ]
          },
          project_status: {
            $cond: [{ $eq: ["$payment_amount", "$amount_received"] }, "Completed", "Due"]
          }
        }
      },
      {
        $match: {
          ...matchStage,
          ...(minPayment || maxPayment
            ? {
              payment_amount: {
                ...(minPayment ? { $gte: Number(minPayment) } : {}),
                ...(maxPayment ? { $lte: Number(maxPayment) } : {})
              }
            }
            : {}),
          ...(minReceived || maxReceived
            ? {
              amount_received: {
                ...(minReceived ? { $gte: Number(minReceived) } : {}),
                ...(maxReceived ? { $lte: Number(maxReceived) } : {})
              }
            }
            : {}),
          ...(minRemaining || maxRemaining
            ? {
              amount_remaining: {
                ...(minRemaining ? { $gte: Number(minRemaining) } : {}),
                ...(maxRemaining ? { $lte: Number(maxRemaining) } : {})
              }
            }
            : {})
        }
      },
      {
        $project: {
          _id: 1,
          site_name: 1,
          aggrement_no: 1,
          aggrement_date: 1,
          site_address: 1,
          client_name: 1,
          client_mobile: 1,
          client_email: 1,
          gst_no: 1,
          Site_Supervisor: 1,
          status: 1,
          payment_amount: 1,
          amount_received: 1,
          amount_remaining: 1,
          payment_progress: 1,
          additional_notes: 1,
          project_status: 1,
          map_url: 1,
          cash_amount_project: 1,
          bank_amount_project: 1,
          total_amount_project: 1,
          payment_count_project: 1,
        }
      }
    ]);

    if (!projects || projects.length === 0) {
      return ErrorHandler(res, 200, "No projects found");
    }

    return ResponseOk(res, 200, "Projects retrieved successfully", projects);
  } catch (error) {
    console.error("[ViewProject]", error);
    return ErrorHandler(res, 500, "Server error while retrieving projects");
  }
};

const DeleteProject = async (req, res) => {
  try {
    const { projectId } = req.query;
    const { password } = req.body;

    const query = { _id: projectId };

    // Branch visibility logic for Authorization
    if (!projectId || !password) {
      return ErrorHandler(res, 200, "Password and Project ID are required");
    }

    if (req.auth && req.auth.id) {
      const userRole = await User_Associate_With_Role.findOne({
        user_id: new mongoose.Types.ObjectId(req.auth.id),
      });

      if (userRole) {
        const role = await Roles.findOne({ id: userRole.role_id });
        if (role && role.name !== "Admin") {
          const user = await Users.findById(req.auth.id);
          query.branch_id = { $in: user.branches || [] };
        }
      }
    }

    const project = await Project.findOne(query);

    if (!project) {
      return ErrorHandler(res, 404, "Project not found or unauthorized to delete");
    }

    const email = req.auth.email;
    const user = await Users.findOne({
      $or: [
        email ? { email } : null
      ].filter(Boolean)
    });

    if (!user) {
      return ErrorHandler(res, 200, 'User not found');
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return ErrorHandler(res, 200, 'Invalid password');
    }

    let deletedProject;
    if (match) {
      deletedProject = await Project.findByIdAndDelete(projectId);
    }

    if (!deletedProject) {
      return ErrorHandler(res, 200, "Project not found");
    }

    const site_name = deletedProject.site_name || 'Unknown Project';

    const user_details = await Users.findById(req.auth.id)
    await ActivityLog.create({
      user_id: req.auth?.id || null,
      user_name: user_details.name,
      action: 'DELETE_PROJECT',
      type: 'Delete',
      description: `${user_details.name} has deleted ${projectDetails.site_name} project .`,
      title: 'Project Deleted',
      project_id: projectId,
    });

    return ResponseOk(res, 200, "Project deleted successfully", deletedProject);
  } catch (error) {
    console.error("[DeleteProject]", error);
    return ErrorHandler(res, 500, "Server error while deleting project");
  }
};


module.exports = {
  CreateProject,
  ViewProject,
  UpdateProject,
  ViewListOfSupervisors,
  GetProjectShortDetails,
  GetProjectDetailsById,
  ViewProjectOverviewById,
  DeleteProject
};
