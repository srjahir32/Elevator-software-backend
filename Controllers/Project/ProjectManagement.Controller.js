const mongoose = require("mongoose");
const { Project, Elevators } = require("../../Models/Project.model");
const { AMC } = require("../../Models/AMC.model");
const { Users, User_Associate_With_Role, Roles } = require("../../Models/User.model");
const { ResponseOk, ErrorHandler } = require("../../Utils/ResponseHandler");
const { ActivityLog } = require("../../Models/Activitylog.model");
const { canManageProjects } = require("../../Utils/projectAccess");

const LIFT_DEFAULTS = {
  type_of_elevator: "Passenger",
  passenger_capacity: "—",
  speed: "—",
  opening_type: "—",
  lift_well_width: 0,
  lift_well_depth: 0,
  car_enclouser_type: "—",
  car_flooring_type: "—",
  car_door_type: "—",
  landing_door_type: "—",
  clear_opening_height: 0,
  clear_opening_width: 0,
  false_ceiling: "—",
  ms_door_frames: "—",
  ard_system: false,
  overload_sensor: false,
  telephone: false,
  fan_blower: "—",
  lop_cop: "—",
  files: [],
  status: 0,
};

function normalizeEmailList(raw) {
  if (raw == null) return [];
  const arr = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,;\n]+/) : [];
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    const e = String(x || "")
      .trim()
      .toLowerCase();
    if (!e || seen.has(e)) continue;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out;
}

function buildElevatorPayload(projectId, lift) {
  const title = String(lift.title || lift.elevator_name || "").trim();
  const floorsNum = Math.max(1, Math.floor(Number(lift.no_of_floors) || 1));
  const floors = String(floorsNum);
  const maker = String(lift.lift_maker || "").trim();
  const op = lift.operation_type === "Manual" ? "Manual" : "Automatic";
  return {
    ...LIFT_DEFAULTS,
    project_id: projectId,
    elevator_name: title,
    operation_type: op,
    no_of_floors: floors,
    stops: floors,
    lift_maker: maker || null,
    notes: maker ? `Lift maker: ${maker}` : "",
  };
}

async function assertProjectBranchAccess(req, projectDoc) {
  if (!req.auth?.id) return false;
  const userRole = await User_Associate_With_Role.findOne({
    user_id: new mongoose.Types.ObjectId(req.auth.id),
  });
  if (!userRole) return false;
  const role = await Roles.findOne({ id: userRole.role_id });
  if (!role) return false;
  if ((role.name || "") === "Admin") return true;
  const user = await Users.findById(req.auth.id);
  const branches = user?.branches || [];
  const bid = projectDoc.branch_id;
  if (!bid) return true;
  return branches.some((b) => String(b) === String(bid));
}

/**
 * POST /project/pm
 * Body: site_name, aggrement_no?, site_address?, city?, area?, client_name, client_mobile?, client_email(s)?, client_emails?, branch_id?, lifts[]
 */
