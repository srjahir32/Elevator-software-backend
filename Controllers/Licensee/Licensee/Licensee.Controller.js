const mongoose = require("mongoose");
const { Licensee } = require("../../Models/Licensee.model");
const { Project, Elevators } = require("../../Models/Project.model");
const { Users, User_Associate_With_Role, Roles } = require("../../Models/User.model");
const { ActivityLog } = require("../../Models/Activitylog.model");
const { ResponseOk, ErrorHandler } = require("../../Utils/ResponseHandler");
const { TZ, ymdInIST } = require("../../Utils/dashboardTime");
const { mongoDateKeys } = require("../AMC/AMCDashboardStats");

const PERMS = {
  VIEW: "View Licensee",
  CREATE: "Create Licensee",
  EDIT: "Edit Licensee",
  DELETE: "Delete Licensee",
  RENEW: "Renew Licensee",
};

/** Mongo `{ field: null }` matches missing or null — use for “not superseded” / current chain head */
const CURRENT_HEAD_FILTER = { superseded_by_license_id: null };

async function buildBranchMatchForLicensee(req, branchIdRaw, res) {
  const cleanBranchId =
    branchIdRaw && branchIdRaw !== "null" && branchIdRaw !== "undefined" ? String(branchIdRaw) : null;
  const matchStage = {};
  if (req.auth && req.auth.id) {
    const userRole = await User_Associate_With_Role.findOne({
      user_id: new mongoose.Types.ObjectId(req.auth.id),
    });
    if (userRole) {
      const role = await Roles.findOne({ id: userRole.role_id });
      if (role && role.name !== "Admin") {
        if (cleanBranchId) {
          const user = await Users.findById(req.auth.id);
          const isAssigned = user.branches.some((b) => b.toString() === cleanBranchId);
          if (isAssigned) {
            matchStage.branch_id = new mongoose.Types.ObjectId(cleanBranchId);
          } else {
            return { error: ErrorHandler(res, 403, "You are not assigned to this branch") };
          }
        } else {
          const user = await Users.findById(req.auth.id);
          matchStage.branch_id = { $in: user.branches || [] };
        }
      } else if (cleanBranchId) {
        matchStage.branch_id = new mongoose.Types.ObjectId(cleanBranchId);
      }
    }
  }
  return { matchStage, cleanBranchId };
}

async function assertElevatorInProject(elevatorId, projectId) {
  if (!mongoose.Types.ObjectId.isValid(elevatorId) || !mongoose.Types.ObjectId.isValid(projectId)) {
    return false;
  }
  const el = await Elevators.findOne({
    _id: elevatorId,
    project_id: projectId,
  }).lean();
  return Boolean(el);
}

async function getUserName(req) {
  if (!req.auth?.id) return "User";
  const u = await Users.findById(req.auth.id).select("name").lean();
  return u?.name || "User";
}

function mapRowOut(row) {
  return {
    _id: row._id,
    branch_id: row.branch_id,
    project_id: row.project_id,
    elevator_id: row.elevator_id,
    license_number: row.license_number,
    license_start_date: row.license_start_date,
    license_end_date: row.license_end_date,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    superseded_by_license_id: row.superseded_by_license_id ?? null,
    replaced_license_id: row.replaced_license_id ?? null,
    superseded_at: row.superseded_at ?? null,
    project_name: row.project?.site_name || "—",
    lift_name: row.elevator?.elevator_name || "—",
    status: row.status,
    is_historical: Boolean(row.superseded_by_license_id),
  };
}

