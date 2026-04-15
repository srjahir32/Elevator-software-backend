const mongoose = require("mongoose");
const { Quotation } = require("../../Models/Quotation.model");
const { Project, Elevators } = require("../../Models/Project.model");
const { Invoice } = require("../../Models/Invoice.model");
const { Users, User_Associate_With_Role, Roles } = require("../../Models/User.model");
const { ActivityLog } = require("../../Models/Activitylog.model");
const { ResponseOk, ErrorHandler } = require("../../Utils/ResponseHandler");

const LIFT_DEFAULTS_QUOTATION = {
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

function normalizeEmailListQuotation(raw) {
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

function buildElevatorPayloadQuotation(projectId, lift) {
  const title = String(lift.title || lift.elevator_name || "").trim();
  const floorsNum = Math.max(1, Math.floor(Number(lift.no_of_floors) || 1));
  const floors = String(floorsNum);
  const maker = String(lift.lift_maker || "").trim();
  const op = lift.operation_type === "Manual" ? "Manual" : "Automatic";
  return {
    ...LIFT_DEFAULTS_QUOTATION,
    project_id: projectId,
    elevator_name: title,
    operation_type: op,
    no_of_floors: floors,
    stops: floors,
    lift_maker: maker || null,
    notes: maker ? `Lift maker: ${maker}` : "",
  };
}

/**
 * Create a PM project + lifts from quotation "new site" payload (reuses PM rules).
 * @returns {{ ok: true, project: object } | { ok: false, status: number, msg: string }}
 */
async function createProjectFromQuotationNewPayload(req, np) {
  const site_name = String(np.site_name || np.project_name || "").trim();
  const client_name = String(req.body.client_name || np.client_name || "").trim();
  const liftList = Array.isArray(np.lifts) ? np.lifts : [];
  const useLifts =
    liftList.length > 0
      ? liftList
      : [{ title: "Lift 1", no_of_floors: 1, operation_type: "Automatic", lift_maker: "" }];

  if (!site_name) return { ok: false, status: 400, msg: "Site name is required" };
  if (!client_name) return { ok: false, status: 400, msg: "Client name is required" };

  for (let i = 0; i < useLifts.length; i++) {
    const L = useLifts[i];
    const t = String(L?.title || L?.elevator_name || "").trim();
    if (!t) return { ok: false, status: 400, msg: `Lift ${i + 1}: title is required` };
    const floors = Number(L?.no_of_floors);
    if (!Number.isFinite(floors) || floors < 1) {
      return { ok: false, status: 400, msg: `Lift ${i + 1}: number of floors must be at least 1` };
    }
    if (L?.operation_type && L.operation_type !== "Automatic" && L.operation_type !== "Manual") {
      return { ok: false, status: 400, msg: `Lift ${i + 1}: operation type must be Automatic or Manual` };
    }
  }

  const { role, user } = await getRequestRole(req);
  const isAdmin = (role?.name || "") === "Admin";
  let branchObjectId = null;
  const branch_id = np.branch_id != null ? np.branch_id : req.body.branch_id;

  if (isAdmin) {
    const b = branch_id;
    if (
      b == null ||
      b === "" ||
      b === "null" ||
      b === "undefined" ||
      !mongoose.Types.ObjectId.isValid(String(b))
    ) {
      return { ok: false, status: 400, msg: "branch_id is required for the new site" };
    }
    branchObjectId = new mongoose.Types.ObjectId(String(b));
  } else {
    const branches = user?.branches || [];
    if (!branches.length) {
      return { ok: false, status: 400, msg: "Your account has no branch assigned" };
    }
    if (branch_id && mongoose.Types.ObjectId.isValid(String(branch_id))) {
      const allowed = branches.some((br) => String(br) === String(branch_id));
      if (!allowed) return { ok: false, status: 403, msg: "You are not assigned to the selected branch" };
      branchObjectId = new mongoose.Types.ObjectId(String(branch_id));
    } else {
      branchObjectId = branches[0];
    }
  }

  const emails = normalizeEmailListQuotation(
    np.client_emails?.length ? np.client_emails : req.body.client_email || np.client_email
  );
  const primaryEmail =
    emails[0] || (req.body.client_email ? String(req.body.client_email).trim() : null) || null;

  const addr = String(np.site_address || np.address || "").trim();
  const gstVal =
    req.body.gst_no != null && String(req.body.gst_no).trim()
      ? String(req.body.gst_no).trim()
      : np.gst_no != null && String(np.gst_no).trim()
        ? String(np.gst_no).trim()
        : null;

  const project = await Project.create({
    site_name,
    aggrement_no: np.aggrement_no != null ? String(np.aggrement_no).trim() || null : null,
    site_address: addr,
    city: np.city != null ? String(np.city).trim() || null : null,
    area: np.area != null ? String(np.area).trim() || null : null,
    client_name,
    client_mobile: req.body.client_mobile != null ? String(req.body.client_mobile).trim() || null : null,
    client_email: primaryEmail,
    client_emails: emails,
    gst_no: gstVal,
    payment_amount: 0,
    Site_Supervisor: "—",
    map_url: "",
    branch_id: branchObjectId,
    original_project_id:
      np.original_project_id && mongoose.Types.ObjectId.isValid(String(np.original_project_id))
        ? new mongoose.Types.ObjectId(String(np.original_project_id))
        : null,
  });

  const createdLiftIds = [];
  for (const lift of useLifts) {
    const doc = new Elevators(buildElevatorPayloadQuotation(project._id, lift));
    await doc.save();
    createdLiftIds.push(String(doc._id));
  }

  const user_details = await Users.findById(req.auth.id);
  await ActivityLog.create({
    user_id: req.auth?.id || null,
    user_name: user_details?.name,
    action: "ADD_PROJECT_PM",
    type: "Create",
    description: `${user_details?.name || "User"} created project (PM) "${site_name}" from quotation (new site).`,
    title: "Project Added",
    project_id: project._id,
  });

  const lean = await Project.findById(project._id).lean();
  return { ok: true, project: lean, createdLiftIds };
}

function cleanParam(v) {
  if (v === undefined || v === null || v === "") return null;
  const s = String(v).trim();
  if (s.toLowerCase() === "null") return null;
  return s;
}

async function getRequestRole(req) {
  if (!req.auth?.id) return { role: null, user: null };
  const user = await Users.findById(req.auth.id).lean();
  const link = await User_Associate_With_Role.findOne({
    user_id: new mongoose.Types.ObjectId(req.auth.id),
  });
  const role = link ? await Roles.findOne({ id: link.role_id }).lean() : null;
  return { role, user };
}

async function assertProjectAccess(req, projectDoc) {
  const { role, user } = await getRequestRole(req);
  if (!user) return false;
  if ((role?.name || "") === "Admin") return true;
  const branches = user.branches || [];
  const bid = projectDoc.branch_id;
  if (!bid) return true;
  return branches.some((b) => String(b) === String(bid));
}

async function branchFilterForList(req, branchIdRaw) {
  const { role, user } = await getRequestRole(req);
  if (!user) return { ok: false, status: 401, msg: "Unauthorized" };
  const isAdmin = (role?.name || "") === "Admin";
  const branchId = cleanParam(branchIdRaw);
  if (isAdmin) {
    if (!branchId) return { ok: true, filter: undefined };
    return { ok: true, filter: new mongoose.Types.ObjectId(branchId) };
  }
  const allowed = (user.branches || []).map((b) => b.toString());
  if (!allowed.length) {
    return { ok: true, filter: new mongoose.Types.ObjectId("000000000000000000000000") };
  }
  if (branchId) {
    if (!allowed.includes(branchId)) return { ok: false, status: 403, msg: "Branch not allowed" };
    return { ok: true, filter: new mongoose.Types.ObjectId(branchId) };
  }
  return { ok: true, filter: { $in: user.branches } };
}

const generateQuotationNumber = async () => {
  const year = new Date().getFullYear();
  const prefix = `QUO-${year}-`;
  const last = await Quotation.findOne({ quotation_number: { $regex: `^${prefix}` } })
    .sort({ quotation_number: -1 })
    .lean();
  let seq = 1;
  if (last?.quotation_number) {
    const parts = last.quotation_number.split("-");
    seq = parseInt(parts[parts.length - 1], 10) + 1 || 1;
  }
  return `${prefix}${String(seq).padStart(4, "0")}`;
};

const generateInvoiceNumber = async () => {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  const lastInvoice = await Invoice.findOne({ invoice_number: { $regex: `^${prefix}` } }).sort({
    invoice_number: -1,
  });
  let sequence = 1;
  if (lastInvoice) {
    const lastParts = lastInvoice.invoice_number.split("-");
    sequence = parseInt(lastParts[lastParts.length - 1], 10) + 1;
  }
  return `${prefix}${sequence.toString().padStart(4, "0")}`;
};

/** Unique valid ObjectId strings from body (supports raw strings or { _id }). */
function normalizeElevatorIdList(elevator_ids) {
  const raw = Array.isArray(elevator_ids) ? elevator_ids : [];
  const strings = [
    ...new Set(
      raw
        .map((x) => {
          if (x == null) return null;
          if (typeof x === "object" && x._id != null) return String(x._id);
          return String(x);
        })
        .filter((s) => s && mongoose.Types.ObjectId.isValid(s))
    ),
  ];
  return strings;
}

/** Validate lifts exist and project_id matches (string compare for legacy shapes). */
async function assertLiftsBelongToProject(elevator_ids, project_id) {
  const liftIds = normalizeElevatorIdList(elevator_ids);
  if (!liftIds.length) return { ok: true, liftOids: [] };

  const liftOids = liftIds.map((id) => new mongoose.Types.ObjectId(id));
  const found = await Elevators.find({ _id: { $in: liftOids } }).select("_id project_id").lean();
  const foundById = new Map(found.map((f) => [String(f._id), f]));
  const missing = liftIds.filter((id) => !foundById.has(id));
  if (missing.length) {
    return {
      ok: false,
      msg: `Unknown lift id(s): ${missing.join(", ")}. Re-open the form and select lifts from the current project.`,
    };
  }
  const pidExpected = String(project_id);
  const wrong = found.filter((f) => String(f.project_id) !== pidExpected);
  if (wrong.length) {
    const ids = wrong.map((f) => String(f._id)).join(", ");
    return {
      ok: false,
      msg: `These lifts belong to another project, not the one selected: ${ids}. Clear lift selection or pick the correct project.`,
    };
  }
  return { ok: true, liftOids };
}

function normalizeItems(rawItems) {
  const list = Array.isArray(rawItems) ? rawItems : [];
  return list.map((row, idx) => {
    const qty = Math.max(0, Number(row.quantity) || 0);
    const rate = Math.max(0, Number(row.rate) || 0);
    const amount =
      row.amount != null && row.amount !== ""
        ? Math.max(0, Number(row.amount) || 0)
        : Math.round(qty * rate * 100) / 100;
    return {
      line_no: idx + 1,
      charge_type: ["Service", "Material", "Other"].includes(row.charge_type) ? row.charge_type : "Service",
      group_tag: String(row.group_tag || "").trim(),
      name: String(row.name || "").trim(),
      description: String(row.description || ""),
      quantity: qty,
      unit: String(row.unit || "Nos").trim() || "Nos",
      rate,
      amount,
      quantity_invoiced: Math.max(0, Math.min(qty, Number(row.quantity_invoiced) || 0)),
    };
  });
}

function recalcTotals(items, gstPct, liftPricingRows = []) {
  const itemsSum = items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
  const liftSum = (Array.isArray(liftPricingRows) ? liftPricingRows : []).reduce(
    (s, r) => s + (Number(r.amount) || 0),
    0
  );
  const subtotal = Math.round((itemsSum + liftSum) * 100) / 100;
  const pct = Math.max(0, Math.min(100, Number(gstPct) || 0));
  const gstRaw = (subtotal * pct) / 100;
  const gst_amount = Math.round(gstRaw * 100) / 100;
  const total_amount = Math.round((subtotal + gst_amount) * 100) / 100;
  return { subtotal, gst_amount, total_amount, gst_percentage: pct };
}

function toPlainLiftPricingRow(x) {
  if (!x) return {};
  return x.toObject ? x.toObject() : { ...x };
}

/** Normalize lift_pricing[] from API body; merge invoiced_amount caps from existing subdocs. */
function normalizeLiftPricingRows(rawRows, existingDocLiftPricing = []) {
  const raw = Array.isArray(rawRows) ? rawRows : [];
  const existingById = new Map(
    (existingDocLiftPricing || []).map((x) => {
      const o = toPlainLiftPricingRow(x);
      return [String(o._id), o];
    })
  );
  return raw
    .map((row) => {
      const amount = Math.max(0, Number(row.amount) || 0);
      let elevId = null;
      if (row.elevator_id != null && mongoose.Types.ObjectId.isValid(String(row.elevator_id))) {
        elevId = new mongoose.Types.ObjectId(String(row.elevator_id));
      }
      const prev =
        row._id != null && mongoose.Types.ObjectId.isValid(String(row._id))
          ? existingById.get(String(row._id))
          : null;
      let invoiced_amount = prev ? Math.max(0, Number(prev.invoiced_amount) || 0) : 0;
      if (invoiced_amount > amount) invoiced_amount = amount;
      const out = {
        elevator_id: elevId,
        lift_name: String(row.lift_name || "").trim(),
        type_of_elevator: String(row.type_of_elevator || "").trim(),
        operation_type: String(row.operation_type || "").trim(),
        floors: String(row.floors ?? "").trim(),
        maker: String(row.maker || "").trim(),
        amount,
        invoiced_amount,
      };
      if (row._id != null && mongoose.Types.ObjectId.isValid(String(row._id))) {
        out._id = row._id;
      }
      return out;
    })
    .filter((r) => (r.lift_name && r.lift_name.length > 0) || r.elevator_id || r.amount > 0);
}

async function assertLiftPricingElevatorsProject(liftPricingRows, project_id) {
  const ids = (liftPricingRows || [])
    .map((r) => r.elevator_id)
    .filter((id) => id != null);
  const strings = [...new Set(ids.map((id) => String(id)))];
  if (!strings.length) return { ok: true };
  return assertLiftsBelongToProject(strings, project_id);
}

const STATUS_FLOW = {
  Draft: ["Sent", "Rejected"],
  Sent: ["Approved", "Rejected", "Draft"],
  Approved: ["Converted", "Rejected"],
  Rejected: ["Draft"],
  Converted: [],
};

const ListQuotations = async (req, res) => {
  try {
    const scope = await branchFilterForList(req, req.query.branch_id);
    if (!scope.ok) return ErrorHandler(res, scope.status, scope.msg);

    const q = {};
    if (scope.filter !== undefined) q.branch_id = scope.filter;

    const pid = cleanParam(req.query.project_id);
    if (pid && mongoose.Types.ObjectId.isValid(pid)) q.project_id = new mongoose.Types.ObjectId(pid);

    const st = cleanParam(req.query.status);
    if (st) q.status = st;

    const df = cleanParam(req.query.date_from);
    const dt = cleanParam(req.query.date_to);
    if (df || dt) {
      q.quotation_date = {};
      if (df) q.quotation_date.$gte = new Date(df);
      if (dt) q.quotation_date.$lte = new Date(`${dt}T23:59:59.999Z`);
    }

    const search = cleanParam(req.query.search);
    if (search) {
      q.$or = [
        { quotation_number: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") },
        { client_name: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") },
      ];
    }

    const rows = await Quotation.find(q)
      .populate("project_id", "site_name client_name branch_id")
      .populate("converted_amc_id", "contract_number contract_status total_amount")
      .sort({ quotation_date: -1, createdAt: -1 })
      .lean();

    return ResponseOk(res, 200, "OK", rows);
  } catch (e) {
    console.error("[ListQuotations]", e);
    return ErrorHandler(res, 500, e.message || "Server error");
  }
};

const GetQuotationById = async (req, res) => {
  try {
    const id = req.params.id;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return ErrorHandler(res, 400, "Invalid id");
    }
    const doc = await Quotation.findById(id)
      .populate("project_id")
      .populate(
        "elevator_ids",
        "elevator_name type_of_elevator operation_type lift_maker passenger_capacity speed no_of_floors stops opening_type"
      )
      .populate({
        path: "lift_pricing.elevator_id",
        select: "elevator_name no_of_floors stops lift_maker type_of_elevator operation_type",
      })
      .populate("linked_invoice_ids", "invoice_number status total_amount balance_amount")
      .populate({
        path: "converted_amc_id",
        select:
          "contract_number contract_status total_amount contract_start_date contract_end_date project_id is_external amc_type amc_payment_type contract_amount gst_amount gst_percentage include_gst service_frequency payment_frequency client_name client_mobile client_email client_address agreement_no city area elevator_ids lifts external_elevator_names external_project_name",
        populate: {
          path: "elevator_ids",
          select:
            "elevator_name type_of_elevator operation_type lift_maker no_of_floors stops passenger_capacity speed opening_type",
        },
      })
      .lean();
    if (!doc) return ErrorHandler(res, 404, "Quotation not found");

    const project = await Project.findById(doc.project_id?._id || doc.project_id).lean();
    if (project && !(await assertProjectAccess(req, project))) {
      return ErrorHandler(res, 403, "Access denied");
    }

    const invoices = await Invoice.find({ quotation_id: doc._id })
      .sort({ createdAt: -1 })
      .lean();

    return ResponseOk(res, 200, "OK", { quotation: doc, invoices });
  } catch (e) {
    console.error("[GetQuotationById]", e);
    return ErrorHandler(res, 500, e.message || "Server error");
  }
};

const CreateQuotation = async (req, res) => {
  try {
    const {
      project_id,
      new_project,
      quotation_date,
      elevator_ids,
      client_name,
      client_email,
      client_mobile,
      client_address,
      gst_no,
      notes,
      terms_and_conditions,
      items,
      gst_percentage,
      status,
      lift_pricing,
    } = req.body || {};

    const hasValidProjectId = project_id && mongoose.Types.ObjectId.isValid(String(project_id));
    const hasNewProject = new_project && typeof new_project === "object" && !Array.isArray(new_project);

    let project = null;
    let resolvedProjectId = null;
    let createdLiftIdsFromNewProject = [];

    if (hasValidProjectId) {
      resolvedProjectId = String(project_id);
      project = await Project.findById(resolvedProjectId).lean();
      if (!project) return ErrorHandler(res, 404, "Project not found");
      if (!(await assertProjectAccess(req, project))) {
        return ErrorHandler(res, 403, "Access denied");
      }
    } else if (hasNewProject) {
      const created = await createProjectFromQuotationNewPayload(req, new_project);
      if (!created.ok) return ErrorHandler(res, created.status, created.msg);
      project = created.project;
      resolvedProjectId = String(project._id);
      createdLiftIdsFromNewProject = Array.isArray(created.createdLiftIds) ? created.createdLiftIds : [];
    } else {
      return ErrorHandler(res, 400, "Valid project_id or new_project (new site details) is required");
    }

    const normalized = normalizeItems(items).filter((r) => r.name);
    if (normalized.length < 1) {
      return ErrorHandler(res, 400, "At least one quotation item is required");
    }

    const gstPct = gst_percentage != null ? Number(gst_percentage) : 18;

    const rawElevatorIds = Array.isArray(elevator_ids) ? elevator_ids : [];
    const useElevatorIds =
      rawElevatorIds.length > 0
        ? elevator_ids
        : createdLiftIdsFromNewProject.length > 0
          ? createdLiftIdsFromNewProject
          : elevator_ids;

    const liftCheck = await assertLiftsBelongToProject(useElevatorIds, resolvedProjectId);
    if (!liftCheck.ok) return ErrorHandler(res, 400, liftCheck.msg);

    let liftPricingNorm = normalizeLiftPricingRows(lift_pricing || []);
    if (hasNewProject && createdLiftIdsFromNewProject.length > 0) {
      liftPricingNorm = liftPricingNorm.map((row, i) => {
        if (row.elevator_id || !createdLiftIdsFromNewProject[i]) return row;
        return {
          ...row,
          elevator_id: new mongoose.Types.ObjectId(String(createdLiftIdsFromNewProject[i])),
        };
      });
    }
    const lpCheck = await assertLiftPricingElevatorsProject(liftPricingNorm, resolvedProjectId);
    if (!lpCheck.ok) return ErrorHandler(res, 400, lpCheck.msg);

    const totals = recalcTotals(normalized, gstPct, liftPricingNorm);

    const quotation_number = await generateQuotationNumber();
    const branch_id = project.branch_id || null;

    const doc = await Quotation.create({
      quotation_number,
      quotation_date: quotation_date ? new Date(quotation_date) : new Date(),
      status: status === "Sent" ? "Sent" : "Draft",
      project_id: resolvedProjectId,
      branch_id,
      elevator_ids: liftCheck.liftOids,
      client_name: String(client_name || project.client_name || "").trim(),
      client_email: String(client_email || project.client_email || "").trim(),
      client_mobile: String(client_mobile || project.client_mobile || "").trim(),
      client_address: String(
        client_address || [project.site_address, project.city, project.area].filter(Boolean).join(", ")
      ).trim(),
      gst_no: String(gst_no || project.gst_no || "").trim(),
      notes: String(notes || ""),
      terms_and_conditions: String(terms_and_conditions || ""),
      items: normalized,
      lift_pricing: liftPricingNorm,
      gst_percentage: totals.gst_percentage,
      subtotal: totals.subtotal,
      gst_amount: totals.gst_amount,
      total_amount: totals.total_amount,
      created_by: req.auth?.id || null,
      sent_at: status === "Sent" ? new Date() : null,
    });

    const populated = await Quotation.findById(doc._id)
      .populate("project_id", "site_name client_name")
      .lean();

    return ResponseOk(res, 201, "Quotation created", populated);
  } catch (e) {
    console.error("[CreateQuotation]", e);
    return ErrorHandler(res, 500, e.message || "Server error");
  }
};

const UpdateQuotation = async (req, res) => {
  try {
    const id = req.params.id;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return ErrorHandler(res, 400, "Invalid id");
    }
    const doc = await Quotation.findById(id);
    if (!doc) return ErrorHandler(res, 404, "Quotation not found");

    const project = await Project.findById(doc.project_id).lean();
    if (!project || !(await assertProjectAccess(req, project))) {
      return ErrorHandler(res, 403, "Access denied");
    }

    if (!["Draft", "Sent"].includes(doc.status)) {
      return ErrorHandler(res, 400, "Only Draft or Sent quotations can be edited");
    }

    const {
      project_id: bodyProjectId,
      quotation_date,
      elevator_ids,
      client_name,
      client_email,
      client_mobile,
      client_address,
      gst_no,
      notes,
      terms_and_conditions,
      items,
      gst_percentage,
      lift_pricing,
    } = req.body || {};

    if (bodyProjectId && String(bodyProjectId) !== String(doc.project_id)) {
      return ErrorHandler(res, 400, "Cannot change project on existing quotation");
    }

    if (lift_pricing !== undefined) {
      const liftRows = normalizeLiftPricingRows(lift_pricing, doc.lift_pricing || []);
      const lpCheck = await assertLiftPricingElevatorsProject(liftRows, doc.project_id);
      if (!lpCheck.ok) return ErrorHandler(res, 400, lpCheck.msg);
      doc.lift_pricing = liftRows;
    }

    if (items !== undefined) {
      const normalized = normalizeItems(items).filter((r) => r.name);
      if (normalized.length < 1) {
        return ErrorHandler(res, 400, "At least one quotation item is required");
      }
      const merged = normalized.map((row, idx) => {
        const prev = doc.items[idx];
        let qInv = 0;
        if (prev && String(prev.name) === String(row.name)) {
          qInv = Math.min(Number(prev.quantity_invoiced) || 0, row.quantity);
        }
        return { ...row, line_no: idx + 1, quantity_invoiced: qInv };
      });
      doc.items = merged;
    }

    if (items !== undefined || lift_pricing !== undefined || gst_percentage != null) {
      const mergedItems = doc.items.map((i) => (i.toObject ? i.toObject() : i));
      const gstPct = gst_percentage != null ? Number(gst_percentage) : doc.gst_percentage;
      const liftRowsPlain = (doc.lift_pricing || []).map((x) => toPlainLiftPricingRow(x));
      const totals = recalcTotals(mergedItems, gstPct, liftRowsPlain);
      doc.gst_percentage = totals.gst_percentage;
      doc.subtotal = totals.subtotal;
      doc.gst_amount = totals.gst_amount;
      doc.total_amount = totals.total_amount;
    }

    if (quotation_date) doc.quotation_date = new Date(quotation_date);
    if (elevator_ids !== undefined) {
      const liftCheck = await assertLiftsBelongToProject(elevator_ids, doc.project_id);
      if (!liftCheck.ok) return ErrorHandler(res, 400, liftCheck.msg);
      doc.elevator_ids = liftCheck.liftOids;
    }

    if (client_name !== undefined) doc.client_name = String(client_name).trim();
    if (client_email !== undefined) doc.client_email = String(client_email).trim();
    if (client_mobile !== undefined) doc.client_mobile = String(client_mobile).trim();
    if (client_address !== undefined) doc.client_address = String(client_address).trim();
    if (gst_no !== undefined) doc.gst_no = String(gst_no).trim();
    if (notes !== undefined) doc.notes = String(notes);
    if (terms_and_conditions !== undefined) doc.terms_and_conditions = String(terms_and_conditions);

    await doc.save();
    const populated = await Quotation.findById(doc._id).populate("project_id", "site_name client_name").lean();
    return ResponseOk(res, 200, "Updated", populated);
  } catch (e) {
    console.error("[UpdateQuotation]", e);
    return ErrorHandler(res, 500, e.message || "Server error");
  }
};

const DeleteQuotation = async (req, res) => {
  try {
    const id = req.params.id;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return ErrorHandler(res, 400, "Invalid id");
    }
    const doc = await Quotation.findById(id);
    if (!doc) return ErrorHandler(res, 404, "Not found");
    const project = await Project.findById(doc.project_id).lean();
    if (!project || !(await assertProjectAccess(req, project))) {
      return ErrorHandler(res, 403, "Access denied");
    }
    if (doc.status !== "Draft") {
      return ErrorHandler(res, 400, "Only Draft quotations can be deleted");
    }
    if ((doc.linked_invoice_ids || []).length > 0) {
      return ErrorHandler(res, 400, "Quotation has linked invoices");
    }
    await Quotation.deleteOne({ _id: doc._id });
    return ResponseOk(res, 200, "Deleted", { id });
  } catch (e) {
    console.error("[DeleteQuotation]", e);
    return ErrorHandler(res, 500, e.message || "Server error");
  }
};

const DuplicateQuotation = async (req, res) => {
  try {
    const id = req.params.id;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return ErrorHandler(res, 400, "Invalid id");
    }
    const src = await Quotation.findById(id).lean();
    if (!src) return ErrorHandler(res, 404, "Not found");
    const project = await Project.findById(src.project_id).lean();
    if (!project || !(await assertProjectAccess(req, project))) {
      return ErrorHandler(res, 403, "Access denied");
    }

    const quotation_number = await generateQuotationNumber();
    const items = (src.items || []).map((it) => {
      const o = { ...it };
      delete o._id;
      o.quantity_invoiced = 0;
      return o;
    });

    const lift_pricing_dup = (src.lift_pricing || []).map((lp) => {
      const o = { ...lp };
      delete o._id;
      o.invoiced_amount = 0;
      return o;
    });

    const doc = await Quotation.create({
      quotation_number,
      quotation_date: new Date(),
      status: "Draft",
      project_id: src.project_id,
      branch_id: src.branch_id,
      elevator_ids: src.elevator_ids || [],
      client_name: src.client_name,
      client_email: src.client_email,
      client_mobile: src.client_mobile,
      client_address: src.client_address,
      gst_no: src.gst_no,
      notes: src.notes,
      terms_and_conditions: src.terms_and_conditions,
      items,
      lift_pricing: lift_pricing_dup,
      gst_percentage: src.gst_percentage,
      subtotal: src.subtotal,
      gst_amount: src.gst_amount,
      total_amount: src.total_amount,
      created_by: req.auth?.id || null,
      linked_invoice_ids: [],
      converted_amc_id: null,
    });

    const populated = await Quotation.findById(doc._id).populate("project_id", "site_name client_name").lean();
    return ResponseOk(res, 201, "Duplicated", populated);
  } catch (e) {
    console.error("[DuplicateQuotation]", e);
    return ErrorHandler(res, 500, e.message || "Server error");
  }
};

