const mongoose = require("mongoose");
const { Complaint } = require("../../Models/Complaint.model");
const { AMC } = require("../../Models/AMC.model");
const { Users, User_Associate_With_Role, Roles } = require("../../Models/User.model");
const { getTechnicianUsersForDropdown } = require("../../Utils/technicianUsers");
const { Project } = require("../../Models/Project.model");
const { ResponseOk, ErrorHandler } = require("../../Utils/ResponseHandler");

async function getRoleUser(req) {
  if (!req.auth?.id) return { role: null, user: null };
  const user = await Users.findById(req.auth.id);
  const userRole = await User_Associate_With_Role.findOne({
    user_id: new mongoose.Types.ObjectId(req.auth.id),
  });
  const role = userRole ? await Roles.findOne({ id: userRole.role_id }) : null;
  return { role, user };
}

function cleanQueryParam(v) {
  if (v === undefined || v === null || v === "") return null;
  const s = String(v).trim();
  if (s.toLowerCase() === "null" || s.toLowerCase() === "undefined") return null;
  return s;
}

async function resolveBranchFilter(req, branchIdRaw) {
  const branchId = cleanQueryParam(branchIdRaw);
  const { role, user } = await getRoleUser(req);
  if (!user) return { ok: false, status: 401, msg: "Unauthorized" };
  const isAdmin = role?.name === "Admin";
  if (isAdmin) {
    if (!branchId) return { ok: true, filter: undefined };
    return { ok: true, filter: new mongoose.Types.ObjectId(branchId) };
  }
  const allowed = (user.branches || []).map((b) => b.toString());
  if (!allowed.length) {
    return { ok: true, filter: new mongoose.Types.ObjectId("000000000000000000000000") };
  }
  if (branchId) {
    if (!allowed.includes(branchId)) return { ok: false, status: 403, msg: "Not allowed for this branch" };
    return { ok: true, filter: new mongoose.Types.ObjectId(branchId) };
  }
  return { ok: true, filter: { $in: user.branches } };
}

async function canAccessAmc(req, amcDoc) {
  const { role, user } = await getRoleUser(req);
  if (!user || !amcDoc) return false;
  if (role?.name === "Admin") return true;
  const bid = amcDoc.branch_id?.toString();
  if (!bid) return false;
  return (user.branches || []).some((b) => b.toString() === bid);
}

async function nextComplaintNumber() {
  const count = await Complaint.countDocuments();
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `CMP-${y}${m}${day}-${String(count + 1).padStart(4, "0")}`;
}