const createPmProject = async (req, res) => {
  try {
    const ok = await canManageProjects(req);
    if (!ok) {
      return ErrorHandler(res, 403, "Only Admin and Supervisor can manage projects");
    }

    const {
      site_name,
      project_name,
      aggrement_no,
      site_address,
      address,
      city,
      area,
      client_name,
      client_mobile,
      client_email,
      client_emails,
      branch_id,
      lifts,
      original_project_id,
    } = req.body || {};

    const name = String(site_name || project_name || "").trim();
    const client = String(client_name || "").trim();
    const liftList = Array.isArray(lifts) ? lifts : [];

    if (!name) {
      return ErrorHandler(res, 400, "Project name is required");
    }
    if (!client) {
      return ErrorHandler(res, 400, "Client name is required");
    }
    if (liftList.length < 1) {
      return ErrorHandler(res, 400, "At least one lift is required");
    }

    for (let i = 0; i < liftList.length; i++) {
      const L = liftList[i];
      const t = String(L?.title || L?.elevator_name || "").trim();
      if (!t) {
        return ErrorHandler(res, 400, `Lift ${i + 1}: title is required`);
      }
      const floors = Number(L?.no_of_floors);
      if (!Number.isFinite(floors) || floors < 1) {
        return ErrorHandler(res, 400, `Lift ${i + 1}: number of floors must be at least 1`);
      }
      if (L?.operation_type && L.operation_type !== "Automatic" && L.operation_type !== "Manual") {
        return ErrorHandler(res, 400, `Lift ${i + 1}: operation type must be Automatic or Manual`);
      }
    }

    const userRoleAdminCheck = await User_Associate_With_Role.findOne({
      user_id: new mongoose.Types.ObjectId(req.auth.id),
    });
    const roleAdminCheck = userRoleAdminCheck ? await Roles.findOne({ id: userRoleAdminCheck.role_id }) : null;
    const isAdminRequest = roleAdminCheck && roleAdminCheck.name === "Admin";
    if (isAdminRequest) {
      const b = branch_id;
      if (
        b == null ||
        b === "" ||
        b === "null" ||
        b === "undefined" ||
        !mongoose.Types.ObjectId.isValid(String(b))
      ) {
        return ErrorHandler(res, 400, "branch_id is required");
      }
    }

    const emails = normalizeEmailList(client_emails?.length ? client_emails : client_email);
    const primaryEmail = emails[0] || (client_email ? String(client_email).trim() : null) || null;

    const addr = String(site_address || address || "").trim();
    let branchObjectId = null;
    if (branch_id && branch_id !== "null" && branch_id !== "undefined") {
      branchObjectId = new mongoose.Types.ObjectId(branch_id);
      const userRole = await User_Associate_With_Role.findOne({
        user_id: new mongoose.Types.ObjectId(req.auth.id),
      });
      if (userRole) {
        const role = await Roles.findOne({ id: userRole.role_id });
        if (role && role.name !== "Admin") {
          const user = await Users.findById(req.auth.id);
          const allowed = (user?.branches || []).some((b) => String(b) === String(branch_id));
          if (!allowed) {
            return ErrorHandler(res, 403, "You are not assigned to the selected branch");
          }
        }
      }
    }

    const project = await Project.create({
      site_name: name,
      aggrement_no: aggrement_no != null ? String(aggrement_no).trim() || null : null,
      site_address: addr,
      city: city != null ? String(city).trim() || null : null,
      area: area != null ? String(area).trim() || null : null,
      client_name: client,
      client_mobile: client_mobile != null ? String(client_mobile).trim() || null : null,
      client_email: primaryEmail,
      client_emails: emails,
      payment_amount: 0,
      Site_Supervisor: "—",
      map_url: "",
      branch_id: branchObjectId,
      original_project_id: original_project_id || null,
      project_flow: "pm",
    });

    const createdLifts = [];
    for (const lift of liftList) {
      const doc = new Elevators(buildElevatorPayload(project._id, lift));
      createdLifts.push(await doc.save());
    }

    const user_details = await Users.findById(req.auth.id);
    await ActivityLog.create({
      user_id: req.auth?.id || null,
      user_name: user_details?.name,
      action: "ADD_PROJECT_PM",
      type: "Create",
      description: `${user_details?.name || "User"} created project (PM) "${name}" with ${createdLifts.length} lift(s).`,
      title: "Project Added",
      project_id: project._id,
    });

    return ResponseOk(res, 201, "Project created successfully", {
      project,
      lifts: createdLifts,
    });
  } catch (error) {
    console.error("[createPmProject]", error);
    return ErrorHandler(res, 500, "Server error while creating project");
  }
};

/**
 * GET /project/pm_details?projectId=
 */
const getPmProjectDetails = async (req, res) => {
  try {
    const projectId = req.query.projectId;
    if (!projectId) {
      return ErrorHandler(res, 400, "projectId is required");
    }

    const project = await Project.findById(projectId).lean();
    if (!project) {
      return ErrorHandler(res, 404, "Project not found");
    }

    const allowed = await assertProjectBranchAccess(req, project);
    if (!allowed) {
      return ErrorHandler(res, 403, "Project not found or access denied");
    }

    const lifts = await Elevators.find({ project_id: projectId }).sort({ createdAt: 1 }).lean();

    return ResponseOk(res, 200, "OK", { project, lifts });
  } catch (error) {
    console.error("[getPmProjectDetails]", error);
    return ErrorHandler(res, 500, "Server error while loading project");
  }
};