const UpdateQuotationStatus = async (req, res) => {
  try {
    const id = req.params.id;
    const { status, rejected_reason } = req.body || {};
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return ErrorHandler(res, 400, "Invalid id");
    }
    if (!status) return ErrorHandler(res, 400, "status is required");

    const doc = await Quotation.findById(id);
    if (!doc) return ErrorHandler(res, 404, "Not found");
    const project = await Project.findById(doc.project_id).lean();
    if (!project || !(await assertProjectAccess(req, project))) {
      return ErrorHandler(res, 403, "Access denied");
    }

    const allowed = STATUS_FLOW[doc.status] || [];
    if (doc.status !== status && !allowed.includes(status)) {
      return ErrorHandler(res, 400, `Cannot move from ${doc.status} to ${status}`);
    }
    if (doc.status === status) {
      const populated = await Quotation.findById(doc._id).populate("project_id", "site_name client_name").lean();
      return ResponseOk(res, 200, "Unchanged", populated);
    }

    doc.status = status;
    if (status === "Rejected") {
      doc.rejected_reason = String(rejected_reason || "").trim();
    } else {
      doc.rejected_reason = "";
    }
    if (status === "Sent") doc.sent_at = new Date();
    if (status === "Approved") doc.approved_at = new Date();

    await doc.save();
    const populated = await Quotation.findById(doc._id).populate("project_id", "site_name client_name").lean();
    return ResponseOk(res, 200, "Status updated", populated);
  } catch (e) {
    console.error("[UpdateQuotationStatus]", e);
    return ErrorHandler(res, 500, e.message || "Server error");
  }
};