const ListLicensees = async (req, res) => {
  try {
    const {
      search,
      project_id,
      status,
      endDateFrom,
      endDateTo,
      branchId,
      page = 1,
      limit = 50,
      sortBy = "license_end_date",
      sortOrder = "desc",
      latestOnly = "1",
    } = req.query;

    const useLatestPerLift = String(latestOnly).toLowerCase() !== "0" && String(latestOnly).toLowerCase() !== "false";

    const branchRes = await buildBranchMatchForLicensee(req, branchId, res);
    if (branchRes.error) return branchRes.error;
    const { matchStage } = branchRes;

    if (project_id && mongoose.Types.ObjectId.isValid(project_id)) {
      matchStage.project_id = new mongoose.Types.ObjectId(project_id);
    }

    const { todayKey } = await mongoDateKeys();

    const pipeline = [{ $match: matchStage }];

    pipeline.push(
      {
        $lookup: {
          from: "projects",
          localField: "project_id",
          foreignField: "_id",
          as: "project",
        },
      },
      { $unwind: { path: "$project", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "elevators",
          localField: "elevator_id",
          foreignField: "_id",
          as: "elevator",
        },
      },
      { $unwind: { path: "$elevator", preserveNullAndEmptyArrays: true } }
    );

    if (search && String(search).trim()) {
      const rx = new RegExp(String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      pipeline.push({
        $match: {
          $or: [{ license_number: rx }, { "project.site_name": rx }, { "elevator.elevator_name": rx }],
        },
      });
    }

    pipeline.push(
      {
        $addFields: {
          startYmd: {
            $dateToString: { format: "%Y-%m-%d", date: "$license_start_date", timezone: TZ },
          },
          endYmd: {
            $dateToString: { format: "%Y-%m-%d", date: "$license_end_date", timezone: TZ },
          },
        },
      },
      {
        $addFields: {
          status: {
            $switch: {
              branches: [
                { case: { $lt: [todayKey, "$startYmd"] }, then: "Upcoming" },
                { case: { $gt: [todayKey, "$endYmd"] }, then: "Expired" },
              ],
              default: "Active",
            },
          },
        },
      }
    );

    if (status && status !== "all" && ["Active", "Expired", "Upcoming"].includes(status)) {
      pipeline.push({ $match: { status } });
    }

    if (endDateFrom || endDateTo) {
      const exprAnd = [];
      if (endDateFrom) {
        exprAnd.push({ $gte: ["$endYmd", String(endDateFrom)] });
      }
      if (endDateTo) {
        exprAnd.push({ $lte: ["$endYmd", String(endDateTo)] });
      }
      if (exprAnd.length) {
        pipeline.push({ $match: { $expr: { $and: exprAnd } } });
      }
    }

    if (useLatestPerLift) {
      pipeline.push({ $match: CURRENT_HEAD_FILTER });
      pipeline.push({ $sort: { createdAt: -1 } });
      pipeline.push({
        $group: {
          _id: { project_id: "$project_id", elevator_id: "$elevator_id" },
          row: { $first: "$$ROOT" },
        },
      });
      pipeline.push({ $replaceRoot: { newRoot: "$row" } });
    }

    const sortFieldMap = {
      project_name: "project.site_name",
      lift_name: "elevator.elevator_name",
      license_number: "license_number",
      start_date: "license_start_date",
      end_date: "license_end_date",
      status: "status",
      createdAt: "createdAt",
      license_end_date: "license_end_date",
    };
    const sortKey = sortFieldMap[sortBy] || "license_end_date";
    const dir = String(sortOrder).toLowerCase() === "asc" ? 1 : -1;
    pipeline.push({ $sort: { [sortKey]: dir } });

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    pipeline.push({
      $facet: {
        total: [{ $count: "n" }],
        data: [{ $skip: (pageNum - 1) * limitNum }, { $limit: limitNum }],
      },
    });

    const agg = await Licensee.aggregate(pipeline);
    const facet = agg[0] || { total: [], data: [] };
    const total = facet.total[0]?.n || 0;
    const rows = (facet.data || []).map((row) => mapRowOut(row));

    return ResponseOk(res, 200, "License records", {
      data: rows,
      page: pageNum,
      limit: limitNum,
      total,
      latestOnly: useLatestPerLift,
    });
  } catch (e) {
    console.error("[ListLicensees]", e);
    return ErrorHandler(res, 500, "Failed to list license records");
  }
};

const GetLicenseeById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return ErrorHandler(res, 400, "Invalid id");
    }
    const branchRes = await buildBranchMatchForLicensee(req, req.query.branchId, res);
    if (branchRes.error) return branchRes.error;
    const { matchStage } = branchRes;
    const q = { _id: id, ...matchStage };
    const doc = await Licensee.findOne(q).lean();
    if (!doc) {
      return ErrorHandler(res, 404, "License record not found");
    }
    const [project, elevator] = await Promise.all([
      Project.findById(doc.project_id).select("site_name branch_id").lean(),
      Elevators.findById(doc.elevator_id).select("elevator_name project_id").lean(),
    ]);
    const { todayKey } = await mongoDateKeys();
    const startStr = doc.license_start_date ? ymdInIST(new Date(doc.license_start_date)) : "";
    const endStr = doc.license_end_date ? ymdInIST(new Date(doc.license_end_date)) : "";
    let computed = "Active";
    if (todayKey < startStr) computed = "Upcoming";
    else if (todayKey > endStr) computed = "Expired";

    const heads = await Licensee.find({
      project_id: doc.project_id,
      elevator_id: doc.elevator_id,
      ...CURRENT_HEAD_FILTER,
    })
      .select("_id createdAt")
      .lean();
    const head =
      heads.length === 0
        ? null
        : heads.reduce((best, h) => {
            if (!best) return h;
            return new Date(h.createdAt) > new Date(best.createdAt) ? h : best;
          }, null);

    const isCurrentHead = head && String(head._id) === String(doc._id);

    return ResponseOk(res, 200, "OK", {
      ...doc,
      project_name: project?.site_name || "—",
      lift_name: elevator?.elevator_name || "—",
      status: computed,
      is_historical: Boolean(doc.superseded_by_license_id),
      is_current_head: isCurrentHead,
    });
  } catch (e) {
    console.error("[GetLicenseeById]", e);
    return ErrorHandler(res, 500, "Failed to load license record");
  }
};