/**
 * PUT /project/pm
 * Query: projectId
 * Body: same fields as create + lifts[] (use _id on lift to update)
 */
const updatePmProject = async (req, res) => {
  try {
    const ok = await canManageProjects(req);
    if (!ok) {
      return ErrorHandler(res, 403, "Only Admin and Supervisor can manage projects");
    }

    const projectId = req.query.projectId;
    if (!projectId) {
      return ErrorHandler(res, 400, "projectId is required");
    }

    const project = await Project.findById(projectId);
    if (!project) {
      return ErrorHandler(res, 404, "Project not found");
    }

    const allowed = await assertProjectBranchAccess(req, project);
    if (!allowed) {
      return ErrorHandler(res, 403, "Project not found or access denied");
    }

    const {
      site_name,
      project_name,
      aggrement_no,
      site_address,
      address,
      city,
      area,
      client_name,
      client_mobile,
      client_email,
      client_emails,
      branch_id,
      lifts,
      original_project_id,
    } = req.body || {};

    const liftList = Array.isArray(lifts) ? lifts : null;
    if (liftList && liftList.length < 1) {
      return ErrorHandler(res, 400, "At least one lift is required");
    }

    const name = site_name != null || project_name != null ? String(site_name || project_name || "").trim() : null;
    const client = client_name != null ? String(client_name || "").trim() : null;

    if (name !== null && !name) {
      return ErrorHandler(res, 400, "Project name is required");
    }
    if (client !== null && !client) {
      return ErrorHandler(res, 400, "Client name is required");
    }

    if (liftList) {
      for (let i = 0; i < liftList.length; i++) {
        const L = liftList[i];
        const t = String(L?.title || L?.elevator_name || "").trim();
        if (!t) {
          return ErrorHandler(res, 400, `Lift ${i + 1}: title is required`);
        }
        const floors = Number(L?.no_of_floors);
        if (!Number.isFinite(floors) || floors < 1) {
          return ErrorHandler(res, 400, `Lift ${i + 1}: number of floors must be at least 1`);
        }
        if (L?.operation_type && L.operation_type !== "Automatic" && L.operation_type !== "Manual") {
          return ErrorHandler(res, 400, `Lift ${i + 1}: operation type must be Automatic or Manual`);
        }
      }
    }

    if (name) project.site_name = name;
    if (aggrement_no !== undefined) project.aggrement_no = String(aggrement_no || "").trim() || null;
    if (site_address !== undefined || address !== undefined) {
      project.site_address = String(site_address || address || "").trim();
    }
    if (city !== undefined) project.city = String(city || "").trim() || null;
    if (area !== undefined) project.area = String(area || "").trim() || null;
    if (client) project.client_name = client;
    if (client_mobile !== undefined) project.client_mobile = String(client_mobile || "").trim() || null;
    if (original_project_id !== undefined) project.original_project_id = original_project_id || null;

    const body = req.body || {};
    if (Object.prototype.hasOwnProperty.call(body, "client_emails") || Object.prototype.hasOwnProperty.call(body, "client_email")) {
      const emails = normalizeEmailList(
        Object.prototype.hasOwnProperty.call(body, "client_emails") && body.client_emails != null
          ? body.client_emails
          : body.client_email
      );
      project.client_emails = emails;
      project.client_email =
        emails[0] || (body.client_email ? String(body.client_email).trim() : null) || null;
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, "branch_id")) {
      const bid = req.body.branch_id;
      if (!bid || bid === "null" || bid === "undefined") {
        project.branch_id = null;
      } else {
        const userRole = await User_Associate_With_Role.findOne({
          user_id: new mongoose.Types.ObjectId(req.auth.id),
        });
        if (userRole) {
          const role = await Roles.findOne({ id: userRole.role_id });
          if (role && role.name !== "Admin") {
            const user = await Users.findById(req.auth.id);
            const allowedBranch = (user?.branches || []).some((b) => String(b) === String(bid));
            if (!allowedBranch) {
              return ErrorHandler(res, 403, "You are not assigned to the selected branch");
            }
          }
        }
        project.branch_id = new mongoose.Types.ObjectId(bid);
      }
    }

    const userRoleSaveCheck = await User_Associate_With_Role.findOne({
      user_id: new mongoose.Types.ObjectId(req.auth.id),
    });
    const roleSaveCheck = userRoleSaveCheck ? await Roles.findOne({ id: userRoleSaveCheck.role_id }) : null;
    if (roleSaveCheck && roleSaveCheck.name === "Admin" && !project.branch_id) {
      return ErrorHandler(res, 400, "branch_id is required");
    }

    await project.save();

    let finalLifts = await Elevators.find({ project_id: projectId }).sort({ createdAt: 1 }).lean();

    if (liftList) {
      const existing = await Elevators.find({ project_id: projectId });
      const incomingIds = new Set(
        liftList.map((l) => (l._id ? String(l._id) : null)).filter(Boolean)
      );

      for (const ex of existing) {
        const idStr = String(ex._id);
        if (!incomingIds.has(idStr)) {
          const inAmc = await AMC.countDocuments({ elevator_ids: ex._id });
          if (inAmc > 0) {
            return ErrorHandler(
              res,
              400,
              `Cannot remove lift "${ex.elevator_name}" because it is linked to an AMC contract`
            );
          }
          await Elevators.findByIdAndDelete(ex._id);
        }
      }

      for (const lift of liftList) {
        const payload = buildElevatorPayload(project._id, lift);
        if (lift._id) {
          const el = await Elevators.findOne({ _id: lift._id, project_id: project._id });
          if (!el) {
            return ErrorHandler(res, 400, "Invalid lift id for this project");
          }
          el.elevator_name = payload.elevator_name;
          el.operation_type = payload.operation_type;
          el.no_of_floors = payload.no_of_floors;
          el.stops = payload.stops;
          el.lift_maker = payload.lift_maker;
          el.notes = payload.notes;
          await el.save();
        } else {
          const doc = new Elevators(payload);
          await doc.save();
        }
      }

      finalLifts = await Elevators.find({ project_id: projectId }).sort({ createdAt: 1 }).lean();
    }

    const user_details = await Users.findById(req.auth.id);
    await ActivityLog.create({
      user_id: req.auth?.id || null,
      user_name: user_details?.name,
      action: "UPDATE_PROJECT_PM",
      type: "Update",
      description: `${user_details?.name || "User"} updated project (PM) "${project.site_name}".`,
      title: "Project Updated",
      project_id: project._id,
    });

    const refreshed = await Project.findById(projectId).lean();
    return ResponseOk(res, 200, "Project updated successfully", {
      project: refreshed,
      lifts: finalLifts,
    });
  } catch (error) {
    console.error("[updatePmProject]", error);
    return ErrorHandler(res, 500, "Server error while updating project");
  }
};