/** allocations: [{ itemIndex: 0-based, quantity: number }] or omit for full remaining qty per line */
const CreateInvoiceFromQuotation = async (req, res) => {
  try {
    const id = req.params.id;
    const { allocations, gst_percentage: bodyGst, due_date } = req.body || {};

    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return ErrorHandler(res, 400, "Invalid id");
    }
    const qdoc = await Quotation.findById(id);
    if (!qdoc) return ErrorHandler(res, 404, "Quotation not found");

    const project = await Project.findById(qdoc.project_id).lean();
    if (!project || !(await assertProjectAccess(req, project))) {
      return ErrorHandler(res, 403, "Access denied");
    }

    if (!["Approved"].includes(qdoc.status)) {
      return ErrorHandler(res, 400, "Quotation must be Approved before invoicing");
    }

    const itemsArr = qdoc.items || [];
    const useAlloc =
      Array.isArray(allocations) && allocations.length > 0
        ? allocations
        : itemsArr.map((_, idx) => ({ itemIndex: idx, quantity: null }));

    const invoiceItems = [];
    const newInvoiced = itemsArr.map((it) => ({
      id: it._id.toString(),
      qty: Number(it.quantity) || 0,
      invoiced: Number(it.quantity_invoiced) || 0,
    }));

    for (const a of useAlloc) {
      const idx = Number(a.itemIndex);
      if (!Number.isInteger(idx) || idx < 0 || idx >= itemsArr.length) {
        return ErrorHandler(res, 400, `Invalid itemIndex ${a.itemIndex}`);
      }
      const line = itemsArr[idx];
      const lineQty = Number(line.quantity) || 0;
      const already = Number(line.quantity_invoiced) || 0;
      let take =
        a.quantity != null && a.quantity !== ""
          ? Number(a.quantity)
          : Math.max(0, lineQty - already);
      if (take <= 0) continue;
      const remaining = lineQty - already;
      if (take > remaining + 1e-6) {
        return ErrorHandler(res, 400, `Line ${idx + 1}: only ${remaining} qty remaining`);
      }
      const rate = Number(line.rate) || 0;
      const total_price = Math.round(take * rate * 100) / 100;
      const descParts = [line.name, line.description].filter(Boolean);
      invoiceItems.push({
        description: descParts.join(" — "),
        quantity: take,
        unit_price: rate,
        total_price,
        lift_label: line.group_tag || undefined,
      });
      newInvoiced[idx].invoiced = already + take;
    }

    const liftPricingArr = Array.isArray(qdoc.lift_pricing) ? qdoc.lift_pricing : [];
    for (let li = 0; li < liftPricingArr.length; li++) {
      const lp = liftPricingArr[li];
      const amt = Number(lp.amount) || 0;
      const alreadyLift = Number(lp.invoiced_amount) || 0;
      const remainingLift = Math.max(0, amt - alreadyLift);
      if (remainingLift <= 1e-6) continue;
      const desc = [lp.lift_name, lp.floors ? `${lp.floors} fl.` : "", lp.maker].filter(Boolean).join(" — ");
      invoiceItems.push({
        description: `Lift charge${desc ? ` — ${desc}` : ""}`,
        quantity: 1,
        unit_price: remainingLift,
        total_price: Math.round(remainingLift * 100) / 100,
        lift_label: lp.lift_name || undefined,
      });
      const sub = qdoc.lift_pricing && qdoc.lift_pricing[li];
      if (sub) sub.invoiced_amount = Math.round((alreadyLift + remainingLift) * 100) / 100;
    }

    if (invoiceItems.length < 1) {
      return ErrorHandler(res, 400, "Nothing to invoice (quantities)");
    }

    const subtotal = invoiceItems.reduce((s, it) => s + (Number(it.total_price) || 0), 0);
    const gstPct =
      bodyGst != null && bodyGst !== "" ? Number(bodyGst) : Number(qdoc.gst_percentage) || 0;
    const tax_amount = Math.round(((subtotal * gstPct) / 100) * 100) / 100;
    const total_amount = Math.round((subtotal + tax_amount) * 100) / 100;

    const invoice_number = await generateInvoiceNumber();
    const inv = await Invoice.create({
      invoice_number,
      invoice_type: "COMBINED",
      project_id: qdoc.project_id,
      is_external: false,
      client_name: qdoc.client_name,
      client_email: qdoc.client_email,
      client_mobile: qdoc.client_mobile,
      client_address: qdoc.client_address,
      elevator_ids: qdoc.elevator_ids?.length ? qdoc.elevator_ids : [],
      contract_id: null,
      challan_id: null,
      quotation_id: qdoc._id,
      invoice_date: new Date(),
      due_date: due_date ? new Date(due_date) : null,
      subtotal,
      tax_amount,
      total_amount,
      paid_amount: 0,
      balance_amount: total_amount,
      status: "Draft",
      items: invoiceItems,
      branch_id: qdoc.branch_id || project.branch_id || null,
      created_by: req.auth?.id || null,
    });

    for (let i = 0; i < itemsArr.length; i++) {
      qdoc.items[i].quantity_invoiced = newInvoiced[i].invoiced;
    }
    qdoc.linked_invoice_ids = [...(qdoc.linked_invoice_ids || []), inv._id];

    const allItemsInvoiced = qdoc.items.every((it) => {
      const qn = Number(it.quantity) || 0;
      const qi = Number(it.quantity_invoiced) || 0;
      return qi >= qn - 1e-6;
    });
    const allLiftsInvoiced = (qdoc.lift_pricing || []).every((lp) => {
      const amt = Number(lp.amount) || 0;
      const inv = Number(lp.invoiced_amount) || 0;
      return amt <= 1e-6 || inv >= amt - 1e-6;
    });
    if (allItemsInvoiced && allLiftsInvoiced) {
      qdoc.status = "Converted";
    }

    await qdoc.save();

    return ResponseOk(res, 201, "Invoice created from quotation", { invoice: inv, quotation: qdoc });
  } catch (e) {
    console.error("[CreateInvoiceFromQuotation]", e);
    return ErrorHandler(res, 500, e.message || "Server error");
  }
};