/** All licenses for one lift (timeline), newest first */
const GetLiftLicenseHistory = async (req, res) => {
  try {
    const { projectId, elevatorId } = req.query;
    if (!projectId || !elevatorId || !mongoose.Types.ObjectId.isValid(projectId) || !mongoose.Types.ObjectId.isValid(elevatorId)) {
      return ErrorHandler(res, 400, "projectId and elevatorId are required");
    }
    const branchRes = await buildBranchMatchForLicensee(req, req.query.branchId, res);
    if (branchRes.error) return branchRes.error;
    const { matchStage } = branchRes;

    const { todayKey } = await mongoDateKeys();

    const pipeline = [
      {
        $match: {
          ...matchStage,
          project_id: new mongoose.Types.ObjectId(projectId),
          elevator_id: new mongoose.Types.ObjectId(elevatorId),
        },
      },
      {
        $lookup: {
          from: "projects",
          localField: "project_id",
          foreignField: "_id",
          as: "project",
        },
      },
      { $unwind: { path: "$project", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "elevators",
          localField: "elevator_id",
          foreignField: "_id",
          as: "elevator",
        },
      },
      { $unwind: { path: "$elevator", preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          startYmd: {
            $dateToString: { format: "%Y-%m-%d", date: "$license_start_date", timezone: TZ },
          },
          endYmd: {
            $dateToString: { format: "%Y-%m-%d", date: "$license_end_date", timezone: TZ },
          },
        },
      },
      {
        $addFields: {
          status: {
            $switch: {
              branches: [
                { case: { $lt: [todayKey, "$startYmd"] }, then: "Upcoming" },
                { case: { $gt: [todayKey, "$endYmd"] }, then: "Expired" },
              ],
              default: "Active",
            },
          },
        },
      },
      { $sort: { createdAt: -1 } },
    ];

    const rows = await Licensee.aggregate(pipeline);
    const currents = rows.filter((r) => !r.superseded_by_license_id);
    const headRow =
      currents.length === 0
        ? null
        : currents.reduce((best, r) => {
            if (!best) return r;
            return new Date(r.createdAt) > new Date(best.createdAt) ? r : best;
          }, null);
    const headId = headRow?._id;

    const data = rows.map((row) => ({
      ...mapRowOut(row),
      is_current_head: Boolean(headId && String(row._id) === String(headId)),
    }));

    return ResponseOk(res, 200, "License history", {
      projectId,
      elevatorId,
      project_name: data[0]?.project_name || "—",
      lift_name: data[0]?.lift_name || "—",
      rows: data,
    });
  } catch (e) {
    console.error("[GetLiftLicenseHistory]", e);
    return ErrorHandler(res, 500, "Failed to load license history");
  }
};