const ListComplaints = async (req, res) => {
  try {
    const {
      amc_id,
      lift_id,
      technician_id,
      status,
      branch_id,
      from_date,
      to_date,
      search,
      limit: limitRaw,
    } = req.query;

    const scope = await resolveBranchFilter(req, branch_id);
    if (!scope.ok) return ErrorHandler(res, scope.status, scope.msg);

    const query = {};
    if (scope.filter !== undefined) query.branch_id = scope.filter;
    if (amc_id) query.amc_id = amc_id;
    if (lift_id) query.lift_id = lift_id;
    if (technician_id) query.assigned_technician_id = technician_id;

    if (status && status !== "all") {
      if (status === "attention") {
        query.status = { $in: ["Open", "In Progress"] };
      } else if (String(status).includes(",")) {
        query.status = {
          $in: String(status)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        };
      } else {
        query.status = status;
      }
    }

    if (from_date || to_date) {
      query.complaint_datetime = {};
      if (from_date) query.complaint_datetime.$gte = new Date(from_date);
      if (to_date) query.complaint_datetime.$lte = new Date(to_date);
    }

    if (search && String(search).trim()) {
      const term = new RegExp(String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      query.$or = [
        { complaint_number: term },
        { project_name: term },
        { description: term },
        { party_mobile: term },
        { lift_label: term },
      ];
    }

    let q = Complaint.find(query)
      .populate("assigned_technician_id", "name contact_number")
      .populate("amc_id", "contract_number external_project_name")
      .sort({ complaint_datetime: -1, createdAt: -1 });

    if (limitRaw != null && String(limitRaw).trim() !== "") {
      const n = Math.min(500, Math.max(1, Number(limitRaw)));
      if (!Number.isNaN(n)) q = q.limit(n);
    }

    const list = await q;

    return ResponseOk(res, 200, "Complaints retrieved", list);
  } catch (error) {
    console.error("[ListComplaints]", error);
    return ErrorHandler(res, 500, "Server error");
  }
};

const GetComplaintById = async (req, res) => {
  try {
    const doc = await Complaint.findById(req.params.id)
      .populate("assigned_technician_id", "name contact_number email")
      .populate("amc_id")
      .populate("created_by", "name");

    if (!doc) return ErrorHandler(res, 404, "Complaint not found");

    const { role, user } = await getRoleUser(req);
    if (!user) return ErrorHandler(res, 401, "Unauthorized");
    if (role?.name !== "Admin") {
      const bid = doc.branch_id?.toString();
      const ok = bid && (user.branches || []).some((b) => b.toString() === bid);
      if (!ok) return ErrorHandler(res, 403, "Access denied");
    }

    return ResponseOk(res, 200, "Complaint details", doc);
  } catch (error) {
    console.error("[GetComplaintById]", error);
    return ErrorHandler(res, 500, "Server error");
  }
};

const GetComplaintMeta = async (req, res) => {
  try {
    const { amcId } = req.params;
    if (!amcId) return ErrorHandler(res, 400, "AMC id required");

    const amc = await AMC.findById(amcId)
      .populate("elevator_ids", "elevator_name type_of_elevator")
      .populate("project_id", "site_name");

    if (!amc) return ErrorHandler(res, 404, "AMC not found");
    const allowed = await canAccessAmc(req, amc);
    if (!allowed) return ErrorHandler(res, 403, "Access denied");

    const project_name = amc.project_id?.site_name || amc.external_project_name || "";
    const lifts = [];
    const elev = amc.elevator_ids || [];
    elev.forEach((e, idx) => {
      lifts.push({
        _id: e._id,
        label: e.elevator_name ? `${e.elevator_name} · Lift ${idx + 1}` : `Lift ${idx + 1}`,
      });
    });
    (amc.external_elevator_names || []).forEach((name, i) => {
      lifts.push({
        _id: `external-${i}`,
        label: String(name),
      });
    });

    const technicians = await getTechnicianUsersForDropdown({
      branch_id: amc.branch_id || undefined,
    });

    const service_schedule = (amc.service_schedule || []).map((s) => ({
      _id: s._id,
      scheduled_date: s.scheduled_date,
      service_status: s.service_status,
      lift_label: s.lift_label || "",
    }));

    return ResponseOk(res, 200, "Meta", {
      project_name,
      party_mobile: amc.client_mobile || "",
      lifts,
      technicians,
      service_schedule,
    });
  } catch (error) {
    console.error("[GetComplaintMeta]", error);
    return ErrorHandler(res, 500, "Server error");
  }
};

const CreateComplaint = async (req, res) => {
  try {
    const {
      amc_id,
      lift_id,
      description,
      party_mobile,
      complaint_datetime,
      assigned_technician_id,
      service_schedule_id,
    } = req.body;

    if (!amc_id || lift_id === undefined || lift_id === null || lift_id === "" || !description || !complaint_datetime) {
      return ErrorHandler(res, 400, "amc_id, lift_id, description and complaint_datetime are required");
    }

    const amc = await AMC.findById(amc_id).populate("elevator_ids", "elevator_name");
    if (!amc) return ErrorHandler(res, 404, "AMC not found");
    if (!(await canAccessAmc(req, amc))) return ErrorHandler(res, 403, "Access denied");

    const user = await Users.findById(req.auth.id);
    const userName = user?.name || "User";

    const liftIdStr = String(lift_id);
    let lift_label = "Lift";
    let liftObjectId = null;
    if (mongoose.Types.ObjectId.isValid(liftIdStr) && String(new mongoose.Types.ObjectId(liftIdStr)) === liftIdStr) {
      liftObjectId = new mongoose.Types.ObjectId(liftIdStr);
      const idx = (amc.elevator_ids || []).findIndex((e) => e._id.toString() === liftIdStr);
      if (idx >= 0) {
        const e = amc.elevator_ids[idx];
        lift_label = e.elevator_name ? `${e.elevator_name} · Lift ${idx + 1}` : `Lift ${idx + 1}`;
      }
    } else if (liftIdStr.startsWith("external-")) {
      const i = Number(liftIdStr.replace("external-", ""));
      const ext = amc.external_elevator_names || [];
      lift_label = ext[i] != null ? String(ext[i]) : `External lift ${i + 1}`;
    }

    let projName = amc.external_project_name || "";
    if (amc.project_id) {
      const p = await Project.findById(amc.project_id).select("site_name");
      if (p?.site_name) projName = p.site_name;
    }

    const complaint_number = await nextComplaintNumber();
    const logEntry = {
      action: "Complaint created",
      performed_by_name: userName,
      remark: null,
    };

    const doc = await Complaint.create({
      complaint_number,
      branch_id: amc.branch_id || null,
      amc_id: amc._id,
      lift_id: liftObjectId,
      project_name: projName || amc.external_project_name || "",
      lift_label,
      description: String(description).trim(),
      party_mobile: party_mobile || amc.client_mobile || "",
      complaint_datetime: new Date(complaint_datetime),
      assigned_technician_id: assigned_technician_id || null,
      service_schedule_id: service_schedule_id || null,
      created_by: req.auth.id,
      activity_log: [logEntry],
    });

    const populated = await Complaint.findById(doc._id)
      .populate("assigned_technician_id", "name contact_number")
      .populate("amc_id", "contract_number external_project_name");

    return ResponseOk(res, 201, "Complaint created", populated);
  } catch (error) {
    console.error("[CreateComplaint]", error);
    return ErrorHandler(res, 500, error.message || "Server error");
  }
};

const UpdateComplaint = async (req, res) => {
  try {
    const doc = await Complaint.findById(req.params.id);
    if (!doc) return ErrorHandler(res, 404, "Complaint not found");

    const { role, user } = await getRoleUser(req);
    if (!user) return ErrorHandler(res, 401, "Unauthorized");
    if (role?.name !== "Admin") {
      const bid = doc.branch_id?.toString();
      if (!bid || !(user.branches || []).some((b) => b.toString() === bid)) {
        return ErrorHandler(res, 403, "Access denied");
      }
    }
    if (doc.status === "Closed" && role?.name !== "Admin") {
      return ErrorHandler(res, 403, "Closed complaints cannot be edited");
    }

    const { description, party_mobile, complaint_datetime, assigned_technician_id, update_remark } = req.body;
    if (description !== undefined) doc.description = description;
    if (party_mobile !== undefined) doc.party_mobile = party_mobile;
    if (complaint_datetime !== undefined) doc.complaint_datetime = new Date(complaint_datetime);
    if (assigned_technician_id !== undefined) doc.assigned_technician_id = assigned_technician_id || null;

    const u = await Users.findById(req.auth.id);
    doc.activity_log.push({
      action: "Details updated",
      performed_by_name: u?.name || "User",
      remark: update_remark || null,
    });

    await doc.save();
    const populated = await Complaint.findById(doc._id)
      .populate("assigned_technician_id", "name contact_number email")
      .populate("amc_id")
      .populate("created_by", "name");

    return ResponseOk(res, 200, "Updated", populated);
  } catch (error) {
    console.error("[UpdateComplaint]", error);
    return ErrorHandler(res, 500, "Server error");
  }
};

const UpdateComplaintStatus = async (req, res) => {
  try {
    const doc = await Complaint.findById(req.params.id);
    if (!doc) return ErrorHandler(res, 404, "Complaint not found");

    const { role, user } = await getRoleUser(req);
    if (!user) return ErrorHandler(res, 401, "Unauthorized");
    if (role?.name !== "Admin") {
      const bid = doc.branch_id?.toString();
      if (!bid || !(user.branches || []).some((b) => b.toString() === bid)) {
        return ErrorHandler(res, 403, "Access denied");
      }
    }

    const { status, remark, closing_remark, closed_at } = req.body;
    if (!status) return ErrorHandler(res, 400, "status required");

    const from = doc.status;
    doc.status = status;
    if (remark) {
      doc.activity_log.push({
        action: `Status: ${from} → ${status}`,
        performed_by_name: (await Users.findById(req.auth.id))?.name || "User",
        from_status: from,
        to_status: status,
        remark,
      });
    } else {
      doc.activity_log.push({
        action: `Status: ${from} → ${status}`,
        performed_by_name: (await Users.findById(req.auth.id))?.name || "User",
        from_status: from,
        to_status: status,
      });
    }

    if (status === "Closed") {
      doc.closing_remark = closing_remark || "";
      const ca = closed_at ? new Date(closed_at) : new Date();
      doc.closed_at = ca;
      const start = new Date(doc.complaint_datetime);
      doc.resolution_minutes = Math.max(0, Math.round((ca - start) / 60000));
    }

    await doc.save();
    const populated = await Complaint.findById(doc._id)
      .populate("assigned_technician_id", "name contact_number")
      .populate("amc_id", "contract_number external_project_name");

    return ResponseOk(res, 200, "Status updated", populated);
  } catch (error) {
    console.error("[UpdateComplaintStatus]", error);
    return ErrorHandler(res, 500, "Server error");
  }
};

const DeleteComplaint = async (req, res) => {
  try {
    const doc = await Complaint.findById(req.params.id);
    if (!doc) return ErrorHandler(res, 404, "Not found");

    const { role, user } = await getRoleUser(req);
    if (!user) return ErrorHandler(res, 401, "Unauthorized");
    if (role?.name !== "Admin") {
      const bid = doc.branch_id?.toString();
      if (!bid || !(user.branches || []).some((b) => b.toString() === bid)) {
        return ErrorHandler(res, 403, "Access denied");
      }
    }
    if (doc.status !== "Open" && role?.name !== "Admin") {
      return ErrorHandler(res, 403, "Only open complaints can be deleted");
    }

    await Complaint.deleteOne({ _id: doc._id });
    return ResponseOk(res, 200, "Deleted", { _id: doc._id });
  } catch (error) {
    console.error("[DeleteComplaint]", error);
    return ErrorHandler(res, 500, "Server error");
  }
};

module.exports = {
  ListComplaints,
  GetComplaintById,
  GetComplaintMeta,
  CreateComplaint,
  UpdateComplaint,
  UpdateComplaintStatus,
  DeleteComplaint,
};