const MarkConvertedAmc = async (req, res) => {
  try {
    const id = req.params.id;
    const { amc_id } = req.body || {};
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
      return ErrorHandler(res, 400, "Invalid quotation id");
    }
    if (!amc_id || !mongoose.Types.ObjectId.isValid(String(amc_id))) {
      return ErrorHandler(res, 400, "Valid amc_id is required");
    }
    const doc = await Quotation.findById(id);
    if (!doc) return ErrorHandler(res, 404, "Not found");
    const project = await Project.findById(doc.project_id).lean();
    if (!project || !(await assertProjectAccess(req, project))) {
      return ErrorHandler(res, 403, "Access denied");
    }
    if (doc.status !== "Approved") {
      return ErrorHandler(res, 400, "Quotation must be Approved");
    }
    doc.converted_amc_id = new mongoose.Types.ObjectId(String(amc_id));
    doc.status = "Converted";
    await doc.save();
    return ResponseOk(res, 200, "Linked to AMC", doc);
  } catch (e) {
    console.error("[MarkConvertedAmc]", e);
    return ErrorHandler(res, 500, e.message || "Server error");
  }
};

module.exports = {
  ListQuotations,
  GetQuotationById,
  CreateQuotation,
  UpdateQuotation,
  DeleteQuotation,
  DuplicateQuotation,
  UpdateQuotationStatus,
  CreateInvoiceFromQuotation,
  MarkConvertedAmc,
};