const CreateLicensee = async (req, res) => {
  try {
    const { project_id, elevator_id, license_number, license_start_date, license_end_date, branchId } =
      req.body || {};
    if (!project_id || !elevator_id || !license_number || !license_start_date || !license_end_date) {
      return ErrorHandler(res, 400, "project_id, elevator_id, license_number, start and end dates are required");
    }
    const num = String(license_number).trim();
    if (!num) {
      return ErrorHandler(res, 400, "license_number is required");
    }
    const start = new Date(license_start_date);
    const end = new Date(license_end_date);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return ErrorHandler(res, 400, "Invalid dates");
    }
    if (end <= start) {
      return ErrorHandler(res, 400, "License end date must be after start date");
    }
    if (!mongoose.Types.ObjectId.isValid(project_id) || !mongoose.Types.ObjectId.isValid(elevator_id)) {
      return ErrorHandler(res, 400, "Invalid project or lift id");
    }

    const existingHeadCount = await Licensee.countDocuments({
      project_id,
      elevator_id,
      ...CURRENT_HEAD_FILTER,
    });

    if (existingHeadCount > 0) {
      return ErrorHandler(
        res,
        400,
        "This lift already has a license on file. Use Renew License to register a new period without losing history."
      );
    }

    const okLift = await assertElevatorInProject(elevator_id, project_id);
    if (!okLift) {
      return ErrorHandler(res, 400, "Lift does not belong to the selected project");
    }
    const project = await Project.findById(project_id);
    if (!project) {
      return ErrorHandler(res, 404, "Project not found");
    }
    const branch_id = project.branch_id || null;

    const branchRes = await buildBranchMatchForLicensee(req, branchId, res);
    if (branchRes.error) return branchRes.error;
    const { matchStage } = branchRes;
    if (Object.keys(matchStage).length) {
      const allowed = matchStage.branch_id;
      if (!branch_id) {
        return ErrorHandler(res, 403, "Project has no branch; cannot assign license in your scope");
      }
      const bid = branch_id.toString();
      if (allowed && allowed.$in) {
        const ids = allowed.$in.map((x) => x.toString());
        if (!ids.includes(bid)) {
          return ErrorHandler(res, 403, "Project is outside your branch scope");
        }
      } else if (allowed && allowed.toString && allowed.toString() !== bid) {
        return ErrorHandler(res, 403, "Project is outside your branch scope");
      }
    }

    const created = await Licensee.create({
      branch_id,
      project_id,
      elevator_id,
      license_number: num,
      license_start_date: start,
      license_end_date: end,
      superseded_by_license_id: null,
      superseded_at: null,
      replaced_license_id: null,
    });

    const userName = await getUserName(req);
    await ActivityLog.create({
      user_id: req.auth?.id || null,
      user_name: userName,
      action: "CREATE_LICENSE",
      type: "Create",
      title: "License created",
      description: `${userName} created license ${num} for a lift.`,
      project_id,
    });

    return ResponseOk(res, 201, "License record created", created);
  } catch (e) {
    console.error("[CreateLicensee]", e);
    return ErrorHandler(res, 500, "Failed to create license record");
  }
};

/**
 * New license row + mark previous as superseded. New period must start after previous end (IST calendar days).
 */