const deletePmProject = async (req, res) => {
  try {
    const ok = await canManageProjects(req);
    if (!ok) {
        return ErrorHandler(res, 403, "Only Admin and Supervisor can manage projects");
    }
    const projectId = req.query.projectId;
    if (!projectId) {
      return ErrorHandler(res, 400, "projectId is required");
    }

    const project = await Project.findById(projectId);
    if (!project) {
        return ErrorHandler(res, 404, "Project not found");
    }

    const allowed = await assertProjectBranchAccess(req, project);
    if (!allowed) {
        return ErrorHandler(res, 403, "Project not found or access denied");
    }

    // Optional: Check if project is linked to AMC or other critical record
    const hasAmc = await AMC.findOne({ project_id: projectId });
    if (hasAmc) {
        return ErrorHandler(res, 400, "Cannot delete project linked to an active AMC contract");
    }

    await Elevators.deleteMany({ project_id: projectId });
    await Project.findByIdAndDelete(projectId);

    const user_details = await Users.findById(req.auth.id);
    await ActivityLog.create({
      user_id: req.auth?.id || null,
      user_name: user_details?.name,
      action: "DELETE_PROJECT_PM",
      type: "Delete",
      description: `${user_details?.name || "User"} deleted project (PM) "${project.site_name}".`,
      title: "Project Deleted",
      project_id: project._id,
    });

    return ResponseOk(res, 200, "Project deleted successfully");
  } catch (error) {
    console.error("[deletePmProject]", error);
    return ErrorHandler(res, 500, "Server error while deleting project");
  }
};

module.exports = {
  createPmProject,
  getPmProjectDetails,
  updatePmProject,
  deletePmProject,
};