const RenewLicensee = async (req, res) => {
  try {
    const {
      previous_license_id,
      license_number,
      license_start_date,
      license_end_date,
      branchId,
      allow_overlap,
    } = req.body || {};

    if (!previous_license_id || !license_number || !license_start_date || !license_end_date) {
      return ErrorHandler(res, 400, "previous_license_id, license_number, and dates are required");
    }

    const prev = await Licensee.findById(previous_license_id);
    if (!prev) {
      return ErrorHandler(res, 404, "Previous license not found");
    }
    if (prev.superseded_by_license_id) {
      return ErrorHandler(res, 400, "That license was already renewed. Open the lift history and renew from the current license.");
    }

    const headCandidates = await Licensee.find({
      project_id: prev.project_id,
      elevator_id: prev.elevator_id,
      ...CURRENT_HEAD_FILTER,
    })
      .select("_id createdAt")
      .lean();
    const head =
      headCandidates.length === 0
        ? null
        : headCandidates.reduce((best, h) => {
            if (!best) return h;
            return new Date(h.createdAt) > new Date(best.createdAt) ? h : best;
          }, null);

    if (!head || String(head._id) !== String(prev._id)) {
      return ErrorHandler(res, 400, "Renew only from the current license for this lift (latest in the chain).");
    }

    const num = String(license_number).trim();
    if (!num) {
      return ErrorHandler(res, 400, "license_number is required");
    }
    const start = new Date(license_start_date);
    const end = new Date(license_end_date);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return ErrorHandler(res, 400, "Invalid dates");
    }
    if (end <= start) {
      return ErrorHandler(res, 400, "License end date must be after start date");
    }

    const prevEnd = new Date(prev.license_end_date);
    const prevEndYmd = ymdInIST(prevEnd);
    const startYmd = ymdInIST(start);
    if (!allow_overlap && startYmd <= prevEndYmd) {
      return ErrorHandler(
        res,
        400,
        `New license must start after the previous license end date (${prevEndYmd}) in IST, or set allow_overlap to true if overlap is allowed.`
      );
    }

    const project = await Project.findById(prev.project_id);
    if (!project) {
      return ErrorHandler(res, 404, "Project not found");
    }
    const branch_id = project.branch_id || null;

    const branchRes = await buildBranchMatchForLicensee(req, branchId, res);
    if (branchRes.error) return branchRes.error;
    const { matchStage } = branchRes;
    if (Object.keys(matchStage).length) {
      const allowed = matchStage.branch_id;
      if (!branch_id) {
        return ErrorHandler(res, 403, "Project has no branch");
      }
      const bid = branch_id.toString();
      if (allowed && allowed.$in) {
        const ids = allowed.$in.map((x) => x.toString());
        if (!ids.includes(bid)) {
          return ErrorHandler(res, 403, "Project is outside your branch scope");
        }
      } else if (allowed && allowed.toString && allowed.toString() !== bid) {
        return ErrorHandler(res, 403, "Project is outside your branch scope");
      }
    }

    const now = new Date();
    let created = null;
    try {
      created = await Licensee.create({
        branch_id,
        project_id: prev.project_id,
        elevator_id: prev.elevator_id,
        license_number: num,
        license_start_date: start,
        license_end_date: end,
        superseded_by_license_id: null,
        superseded_at: null,
        replaced_license_id: prev._id,
      });
      prev.superseded_by_license_id = created._id;
      prev.superseded_at = now;
      await prev.save();
    } catch (err) {
      if (created?._id) {
        await Licensee.findByIdAndDelete(created._id);
      }
      console.error("[RenewLicensee]", err);
      return ErrorHandler(res, 500, "Could not complete renewal");
    }

    const userName = await getUserName(req);
    await ActivityLog.create({
      user_id: req.auth?.id || null,
      user_name: userName,
      action: "RENEW_LICENSE",
      type: "Create",
      title: "License renewed",
      description: `${userName} renewed license for lift; new number ${num}.`,
      project_id: prev.project_id,
    });

    return ResponseOk(res, 201, "License renewed", created);
  } catch (e) {
    console.error("[RenewLicensee]", e);
    return ErrorHandler(res, 500, "Failed to renew license");
  }
};

const UpdateLicensee = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return ErrorHandler(res, 400, "Invalid id");
    }
    const { project_id, elevator_id, license_number, license_start_date, license_end_date, branchId } =
      req.body || {};

    const branchRes = await buildBranchMatchForLicensee(req, branchId, res);
    if (branchRes.error) return branchRes.error;
    const { matchStage } = branchRes;
    const existing = await Licensee.findOne({ _id: id, ...matchStage });
    if (!existing) {
      return ErrorHandler(res, 404, "License record not found");
    }
    if (existing.superseded_by_license_id) {
      return ErrorHandler(res, 400, "This license is historical (replaced by a renewal). It cannot be edited.");
    }

    const nextProject = project_id || existing.project_id;
    const nextElevator = elevator_id || existing.elevator_id;
    if (!mongoose.Types.ObjectId.isValid(nextProject) || !mongoose.Types.ObjectId.isValid(nextElevator)) {
      return ErrorHandler(res, 400, "Invalid project or lift id");
    }
    const okLift = await assertElevatorInProject(nextElevator, nextProject);
    if (!okLift) {
      return ErrorHandler(res, 400, "Lift does not belong to the selected project");
    }

    const start = license_start_date != null ? new Date(license_start_date) : existing.license_start_date;
    const end = license_end_date != null ? new Date(license_end_date) : existing.license_end_date;
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return ErrorHandler(res, 400, "Invalid dates");
    }
    if (end <= start) {
      return ErrorHandler(res, 400, "License end date must be after start date");
    }
    const num =
      license_number != null ? String(license_number).trim() : existing.license_number;
    if (!num) {
      return ErrorHandler(res, 400, "license_number is required");
    }

    const project = await Project.findById(nextProject);
    if (!project) {
      return ErrorHandler(res, 404, "Project not found");
    }
    const branch_id = project.branch_id || null;

    if (Object.keys(matchStage).length) {
      const allowed = matchStage.branch_id;
      if (!branch_id) {
        return ErrorHandler(res, 403, "Project has no branch; cannot assign license in your scope");
      }
      const bid = branch_id.toString();
      if (allowed && allowed.$in) {
        const ids = allowed.$in.map((x) => x.toString());
        if (!ids.includes(bid)) {
          return ErrorHandler(res, 403, "Project is outside your branch scope");
        }
      } else if (allowed && allowed.toString && allowed.toString() !== bid) {
        return ErrorHandler(res, 403, "Project is outside your branch scope");
      }
    }

    existing.project_id = nextProject;
    existing.elevator_id = nextElevator;
    existing.license_number = num;
    existing.license_start_date = start;
    existing.license_end_date = end;
    existing.branch_id = branch_id;
    await existing.save();

    const userName = await getUserName(req);
    await ActivityLog.create({
      user_id: req.auth?.id || null,
      user_name: userName,
      action: "UPDATE_LICENSE",
      type: "Update",
      title: "License updated",
      description: `${userName} updated license ${num}.`,
      project_id: nextProject,
    });

    return ResponseOk(res, 200, "License record updated", existing);
  } catch (e) {
    console.error("[UpdateLicensee]", e);
    return ErrorHandler(res, 500, "Failed to update license record");
  }
};

const DeleteLicensee = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return ErrorHandler(res, 400, "Invalid id");
    }
    const branchRes = await buildBranchMatchForLicensee(req, req.query.branchId, res);
    if (branchRes.error) return branchRes.error;
    const { matchStage } = branchRes;
    const del = await Licensee.findOneAndDelete({ _id: id, ...matchStage });
    if (!del) {
      return ErrorHandler(res, 404, "License record not found");
    }

    const userName = await getUserName(req);
    await ActivityLog.create({
      user_id: req.auth?.id || null,
      user_name: userName,
      action: "DELETE_LICENSE",
      type: "Delete",
      title: "License deleted",
      description: `${userName} deleted license ${del.license_number || id}.`,
      project_id: del.project_id,
    });

    return ResponseOk(res, 200, "License record deleted", { _id: del._id });
  } catch (e) {
    console.error("[DeleteLicensee]", e);
    return ErrorHandler(res, 500, "Failed to delete license record");
  }
};

module.exports = {
  ListLicensees,
  GetLicenseeById,
  GetLiftLicenseHistory,
  CreateLicensee,
  RenewLicensee,
  UpdateLicensee,
  DeleteLicensee,
  PERMS,
};
