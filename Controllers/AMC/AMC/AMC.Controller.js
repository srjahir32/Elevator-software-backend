const { AMC } = require("../../Models/AMC.model");
const { Quotation } = require("../../Models/Quotation.model");
const { Elevators } = require("../../Models/Project.model");
const { Users, User_Associate_With_Role, Roles } = require("../../Models/User.model");
const { ResponseOk, ErrorHandler } = require("../../Utils/ResponseHandler");
const { ActivityLog } = require("../../Models/Activitylog.model");
const { AMCRenewal } = require("../../Models/AMCRenewal.model");
const mongoose = require("mongoose");
const {
  getComprehensiveAmcDashboard,
  mongoDateKeys,
  wrapMatchWithServiceDue,
  parseISTStartOfDay,
  parseISTEndOfDay,
} = require("./AMCDashboardStats");
const { TZ } = require("../../Utils/dashboardTime");

const RENEWAL_DUE_DAYS = 30;

/** After AMC create: tie quotation to this contract when client opened AMC from quotation flow. */
async function linkQuotationAfterAmcCreate(amcDoc, body) {
  const raw = body.source_quotation_id;
  if (!raw || !mongoose.Types.ObjectId.isValid(String(raw))) return;
  try {
    const qdoc = await Quotation.findById(raw);
    if (!qdoc) return;
    const isExt = !!amcDoc.is_external;
    const qProj = String(qdoc.project_id);
    const amcProj = amcDoc.project_id ? String(amcDoc.project_id) : "";
    let match = false;
    if (!isExt && amcProj && qProj === amcProj) match = true;
    if (isExt) {
      const qm = String(qdoc.client_mobile || "").replace(/\D/g, "");
      const am = String(amcDoc.client_mobile || "").replace(/\D/g, "");
      if (qm && am && qm === am) match = true;
    }
    if (!match) return;
    if (qdoc.converted_amc_id && String(qdoc.converted_amc_id) !== String(amcDoc._id)) return;
    qdoc.converted_amc_id = amcDoc._id;
    qdoc.status = "Converted";
    await qdoc.save();
  } catch (e) {
    console.error("[CreateAMC] linkQuotationAfterAmcCreate", e);
  }
}

const emptyAmcDashboardPayload = {
  timezone: TZ,
  dateKeys: { today: null, tomorrow: null, monthStart: null, monthEnd: null },
  servicesDueToday: 0,
  servicesDueTomorrow: 0,
  servicesScheduledThisMonth: 0,
  renewalsToday: 0,
  renewalsThisMonth: 0,
  renewalOverdue: 0,
  renewalDueSoon: 0,
  complaintsOpenOrInProgress: 0,
  complaintsThisMonth: 0,
  complaintsThisMonthOpen: 0,
  complaintsThisMonthClosed: 0,
  complaintsByStatus: {},
  activeAMCCount: 0,
  totalAmcProjectsNonCancelled: 0,
  totalAmcRevenueBooked: 0,
  monthlyRevenue: 0,
  yearlyRevenue: 0,
  expiringSoonCount: 0,
  licenseeExpiringToday: 0,
  licenseeExpiringThisMonth: 0,
  licenseeOverdue: 0,
  charts: {
    revenueByMonth: [],
    complaintsByMonth: [],
    amcGrowthByMonth: [],
  },
};

/**
 * Compute display status for UI (date-based, not stored).
 * No "Upcoming" — contracts before start date still show Active. Active | Renewal Due | Expired | Cancelled
 */
function getDisplayStatus(amc) {
  if (amc.contract_status === "Cancelled") return "Cancelled";
  // Renewed / closed-out contracts stay "Completed" in UI (do not derive from dates)
  if (amc.contract_status === "Completed") return "Completed";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = amc.contract_start_date ? new Date(amc.contract_start_date) : null;
  const end = amc.contract_end_date ? new Date(amc.contract_end_date) : null;
  if (!start || !end) return amc.contract_status || "Pending";
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  if (today > end) return "Expired";
  const daysRemaining = Math.ceil((end - today) / (1000 * 60 * 60 * 24));
  if (today >= start && daysRemaining <= RENEWAL_DUE_DAYS) return "Renewal Due";
  return "Active";
}

/**
 * Add displayStatus to a single AMC object (mutates).
 */
function attachDisplayStatus(amc) {
  if (amc && typeof amc === "object") {
    if (amc.amc_record_status === "Archived") {
      amc.displayStatus = "Archived";
    } else {
      amc.displayStatus = getDisplayStatus(amc);
    }
  }
  return amc;
}

/** Mongo match: AMC rows that are the current (non-archived) record. */
function matchActiveAmcRecord() {
  return {
    $or: [{ amc_record_status: { $exists: false } }, { amc_record_status: "Active" }],
  };
}

function mergeWithActiveAmcRecord(inner) {
  const active = matchActiveAmcRecord();
  if (!inner || typeof inner !== "object") {
    return active;
  }
  if (inner.$and && Array.isArray(inner.$and)) {
    return { $and: [...inner.$and, active] };
  }
  return { $and: [inner, active] };
}

/**
 * Match AMC rows visible to a user by branch: primary `branch_id` or any id in `branch_ids`.
 * @param {mongoose.Types.ObjectId[]|null|undefined} userBranches
 * @param {string|null|undefined} singleBranchId - one branch (caller enforces assignment for non-admins)
 */
function amcBranchMatchForUserBranches(userBranches, singleBranchId = null) {
  if (singleBranchId) {
    const oid = new mongoose.Types.ObjectId(singleBranchId);
    return {
      $or: [{ branch_id: oid }, { branch_ids: oid }],
    };
  }
  const branches = Array.isArray(userBranches) ? userBranches.filter(Boolean) : [];
  return {
    $or: [
      { branch_id: { $in: branches } },
      { branch_ids: { $in: branches } },
    ],
  };
}

/** AMC document lies in this branch (primary or branch_ids). */
function amcInBranchMatch(singleBranchId) {
  const oid = new mongoose.Types.ObjectId(singleBranchId);
  return { $or: [{ branch_id: oid }, { branch_ids: oid }] };
}

/**
 * Non-admin: AMC visible if branch overlap OR user is supervisor OR assigned technician.
 * (Supervisors/staff often lack `users.branches` even when set on the AMC form.)
 */
function nonAdminAmcVisibilityMatch(user) {
  const uid = user._id;
  const branches = Array.isArray(user.branches) ? user.branches.filter(Boolean) : [];
  const orParts = [];
  if (branches.length) {
    orParts.push({ branch_id: { $in: branches } }, { branch_ids: { $in: branches } });
  }
  orParts.push({ supervisor_id: uid }, { technician_ids: uid });
  return { $or: orParts };
}

function contractRangesOverlap(aStart, aEnd, bStart, bEnd) {
  if (!aStart || !aEnd || !bStart || !bEnd) return false;
  const as = new Date(aStart).getTime();
  const ae = new Date(aEnd).getTime();
  const bs = new Date(bStart).getTime();
  const be = new Date(bEnd).getTime();
  if ([as, ae, bs, be].some((n) => Number.isNaN(n))) return false;
  return as <= be && bs <= ae;
}

/**
 * Find another active AMC for the same project (or same external client/site) whose contract dates overlap [newStart, newEnd].
 */
async function findOverlappingSiblingAmc(
  oldLean,
  newStart,
  newEnd,
  excludeId,
  allowOverlap,
  session
) {
  if (allowOverlap) return null;

  const exId = excludeId ? new mongoose.Types.ObjectId(String(excludeId)) : null;
  const base = {
    ...matchActiveAmcRecord(),
    contract_status: { $nin: ["Cancelled", "Draft"] },
    contract_start_date: { $exists: true, $ne: null },
    contract_end_date: { $exists: true, $ne: null },
  };
  if (exId) {
    base._id = { $ne: exId };
  }

  let projId = oldLean.project_id;
  if (projId && typeof projId === "object" && projId._id) projId = projId._id;

  let query;
  if (projId) {
    query = {
      ...base,
      project_id: new mongoose.Types.ObjectId(String(projId)),
    };
  } else if (oldLean.is_external) {
    const name = (oldLean.external_project_name || "").trim();
    const mob = (oldLean.client_mobile || "").trim();
    if (!name && !mob) return null;
    query = {
      ...base,
      is_external: true,
      $or: [{ project_id: null }, { project_id: { $exists: false } }],
    };
    if (name) query.external_project_name = name;
    if (mob) query.client_mobile = mob;
  } else {
    return null;
  }

  const q = AMC.find(query);
  if (session) q.session(session);
  const others = await q.lean();
  for (const o of others) {
    if (contractRangesOverlap(newStart, newEnd, o.contract_start_date, o.contract_end_date)) {
      return o;
    }
  }
  return null;
}

function toPlainSubdocumentArray(arr) {
  return (Array.isArray(arr) ? arr : []).map((x) =>
    x && typeof x.toObject === "function" ? x.toObject() : { ...x }
  );
}

/** Rich read-only context for renewal_history Term detail (matches AMC overview fields). */
function buildRenewalTermExtra(amc) {
  const project = amc.project_id && typeof amc.project_id === "object" ? amc.project_id : null;
  const elevators = Array.isArray(amc.elevator_ids) ? amc.elevator_ids : [];
  const techIds = Array.isArray(amc.technician_ids) ? amc.technician_ids : [];
  const techNames = techIds
    .map((t) => (t && typeof t === "object" ? t.name : null))
    .filter(Boolean);
  const sup = amc.supervisor_id && typeof amc.supervisor_id === "object" ? amc.supervisor_id : null;
  const branch = amc.branch_id && typeof amc.branch_id === "object" ? amc.branch_id : null;
  const assigned =
    amc.assigned_technician && typeof amc.assigned_technician === "object"
      ? amc.assigned_technician
      : null;

  return {
    contract_status_at_renewal: amc.contract_status,
    client_name: amc.client_name,
    client_email: amc.client_email,
    client_mobile: amc.client_mobile,
    client_address: amc.client_address,
    city: amc.city,
    area: amc.area,
    is_external: amc.is_external,
    external_project_name: amc.external_project_name,
    external_elevator_names: Array.isArray(amc.external_elevator_names) ? [...amc.external_elevator_names] : [],
    project_site_name: project?.site_name || project?.project_name || null,
    elevator_summaries: elevators.map((e) => ({
      name: e.elevator_name || e.name,
      _id: e._id,
    })),
    supervisor_name: sup?.name || null,
    technician_names_list: techNames.length ? techNames.join(", ") : null,
    assigned_technician_name: assigned?.name || null,
    assigned_technician_contact: assigned?.contact_number || null,
    branch_name: branch?.name || null,
    lifts: toPlainSubdocumentArray(amc.lifts),
    materials: toPlainSubdocumentArray(amc.materials),
    gst_percentage: amc.gst_percentage,
    include_gst: amc.include_gst,
    amc_type: amc.amc_type,
    agreement_no: amc.agreement_no,
    additional_notes: amc.additional_notes,
    terms_and_conditions: amc.terms_and_conditions,
    files: toPlainSubdocumentArray(amc.files),
    auto_renewal: amc.auto_renewal,
    renewal_reminder_days: amc.renewal_reminder_days,
    warranty_period_months: amc.warranty_period_months,
    warranty_start_date: amc.warranty_start_date,
    warranty_end_date: amc.warranty_end_date,
    emergency_contact_name: amc.emergency_contact_name,
    emergency_contact_number: amc.emergency_contact_number,
    technician_contact: amc.technician_contact,
  };
}

// Helper function to update contract status based on payment and dates
const updateContractStatus = async (amc) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const startDate = new Date(amc.contract_start_date);
  startDate.setHours(0, 0, 0, 0);

  const endDate = new Date(amc.contract_end_date);
  endDate.setHours(0, 0, 0, 0);

  const contractStarted = today >= startDate;
  const contractEnded = today > endDate;

  // Don't override terminal statuses (cancelled, or superseded by renewal)
  if (amc.contract_status === "Cancelled" || amc.contract_status === "Completed") {
    return;
  }

  // Before start date: still store as Active (no Pending/Upcoming lifecycle)
  if (!contractStarted) {
    amc.contract_status = "Active";
    return;
  }

  // Contract is active (within date range) - FIRST CHECK
  if (contractStarted && !contractEnded) {
    // Contract should be Active during its period
    // This allows for ongoing services even if all payments are received
    amc.contract_status = "Active";
    return;
  }

  // Contract period has ended — mark Expired (renewal archives the prior term in renewal_history; no duplicate AMC)
  if (contractEnded) {
    amc.contract_status = "Expired";
    return;
  }
};

// Only Admin and Supervisor can create/edit AMC
const canCreateOrEditAMC = async (req) => {
  if (!req.auth?.id) return false;
  const userRole = await User_Associate_With_Role.findOne({
    user_id: new mongoose.Types.ObjectId(req.auth.id),
  });
  if (!userRole) return false;
  const role = await Roles.findOne({ id: userRole.role_id });
  if (!role) return false;
  const name = (role.name || "").toLowerCase();
  return name === "admin" || name === "supervisor";
};

// Generate unique contract number
const generateContractNumber = async () => {
  const year = new Date().getFullYear();
  const prefix = `AMC-${year}-`;

  const lastContract = await AMC.findOne({
    contract_number: { $regex: `^${prefix}` },
  })
    .sort({ contract_number: -1 })
    .exec();

  let sequence = 1;
  if (lastContract) {
    const lastSequence = parseInt(
      lastContract.contract_number.split("-").pop()
    );
    sequence = lastSequence + 1;
  }

  return `${prefix}${sequence.toString().padStart(4, "0")}`;
};

/**
 * When contract end falls on the same calendar day as start (e.g. 1 Apr → 1 Apr next year),
 * treat the period as ending the previous day so recurring slots do not add an extra
 * anniversary row (12 monthly visits in a 12‑month term, not 13; one annual payment, not two).
 */
const effectiveEndForRecurrence = (startDate, endDate) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  if (end <= start) return end;
  if (end.getDate() === start.getDate()) {
    const adjusted = new Date(end);
    adjusted.setDate(adjusted.getDate() - 1);
    if (adjusted >= start) return adjusted;
  }
  return end;
};

const generateRecurringDates = (startDate, endDate, frequency) => {
  const start = new Date(startDate);
  const end = effectiveEndForRecurrence(startDate, endDate);
  let currentDate = new Date(start);

  const intervals = {
    Monthly: 1,
    Quarterly: 3,
    "Half-Yearly": 6,
    Annual: 12,
  };

  const months = intervals[frequency] ?? 1;
  const dates = [];

  while (currentDate <= end) {
    dates.push(new Date(currentDate));
    currentDate.setMonth(currentDate.getMonth() + months);
  }

  return dates;
};

const canonicalServiceLiftLabel = (lift, idx) => {
  const custom =
    lift?.lift_name != null && String(lift.lift_name).trim() !== ""
      ? String(lift.lift_name).trim()
      : "";
  if (custom) return custom;
  const maker = lift?.maker ? String(lift.maker).trim() : "";
  return maker ? `${maker} - Lift ${idx + 1}` : `Lift ${idx + 1}`;
};

/** Normalize lifts[] from API body */
function normalizeLiftsFromBody(liftsInput) {
  if (!Array.isArray(liftsInput)) return [];
  return liftsInput.map((l) => ({
    floors: Number(l.floors) || 0,
    lift_name:
      l.lift_name != null && String(l.lift_name).trim() !== ""
        ? String(l.lift_name).trim()
        : "",
    maker: l.maker != null ? String(l.maker) : "",
    operation_type: l.operation_type === "Manual" ? "Manual" : "Automatic",
    amount_with_material: Number(l.amount_with_material) || 0,
    amount_without_material: Number(l.amount_without_material) || 0,
  }));
}

/** Normalize materials[] so lift_index is a finite number or null (never NaN); coerce lift_id to ObjectId */
function normalizeMaterialsFromBody(materialsInput) {
  if (!Array.isArray(materialsInput)) return [];
  return materialsInput
    .filter((m) => m && String(m.name || "").trim())
    .map((m) => {
      let li = m.lift_index;
      if (li !== undefined && li !== null && li !== "") {
        const n = Number(li);
        li = Number.isFinite(n) ? n : null;
      } else {
        li = null;
      }
      let lid = m.lift_id;
      if (lid && typeof lid === "object" && lid._id != null) lid = lid._id;
      const out = {
        lift_index: li,
        name: String(m.name).trim(),
        quantity: Math.max(1, Number(m.quantity) || 1),
        price: Math.max(0, Number(m.price) || 0),
      };
      if (lid != null && lid !== "" && mongoose.isValidObjectId(String(lid))) {
        out.lift_id = new mongoose.Types.ObjectId(String(lid));
      }
      return out;
    });
}

/**
 * Service visits for the contract period. If `liftsForSchedule` has entries, repeats the full
 * date cycle once per lift with `lift_label` set (e.g. 2 lifts × 12 monthly = 24 rows).
 * If empty, one site-wide schedule without lift_label (legacy / single-elevator).
 */
const generateServiceSchedule = (startDate, endDate, frequency, liftsForSchedule = null) => {
  const dates = generateRecurringDates(startDate, endDate, frequency);
  const baseRows = dates.map((scheduled_date) => ({
    service_type: frequency,
    scheduled_date,
    service_status: "Pending",
  }));

  const lifts = Array.isArray(liftsForSchedule)
    ? liftsForSchedule.filter((l) => l != null)
    : [];

  if (lifts.length === 0) {
    return baseRows;
  }

  const out = [];
  for (let i = 0; i < baseRows.length; i++) {
    const row = baseRows[i];
    lifts.forEach((lift, idx) => {
      out.push({
        service_type: row.service_type,
        scheduled_date: new Date(row.scheduled_date),
        service_status: row.service_status,
        lift_label: canonicalServiceLiftLabel(lift, idx),
      });
    });
  }
  return out;
};

/** Lifts from `lifts[]`, or external AMC names as pseudo-lifts for per-lift schedules */
const resolveLiftsForServiceSchedule = (lifts, is_external, external_elevator_names) => {
  const arr = Array.isArray(lifts) ? lifts.filter((l) => l != null) : [];
  if (arr.length > 0) return arr;
  if (is_external && Array.isArray(external_elevator_names)) {
    return external_elevator_names
      .filter((n) => n != null && String(n).trim())
      .map((name) => ({ maker: String(name).trim() }));
  }
  return [];
};

/** Do not replace or auto-regenerate service rows once any visit has real progress */
const serviceScheduleHasProtectedRows = (schedule) =>
  (schedule || []).some((s) =>
    ["Completed", "In Progress"].includes(String(s?.service_status || ""))
  );

const paymentScheduleHasPaidRows = (schedule) =>
  (schedule || []).some((s) => s?.payment_status === "Paid");

// Generate payment schedule based on frequency
const generatePaymentSchedule = (startDate, endDate, frequency, totalAmount) => {
  const start = new Date(startDate);

  if (frequency === "One-Time") {
    return [
      {
        payment_date: new Date(start),
        amount: totalAmount,
        payment_status: "Pending",
      },
    ];
  }

  const dates = generateRecurringDates(startDate, endDate, frequency);
  const n = dates.length;
  if (n === 0) return [];

  const total = Number(totalAmount) || 0;
  const baseCents = Math.floor((total * 100) / n);
  let allocatedCents = 0;

  return dates.map((payment_date, i) => {
    const isLast = i === n - 1;
    const cents = isLast ? Math.round(total * 100) - allocatedCents : baseCents;
    if (!isLast) allocatedCents += baseCents;
    return {
      payment_date,
      amount: cents / 100,
      payment_status: "Pending",
    };
  });
};

const CreateAMC = async (req, res) => {
  try {
    const canEdit = await canCreateOrEditAMC(req);
    if (!canEdit) {
      return ErrorHandler(res, 403, "Only Admin and Supervisor can create AMC contracts");
    }

    let {
      elevator_ids,
      project_id,
      client_name,
      client_email,
      client_mobile,
      client_address,
      contract_start_date,
      contract_end_date,
      contract_duration_months,
      contract_amount,
      gst_amount,
      total_amount,
      payment_frequency,
      service_frequency,
      auto_renewal,
      renewal_reminder_days,
      amc_type,
      amc_payment_type,
      terms_and_conditions,
      additional_notes,
      assigned_technician,
      branch_id,
      service_schedule,
      payment_schedule,
      files,
      is_draft,
      is_external,
      external_project_name,
      external_elevator_names,
      type_of_elevator,
      operation_type,
      passenger_capacity,
      speed,
      no_of_floors,
      stops,
      opening_type,
      lift_well_width,
      lift_well_depth,
      car_enclouser_type,
      car_flooring_type,
      car_door_type,
      landing_door_type,
      clear_opening_height,
      clear_opening_width,
      false_ceiling,
      ms_door_frames,
      ard_system,
      overload_sensor,
      telephone,
      fan_blower,
      lop_cop,
      opening_center_telescope_no,
      handrail_box,
      rfid,
      tft_display,
      seal_size,
      rated_load,
      cabin_height,
      gst_percentage,
      include_gst,
      supervisor_id,
      technician_ids,
      branch_ids,
      city,
      area,
      agreement_no,
      previous_contract_amount,
      lifts,
      materials,
      source_quotation_id,
    } = req.body;

    const resolvedBranchId =
      branch_id ||
      (Array.isArray(branch_ids) && branch_ids.length > 0 ? branch_ids[0] : null);
    const techIds = Array.isArray(technician_ids)
      ? technician_ids
      : technician_ids
        ? [technician_ids]
        : [];
    const branchIdsArr = Array.isArray(branch_ids)
      ? branch_ids
      : branch_ids
        ? [branch_ids]
        : [];
    const resolvedAssignedTech =
      assigned_technician ||
      (techIds.length > 0 ? techIds[0] : undefined);

    const paymentKind = amc_payment_type === "Free" ? "Free" : "Paid";
    let liftsNorm = normalizeLiftsFromBody(lifts);

    // Auto: End date from Start + Duration
    if (contract_start_date && contract_duration_months && !contract_end_date) {
      const start = new Date(contract_start_date);
      start.setMonth(start.getMonth() + Number(contract_duration_months));
      contract_end_date = start;
    }
    // Auto: Total amount = Contract amount + GST
    if (contract_amount != null && total_amount == null) {
      total_amount = Number(contract_amount) + Number(gst_amount || 0);
    }

    // Validation with detailed error messages
    const missingFields = [];
    if (!is_draft) {
      if (!is_external) {
        if (!elevator_ids || (Array.isArray(elevator_ids) && elevator_ids.length === 0)) missingFields.push("Elevators");
        if (!project_id) missingFields.push("Project");
      } else {
        if (!external_project_name) missingFields.push("New AMC Name");
        if (!external_elevator_names || (Array.isArray(external_elevator_names) && external_elevator_names.length === 0)) missingFields.push("New Elevator Names");
      }
      if (!client_name) missingFields.push("Client Name");
      if (!client_mobile) missingFields.push("Client Mobile");
      if (!contract_start_date) missingFields.push("Contract Start Date");
      if (!contract_end_date) missingFields.push("Contract End Date");
      if (
        !resolvedBranchId ||
        !mongoose.Types.ObjectId.isValid(String(resolvedBranchId))
      ) {
        missingFields.push("Branch");
      }
      if (paymentKind === "Paid") {
        if (contract_amount == null || contract_amount === "") {
          missingFields.push("Contract Amount");
        } else if (!Number.isFinite(Number(contract_amount)) || Number(contract_amount) <= 0) {
          missingFields.push("Contract Amount (must be greater than 0 for Paid AMC)");
        }
        if (total_amount == null || total_amount === "") {
          missingFields.push("Total Amount");
        } else if (!Number.isFinite(Number(total_amount)) || Number(total_amount) <= 0) {
          missingFields.push("Total Amount (must be greater than 0 for Paid AMC)");
        }
      }
    } else {
      // For draft, at least basic info might be needed, but let's make it very flexible
      if (!is_external) {
        if ((!elevator_ids || elevator_ids.length === 0) && !project_id) {
          return ErrorHandler(res, 400, "Elevators or Project is required even for draft");
        }
      } else {
        if (!external_project_name && (!external_elevator_names || external_elevator_names.length === 0)) {
          return ErrorHandler(res, 400, "New AMC Name or New Elevator Names is required even for draft");
        }
      }
    }

    if (missingFields.length > 0) {
      return ErrorHandler(
        res,
        400,
        `Missing required fields: ${missingFields.join(", ")}`
      );
    }

    if (paymentKind === "Free") {
      contract_amount = 0;
      gst_amount = 0;
      total_amount = 0;
      include_gst = false;
      gst_percentage = 0;
      liftsNorm = liftsNorm.map((l) => ({
        ...l,
        amount_with_material: 0,
        amount_without_material: 0,
      }));
    }

    // Prevent duplicate active AMC for same elevators (only for internal elevators)
    if (!is_external && elevator_ids && Array.isArray(elevator_ids)) {
      for (const eid of elevator_ids) {
        const existingActive = await AMC.findOne({
          elevator_ids: eid,
          contract_status: "Active",
        });
        if (existingActive) {
          return ErrorHandler(
            res,
            400,
            `An active AMC already exists for elevator ${eid}. Please expire or cancel it before creating a new one.`
          );
        }

        // Check if elevator exists
        const elevator = await Elevators.findById(eid);
        if (!elevator) {
          return ErrorHandler(res, 404, `Elevator ${eid} not found`);
        }
      }
    }

    // Generate contract number
    const contract_number = await generateContractNumber();

    const totalAmountNum = total_amount != null ? Number(total_amount) : null;
    const startDate = contract_start_date ? new Date(contract_start_date) : null;
    const endDate = contract_end_date ? new Date(contract_end_date) : null;
    let durationMonths = Number(contract_duration_months) || 12;

    if (startDate && endDate && !contract_duration_months) {
      durationMonths = Math.round((endDate - startDate) / (1000 * 60 * 60 * 24 * 30.44));
    }

    const liftsForSchedule = resolveLiftsForServiceSchedule(
      liftsNorm,
      !!is_external,
      external_elevator_names
    );

    // Generate service schedule if not provided
    let finalServiceSchedule = service_schedule || [];
    if ((!service_schedule || service_schedule.length === 0) && startDate && endDate) {
      finalServiceSchedule = generateServiceSchedule(
        startDate,
        endDate,
        service_frequency || "Monthly",
        liftsForSchedule
      );
    }

    // Multi-lift AMC: bill yearly (one installment per year) while services stay per-lift / per frequency
    let resolvedPaymentFrequency = payment_frequency || "Annual";
    if (liftsForSchedule.length > 1) {
      resolvedPaymentFrequency = "Annual";
    }

    // Generate payment schedule if not provided
    let finalPaymentSchedule = payment_schedule || [];
    if ((!payment_schedule || payment_schedule.length === 0) && startDate && endDate && totalAmountNum != null) {
      finalPaymentSchedule = generatePaymentSchedule(
        startDate,
        endDate,
        resolvedPaymentFrequency,
        totalAmountNum
      );
    }

    const amcData = {
      contract_number,
      elevator_ids: is_external ? [] : (Array.isArray(elevator_ids) ? elevator_ids : (elevator_ids ? [elevator_ids] : [])),
      project_id: is_external ? null : project_id,
      is_external: !!is_external,
      external_project_name: is_external ? external_project_name : null,
      external_elevator_names: is_external ? (Array.isArray(external_elevator_names) ? external_elevator_names : (external_elevator_names ? [external_elevator_names] : [])) : [],
      client_name,
      client_email,
      client_mobile,
      client_address,
      contract_start_date: startDate,
      contract_end_date: endDate,
      contract_duration_months: durationMonths,
      contract_amount: contract_amount != null ? Number(contract_amount) : null,
      gst_amount: gst_amount != null ? Number(gst_amount) : 0,
      total_amount: totalAmountNum,
      payment_frequency: resolvedPaymentFrequency,
      service_frequency: service_frequency || "Monthly",
      service_schedule: finalServiceSchedule,
      payment_schedule: finalPaymentSchedule,
      total_paid_amount: 0,
      remaining_amount: totalAmountNum || 0,
      contract_status: is_draft ? "Draft" : "Active",
      auto_renewal: auto_renewal || false,
      renewal_reminder_days: renewal_reminder_days != null ? Number(renewal_reminder_days) : 30,
      amc_type: amc_type || "Comprehensive",
      amc_payment_type: paymentKind,
      gst_percentage:
        gst_percentage != null ? Number(gst_percentage) : 0,
      include_gst:
        typeof include_gst === "boolean" ? include_gst : true,
      total_services_completed: 0,
      total_services_pending: finalServiceSchedule?.length || 0,
      terms_and_conditions,
      additional_notes,
      assigned_technician: resolvedAssignedTech,
      supervisor_id: supervisor_id || null,
      technician_ids: techIds,
      branch_ids: branchIdsArr,
      branch_id: resolvedBranchId,
      city: city || null,
      area: area || null,
      agreement_no: agreement_no || null,
      previous_contract_amount:
        previous_contract_amount != null
          ? Number(previous_contract_amount)
          : 0,
      lifts: liftsNorm,
      materials: normalizeMaterialsFromBody(materials),
      files: Array.isArray(files) ? files : [],
      type_of_elevator,
      operation_type,
      passenger_capacity,
      speed,
      no_of_floors,
      stops,
      opening_type,
      lift_well_width,
      lift_well_depth,
      car_enclouser_type,
      car_flooring_type,
      car_door_type,
      landing_door_type,
      clear_opening_height,
      clear_opening_width,
      false_ceiling,
      ms_door_frames,
      ard_system,
      overload_sensor,
      telephone,
      fan_blower,
      lop_cop,
      opening_center_telescope_no,
      handrail_box,
      rfid,
      tft_display,
      seal_size,
      rated_load,
      cabin_height,
      amc_record_status: "Active",
    };

    if (startDate && endDate && (project_id || is_external)) {
      const overlapCreate = await findOverlappingSiblingAmc(
        {
          project_id: project_id || null,
          is_external: !!is_external,
          external_project_name,
          client_mobile,
        },
        startDate,
        endDate,
        null,
        false,
        null
      );
      if (overlapCreate) {
        return ErrorHandler(
          res,
          400,
          `An active AMC already overlaps this period for this project (${overlapCreate.contract_number}).`
        );
      }
    }

    const amc = await AMC.create(amcData);

    await linkQuotationAfterAmcCreate(amc, { source_quotation_id });

    try {
      const user_details = await Users.findById(req.auth.id);
      if (user_details) {
        await ActivityLog.create({
          user_id: req.auth?.id || null,
          user_name: user_details.name,
          action: "ADD_AMC",
          type: "Create",
          description: `${user_details.name} has created AMC contract ${contract_number}.`,
          title: "AMC Contract Added",
          project_id: project_id,
        });
      }
    } catch (logError) {
      console.error("[CreateAMC] ActivityLog Error:", logError);
    }

    return ResponseOk(res, 201, "AMC contract created successfully", amc);
  } catch (error) {
    console.error("[CreateAMC]", error);
    if (error.code === 11000) {
      return ErrorHandler(res, 400, "Contract number already exists");
    }
    return ErrorHandler(res, 500, "Server error while creating AMC contract");
  }
};

const ViewAMC = async (req, res) => {
  try {
    const {
      elevator_id,
      project_id,
      contract_status,
      displayStatus: displayStatusFilter,
      fromDate,
      toDate,
      contractEndFrom,
      contractEndTo,
      serviceDue,
      renewalOverdue,
      renewalDueSoon,
      minAmount,
      maxAmount,
      branchId,
      page = 1,
      limit = 100,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.query;

    const cleanBranchId = (branchId && branchId !== "null" && branchId !== "undefined") ? branchId : null;
    const listRecordMode = String(req.query.amcRecordStatus || "active").toLowerCase();

    const hasDashboardSlice = Boolean(
      serviceDue === "today" ||
        serviceDue === "tomorrow" ||
        (contractEndFrom && contractEndTo) ||
        renewalOverdue === "1" ||
        renewalOverdue === "true" ||
        renewalDueSoon === "1" ||
        renewalDueSoon === "true"
    );

    const matchStage = {};

    // Branch visibility logic
    if (req.auth && req.auth.id) {
      const userRole = await User_Associate_With_Role.findOne({
        user_id: new mongoose.Types.ObjectId(req.auth.id),
      });

      if (userRole) {
        const role = await Roles.findOne({ id: userRole.role_id });

        if (role && role.name !== "Admin") {
          const user = await Users.findById(req.auth.id);
          if (cleanBranchId) {
            const isAssigned = user.branches.some((b) => b.toString() === cleanBranchId);
            const inBranch = amcInBranchMatch(cleanBranchId);
            if (isAssigned) {
              Object.assign(matchStage, inBranch);
            } else {
              Object.assign(matchStage, {
                $and: [
                  inBranch,
                  { $or: [{ supervisor_id: user._id }, { technician_ids: user._id }] },
                ],
              });
            }
          } else {
            Object.assign(matchStage, nonAdminAmcVisibilityMatch(user));
          }
        } else if (cleanBranchId) {
          Object.assign(matchStage, amcBranchMatchForUserBranches([], cleanBranchId));
        }
      }
    }

    if (elevator_id) {
      matchStage.elevator_ids = new mongoose.Types.ObjectId(elevator_id);
    }

    if (project_id) {
      matchStage.project_id = new mongoose.Types.ObjectId(project_id);
    }

    if (listRecordMode === "archived") {
      matchStage.amc_record_status = "Archived";
    }

    if (contract_status) {
      matchStage.contract_status = contract_status;
    }

    // Display status filter (Active / Expired / Renewal Due) — skip when dashboard deep-link filters apply
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayEnd = new Date(today);
    todayEnd.setDate(todayEnd.getDate() + RENEWAL_DUE_DAYS);
    if (!hasDashboardSlice) {
      if (displayStatusFilter === "Active") {
        matchStage.contract_status = "Active";
        matchStage.contract_end_date = { $gt: todayEnd };
      } else if (displayStatusFilter === "Renewal Due") {
        matchStage.contract_status = "Active";
        matchStage.contract_end_date = { $gt: today, $lte: todayEnd };
      } else if (displayStatusFilter === "Expired") {
        matchStage.$and = [
          { contract_status: { $nin: ["Completed", "Cancelled"] } },
          {
            $or: [
              { contract_end_date: { $lt: today } },
              { contract_status: "Expired" },
            ],
          },
        ];
      } else if (displayStatusFilter === "Completed") {
        matchStage.contract_status = "Completed";
      } else if (displayStatusFilter === "Upcoming") {
        matchStage.contract_start_date = { $gt: today };
      }
    }

    if (fromDate || toDate) {
      matchStage.contract_start_date = matchStage.contract_start_date || {};
      if (fromDate) matchStage.contract_start_date.$gte = new Date(fromDate);
      if (toDate) matchStage.contract_start_date.$lte = new Date(toDate);
    }

    if (minAmount || maxAmount) {
      matchStage.total_amount = {};
      if (minAmount) matchStage.total_amount.$gte = Number(minAmount);
      if (maxAmount) matchStage.total_amount.$lte = Number(maxAmount);
    }

    const sortField = ["contract_start_date", "contract_end_date", "total_amount", "createdAt"].includes(sortBy) ? sortBy : "createdAt";
    const sortDir = sortOrder === "asc" ? 1 : -1;

    const skip = Math.max(0, (Number(page) - 1) * Number(limit));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));

    let finalMatch = matchStage;
    if (hasDashboardSlice) {
      const { todayKey, tomorrowKey, due30Key } = await mongoDateKeys();

      if (serviceDue === "today" || serviceDue === "tomorrow") {
        const dayKey = serviceDue === "today" ? todayKey : tomorrowKey;
        finalMatch = wrapMatchWithServiceDue({ ...matchStage }, dayKey);
      } else if (contractEndFrom && contractEndTo) {
        finalMatch = {
          ...matchStage,
          contract_status: "Active",
          contract_end_date: { $exists: true, $ne: null },
          $expr: {
            $and: [
              {
                $gte: [
                  {
                    $dateToString: {
                      format: "%Y-%m-%d",
                      date: "$contract_end_date",
                      timezone: TZ,
                    },
                  },
                  String(contractEndFrom),
                ],
              },
              {
                $lte: [
                  {
                    $dateToString: {
                      format: "%Y-%m-%d",
                      date: "$contract_end_date",
                      timezone: TZ,
                    },
                  },
                  String(contractEndTo),
                ],
              },
            ],
          },
        };
      } else if (renewalOverdue === "1" || renewalOverdue === "true") {
        finalMatch = {
          ...matchStage,
          contract_status: "Active",
          contract_end_date: {
            $exists: true,
            $ne: null,
            $lt: parseISTStartOfDay(todayKey),
          },
        };
      } else if (renewalDueSoon === "1" || renewalDueSoon === "true") {
        finalMatch = {
          ...matchStage,
          contract_status: "Active",
          contract_end_date: { $exists: true, $ne: null },
          $expr: {
            $and: [
              {
                $gte: [
                  {
                    $dateToString: {
                      format: "%Y-%m-%d",
                      date: "$contract_end_date",
                      timezone: TZ,
                    },
                  },
                  todayKey,
                ],
              },
              {
                $lte: [
                  {
                    $dateToString: {
                      format: "%Y-%m-%d",
                      date: "$contract_end_date",
                      timezone: TZ,
                    },
                  },
                  due30Key,
                ],
              },
            ],
          },
        };
      }
    }

    // Hide legacy rows that were superseded by renewal (old flow created a second AMC; keep only the active chain head)
    const hideSupersededLegacy =
      listRecordMode !== "archived" &&
      !hasDashboardSlice &&
      displayStatusFilter !== "Completed" &&
      !contract_status;
    if (hideSupersededLegacy) {
      finalMatch = {
        $and: [
          finalMatch,
          {
            $nor: [
              {
                contract_status: "Completed",
                renewal_date: { $exists: true, $ne: null },
              },
            ],
          },
        ],
      };
    }

    if (listRecordMode !== "archived") {
      finalMatch = mergeWithActiveAmcRecord(finalMatch);
    }

    const pipeline = [
      { $match: finalMatch },
      {
        $lookup: {
          from: "elevators",
          localField: "elevator_ids",
          foreignField: "_id",
          as: "elevators",
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
        $addFields: {
          elevator_names: {
            $concatArrays: [
              { $ifNull: ["$elevators.elevator_name", []] },
              { $ifNull: ["$external_elevator_names", []] }
            ]
          },
          elevator_name: {
            $reduce: {
              input: {
                $concatArrays: [
                  { $ifNull: ["$elevators.elevator_name", []] },
                  { $ifNull: ["$external_elevator_names", []] }
                ]
              },
              initialValue: "",
              in: {
                $cond: {
                  if: { $eq: ["$$value", ""] },
                  then: "$$this",
                  else: { $concat: ["$$value", ", ", "$$this"] }
                }
              }
            }
          },
          project_name: { $ifNull: ["$project.site_name", "$external_project_name"] },
        },
      },
      { $project: { elevators: 0, project: 0 } },
      {
        $lookup: {
          from: "users",
          localField: "supervisor_id",
          foreignField: "_id",
          as: "_list_supervisor",
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "technician_ids",
          foreignField: "_id",
          as: "_list_techs",
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "assigned_technician",
          foreignField: "_id",
          as: "_list_assigned",
        },
      },
      {
        $addFields: {
          supervisor_name: {
            $ifNull: [{ $arrayElemAt: ["$_list_supervisor.name", 0] }, null],
          },
          technician_names_list: {
            $let: {
              vars: {
                techStr: {
                  $reduce: {
                    input: { $ifNull: ["$_list_techs", []] },
                    initialValue: "",
                    in: {
                      $cond: {
                        if: { $eq: ["$$value", ""] },
                        then: "$$this.name",
                        else: { $concat: ["$$value", ", ", "$$this.name"] },
                      },
                    },
                  },
                },
                assignName: { $arrayElemAt: ["$_list_assigned.name", 0] },
              },
              in: {
                $cond: {
                  if: { $ne: ["$$techStr", ""] },
                  then: "$$techStr",
                  else: { $ifNull: ["$$assignName", ""] },
                },
              },
            },
          },
          lift_count: {
            $cond: {
              if: { $gt: [{ $size: { $ifNull: ["$lifts", []] } }, 0] },
              then: { $size: "$lifts" },
              else: {
                $add: [
                  { $size: { $ifNull: ["$elevator_ids", []] } },
                  { $size: { $ifNull: ["$external_elevator_names", []] } },
                ],
              },
            },
          },
        },
      },
      {
        $project: {
          _list_supervisor: 0,
          _list_techs: 0,
          _list_assigned: 0,
        },
      },
      { $sort: { [sortField]: sortDir } },
      { $skip: skip },
      { $limit: limitNum },
    ];

    const countPipeline = [
      { $match: finalMatch },
      { $count: "total" },
    ];
    const [countResult] = await AMC.aggregate(countPipeline);
    const total = countResult?.total ?? 0;

    const amcs = await AMC.aggregate(pipeline);

    amcs.forEach(attachDisplayStatus);

    return ResponseOk(res, 200, "AMC contracts retrieved successfully", {
      data: amcs,
      pagination: {
        page: Number(page),
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum) || 1,
      },
    });
  } catch (error) {
    console.error("[ViewAMC]", error);
    return ErrorHandler(
      res,
      500,
      "Server error while retrieving AMC contracts"
    );
  }
};

/** Paginated flat list of service_schedule rows across visible AMCs (branch-scoped). */
const ListServiceVisits = async (req, res) => {
  try {
    const {
      branchId,
      amcId,
      serviceStatus,
      scheduledFrom,
      scheduledTo,
      search,
      page = 1,
      limit = 50,
      sortOrder = "desc",
    } = req.query;

    const cleanBranchId =
      branchId && branchId !== "null" && branchId !== "undefined" ? branchId : null;

    const matchStage = {};

    if (req.auth && req.auth.id) {
      const userRole = await User_Associate_With_Role.findOne({
        user_id: new mongoose.Types.ObjectId(req.auth.id),
      });

      if (userRole) {
        const role = await Roles.findOne({ id: userRole.role_id });

        if (role && role.name !== "Admin") {
          const user = await Users.findById(req.auth.id);
          if (cleanBranchId) {
            const isAssigned = user.branches.some((b) => b.toString() === cleanBranchId);
            const inBranch = amcInBranchMatch(cleanBranchId);
            if (isAssigned) {
              Object.assign(matchStage, inBranch);
            } else {
              Object.assign(matchStage, {
                $and: [
                  inBranch,
                  { $or: [{ supervisor_id: user._id }, { technician_ids: user._id }] },
                ],
              });
            }
          } else {
            Object.assign(matchStage, nonAdminAmcVisibilityMatch(user));
          }
        } else if (cleanBranchId) {
          Object.assign(matchStage, amcBranchMatchForUserBranches([], cleanBranchId));
        }
      }
    }
    const baseMatch = mergeWithActiveAmcRecord({
      ...matchStage,
      contract_status: { $nin: ["Cancelled", "Draft"] },
      "service_schedule.0": { $exists: true },
    });

    const stagesBeforeFacet = [
      { $match: baseMatch },
    ];

    if (amcId && amcId !== "all") {
      stagesBeforeFacet.push({
        $match: { _id: new mongoose.Types.ObjectId(amcId) },
      });
    }

    stagesBeforeFacet.push({
      $unwind: { path: "$service_schedule", preserveNullAndEmptyArrays: false },
    });

    const statusParam = serviceStatus && String(serviceStatus).trim();
    if (statusParam && statusParam !== "all") {
      const statusList = statusParam.split(",").map((s) => s.trim()).filter(Boolean);
      const allowedStatuses = ["Pending", "In Progress", "Overdue", "Completed"];
      const valid = statusList.filter((s) => allowedStatuses.includes(s));
      if (valid.length > 0) {
        stagesBeforeFacet.push({
          $match: { "service_schedule.service_status": { $in: valid } },
        });
      }
    }

    const fromYmd = scheduledFrom && String(scheduledFrom).slice(0, 10);
    const toYmd = scheduledTo && String(scheduledTo).slice(0, 10);
    if (fromYmd && /^\d{4}-\d{2}-\d{2}$/.test(fromYmd)) {
      stagesBeforeFacet.push({
        $match: {
          "service_schedule.scheduled_date": { $gte: parseISTStartOfDay(fromYmd) },
        },
      });
    }
    if (toYmd && /^\d{4}-\d{2}-\d{2}$/.test(toYmd)) {
      stagesBeforeFacet.push({
        $match: {
          "service_schedule.scheduled_date": { $lte: parseISTEndOfDay(toYmd) },
        },
      });
    }

    stagesBeforeFacet.push(
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
        $addFields: {
          project_name: { $ifNull: ["$project.site_name", "$external_project_name"] },
        },
      }
    );

    const searchTrim = search && String(search).trim();
    if (searchTrim) {
      const esc = searchTrim.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      stagesBeforeFacet.push({
        $match: {
          $or: [
            { contract_number: { $regex: esc, $options: "i" } },
            { project_name: { $regex: esc, $options: "i" } },
            { "service_schedule.lift_label": { $regex: esc, $options: "i" } },
          ],
        },
      });
    }

    const sortDir = sortOrder === "asc" ? 1 : -1;
    const skip = Math.max(0, (Number(page) - 1) * Number(limit));
    const limitNum = Math.min(200, Math.max(1, Number(limit)));

    const [aggOut] = await AMC.aggregate([
      ...stagesBeforeFacet,
      {
        $facet: {
          meta: [{ $count: "total" }],
          data: [
            { $sort: { "service_schedule.scheduled_date": sortDir } },
            { $skip: skip },
            { $limit: limitNum },
            {
              $project: {
                _id: 0,
                amc_id: "$_id",
                contract_number: 1,
                project_name: 1,
                scheduled_date: "$service_schedule.scheduled_date",
                service_status: "$service_schedule.service_status",
                service_type: "$service_schedule.service_type",
                lift_label: "$service_schedule.lift_label",
                service_id: "$service_schedule._id",
              },
            },
          ],
        },
      },
    ]);

    const total = aggOut?.meta[0]?.total ?? 0;
    const data = aggOut?.data ?? [];

    return ResponseOk(res, 200, "Service visits retrieved successfully", {
      data,
      pagination: {
        page: Number(page),
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum) || 1,
      },
    });
  } catch (error) {
    console.error("[ListServiceVisits]", error);
    return ErrorHandler(res, 500, "Server error while retrieving service visits");
  }
};

const GetAMCSummary = async (req, res) => {
  try {
    const { branchId } = req.query;
    const matchStage = {};

    if (req.auth && req.auth.id) {
      const userRole = await User_Associate_With_Role.findOne({
        user_id: new mongoose.Types.ObjectId(req.auth.id),
      });
      if (userRole) {
        const role = await Roles.findOne({ id: userRole.role_id });
        if (role && role.name !== "Admin") {
          const user = await Users.findById(req.auth.id);
          if (branchId) {
            const isAssigned = user.branches.some((b) => b.toString() === branchId);
            const inBranch = amcInBranchMatch(branchId);
            if (isAssigned) {
              Object.assign(matchStage, inBranch);
            } else {
              Object.assign(matchStage, {
                $and: [
                  inBranch,
                  { $or: [{ supervisor_id: user._id }, { technician_ids: user._id }] },
                ],
              });
            }
          } else {
            Object.assign(matchStage, nonAdminAmcVisibilityMatch(user));
          }
        } else if (branchId) {
          Object.assign(matchStage, amcBranchMatchForUserBranches([], branchId));
        }
      }
    }

    const activeRecordFilter = mergeWithActiveAmcRecord({ ...matchStage });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayEnd = new Date(today);
    todayEnd.setDate(todayEnd.getDate() + RENEWAL_DUE_DAYS);

    const [total, active, renewalDue, archived] = await Promise.all([
      AMC.countDocuments(activeRecordFilter),
      AMC.countDocuments({
        ...activeRecordFilter,
        contract_status: "Active",
        contract_end_date: { $gt: todayEnd },
      }),
      AMC.countDocuments({
        ...activeRecordFilter,
        contract_status: "Active",
        contract_end_date: { $gt: today, $lte: todayEnd },
      }),
      AMC.countDocuments({
        ...matchStage,
        amc_record_status: "Archived",
      }),
    ]);

    // Same rules as list badges (attachDisplayStatus / getDisplayStatus) — avoids mismatch vs raw $lt on dates
    const forDisplayStatus = await AMC.find(activeRecordFilter)
      .select("contract_status contract_start_date contract_end_date amc_record_status")
      .lean();

    let expired = 0;
    for (const amc of forDisplayStatus) {
      if (getDisplayStatus(amc) === "Expired") expired += 1;
    }

    return ResponseOk(res, 200, "AMC summary", {
      total,
      active,
      expired,
      renewalDue,
      archived,
    });
  } catch (error) {
    console.error("[GetAMCSummary]", error);
    return ErrorHandler(res, 500, "Server error while fetching AMC summary");
  }
};

const GetAMCById = async (req, res) => {
  try {
    const { amcId } = req.query;

    if (!amcId) {
      return ErrorHandler(res, 400, "AMC ID is required");
    }

    const query = { _id: amcId };

    // Branch visibility logic
    if (req.auth && req.auth.id) {
      const userRole = await User_Associate_With_Role.findOne({
        user_id: new mongoose.Types.ObjectId(req.auth.id),
      });

      if (userRole) {
        const role = await Roles.findOne({ id: userRole.role_id });
        if (role && role.name !== "Admin") {
          const user = await Users.findById(req.auth.id);
          Object.assign(query, nonAdminAmcVisibilityMatch(user));
        }
      }
    }

    // Populate multiple elevators
    const amc = await AMC.findOne(query)
      .populate("elevator_ids", "elevator_name lift_maker type_of_elevator project_id")
      .populate({
        path: "materials.lift_id",
        select: "elevator_name lift_maker type_of_elevator",
      })
      .populate("project_id", "site_name site_address client_name")
      .populate("branch_id", "name")
      .populate("supervisor_id", "name email contact_number")
      .populate("assigned_technician", "name contact_number email")
      .populate("technician_ids", "name contact_number email")
      .populate("branch_ids", "name")
      .populate("previous_amc_id", "contract_number contract_start_date contract_end_date amc_record_status")
      .populate("superseded_by_amc_id", "contract_number contract_start_date contract_end_date amc_record_status");

    if (!amc) {
      return ErrorHandler(res, 404, "AMC contract not found or access denied");
    }

    const amcObj = amc.toObject ? amc.toObject() : amc;

    // Resolved names for external projects/elevators to match ViewAMC aggregation
    amcObj.project_name = amc.project_id?.site_name || amc.external_project_name;
    const internalNames = amc.elevator_ids?.map(e => e.elevator_name) || [];
    const externalNames = amc.external_elevator_names || [];
    amcObj.elevator_names = [...internalNames, ...externalNames];
    amcObj.elevator_name = amcObj.elevator_names.join(", ");

    attachDisplayStatus(amcObj);

    return ResponseOk(res, 200, "AMC contract retrieved successfully", amcObj);
  } catch (error) {
    console.error("[GetAMCById]", error);
    return ErrorHandler(res, 500, "Server error while retrieving AMC contract");
  }
};

const UpdateAMC = async (req, res) => {
  try {
    const canEdit = await canCreateOrEditAMC(req);
    if (!canEdit) {
      return ErrorHandler(res, 403, "Only Admin and Supervisor can edit AMC contracts");
    }

    const { amcId } = req.query;

    if (!amcId) {
      return ErrorHandler(res, 400, "AMC ID is required");
    }

    const query = { _id: amcId };

    // Branch visibility logic
    if (req.auth && req.auth.id) {
      const userRole = await User_Associate_With_Role.findOne({
        user_id: new mongoose.Types.ObjectId(req.auth.id),
      });

      if (userRole) {
        const role = await Roles.findOne({ id: userRole.role_id });
        if (role && role.name !== "Admin") {
          const user = await Users.findById(req.auth.id);
          Object.assign(query, nonAdminAmcVisibilityMatch(user));
        }
      }
    }

    const checkAMC = await AMC.findOne(query);
    if (!checkAMC) {
      return ErrorHandler(
        res,
        404,
        "AMC contract not found or unauthorized to update"
      );
    }

    if (checkAMC.amc_record_status === "Archived") {
      return ErrorHandler(res, 403, "Archived AMC contracts cannot be edited.");
    }

    if (checkAMC.contract_status === "Completed") {
      return ErrorHandler(
        res,
        403,
        "Completed AMC contracts cannot be edited. Use challans and invoices for this project."
      );
    }

    const allowedFields = [
      "client_name",
      "client_email",
      "client_mobile",
      "client_address",
      "contract_start_date",
      "contract_end_date",
      "contract_duration_months",
      "contract_amount",
      "gst_amount",
      "total_amount",
      "payment_frequency",
      "service_frequency",
      "auto_renewal",
      "renewal_reminder_days",
      "amc_type",
      "amc_payment_type",
      "terms_and_conditions",
      "additional_notes",
      "assigned_technician",
      "technician_contact",
      "emergency_contact_name",
      "emergency_contact_number",
      "warranty_period_months",
      "warranty_start_date",
      "warranty_end_date",
      "service_reminder_days",
      "contract_status",
      "service_schedule",
      "payment_schedule",
      "files",
      "is_external",
      "external_project_name",
      "external_elevator_names",
      "elevator_ids",
      "type_of_elevator",
      "operation_type",
      "passenger_capacity",
      "speed",
      "no_of_floors",
      "stops",
      "opening_type",
      "lift_well_width",
      "lift_well_depth",
      "car_enclouser_type",
      "car_flooring_type",
      "car_door_type",
      "landing_door_type",
      "clear_opening_height",
      "clear_opening_width",
      "false_ceiling",
      "ms_door_frames",
      "ard_system",
      "overload_sensor",
      "telephone",
      "fan_blower",
      "lop_cop",
      "opening_center_telescope_no",
      "handrail_box",
      "rfid",
      "tft_display",
      "seal_size",
      "rated_load",
      "cabin_height",
      "gst_percentage",
      "include_gst",
      "supervisor_id",
      "technician_ids",
      "branch_ids",
      "branch_id",
      "city",
      "area",
      "agreement_no",
      "previous_contract_amount",
      "lifts",
      "materials",
    ];

    const updateData = {};
    for (const key of allowedFields) {
      if (req.body[key] !== undefined) {
        // Convert date strings to Date objects
        if (key.includes("_date") && req.body[key]) {
          updateData[key] = new Date(req.body[key]);
        } else {
          updateData[key] = req.body[key];
        }
      }
    }

    if (updateData.lifts !== undefined) {
      updateData.lifts = normalizeLiftsFromBody(updateData.lifts);
    }

    if (updateData.materials !== undefined) {
      updateData.materials = normalizeMaterialsFromBody(updateData.materials);
    }

    if (
      Array.isArray(req.body.technician_ids) &&
      req.body.assigned_technician === undefined &&
      req.body.technician_ids.length > 0
    ) {
      updateData.assigned_technician = req.body.technician_ids[0];
    }
    if (
      req.body.branch_ids !== undefined &&
      Array.isArray(req.body.branch_ids) &&
      req.body.branch_ids.length > 0 &&
      req.body.branch_id === undefined
    ) {
      updateData.branch_id = req.body.branch_ids[0];
    }

    // Auto: Total amount = Contract amount + GST
    if (updateData.contract_amount !== undefined || updateData.gst_amount !== undefined) {
      const cAmt = updateData.contract_amount !== undefined ? Number(updateData.contract_amount) : Number(checkAMC.contract_amount || 0);
      const gAmt = updateData.gst_amount !== undefined ? Number(updateData.gst_amount) : Number(checkAMC.gst_amount || 0);
      updateData.total_amount = cAmt + gAmt;
    }

    // Recalculate remaining amount if total_amount or total_paid_amount changed
    if (updateData.total_amount !== undefined) {
      updateData.remaining_amount =
        updateData.total_amount - (checkAMC.total_paid_amount || 0);
    }

    // Auto: Duration calculation if dates are updated
    if (updateData.contract_start_date || updateData.contract_end_date) {
      const start = updateData.contract_start_date || checkAMC.contract_start_date;
      const end = updateData.contract_end_date || checkAMC.contract_end_date;
      if (start && end && !req.body.contract_duration_months) {
        updateData.contract_duration_months = Math.round(
          (new Date(end) - new Date(start)) / (1000 * 60 * 60 * 24 * 30.44)
        );
      }
    }

    if (updateData.service_schedule !== undefined) {
      const incoming = updateData.service_schedule;
      if (
        serviceScheduleHasProtectedRows(checkAMC.service_schedule) &&
        Array.isArray(incoming) &&
        incoming.length === 0
      ) {
        delete updateData.service_schedule;
      }
    }

    if (updateData.payment_schedule !== undefined) {
      const incoming = updateData.payment_schedule;
      if (
        paymentScheduleHasPaidRows(checkAMC.payment_schedule) &&
        Array.isArray(incoming) &&
        incoming.length === 0
      ) {
        delete updateData.payment_schedule;
      }
    }

    const updatedAMC = await AMC.findByIdAndUpdate(
      amcId,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    if (!updatedAMC) {
      return ErrorHandler(res, 404, "AMC contract not found");
    }

    // Handle Draft -> Active/Pending transition or maintaining Draft status
    const is_draft = req.body.is_draft;
    if (is_draft === true) {
      updatedAMC.contract_status = "Draft";
    } else if (is_draft === false && updatedAMC.contract_status === "Draft") {
      // Transitioning from Draft to Active/Pending - validate required fields
      const missingFields = [];
      const isExt = updatedAMC.is_external;
      if (!isExt) {
        if (!updatedAMC.elevator_ids || updatedAMC.elevator_ids.length === 0) missingFields.push("Elevators");
        if (!updatedAMC.project_id) missingFields.push("Project");
      } else {
        if (!updatedAMC.external_project_name) missingFields.push("New AMC Name");
        if (!updatedAMC.external_elevator_names || updatedAMC.external_elevator_names.length === 0) missingFields.push("New Elevator Names");
      }
      if (!updatedAMC.client_name) missingFields.push("Client Name");
      if (!updatedAMC.client_mobile) missingFields.push("Client Mobile");
      if (!updatedAMC.contract_start_date) missingFields.push("Contract Start Date");
      if (!updatedAMC.contract_end_date) missingFields.push("Contract End Date");
      if (updatedAMC.contract_amount == null || updatedAMC.contract_amount === "") missingFields.push("Contract Amount");
      if (updatedAMC.total_amount == null || updatedAMC.total_amount === "") missingFields.push("Total Amount");

      if (missingFields.length > 0) {
        // Rollback status if validation fails (actually we haven't saved the status change yet, but we should return error)
        return ErrorHandler(
          res,
          400,
          `Cannot submit AMC. Missing required fields: ${missingFields.join(", ")}`
        );
      }

      // If validation passes, set proper status based on date
      const startDate = new Date(updatedAMC.contract_start_date);
      updatedAMC.contract_status = "Active";
    }

    // Recalculate total_paid_amount if payment_schedule was updated
    if (updateData.payment_schedule) {
      const totalPaid = updatedAMC.payment_schedule
        .filter((payment) => payment.payment_status === "Paid")
        .reduce((sum, payment) => sum + (payment.amount || 0), 0);

      updatedAMC.total_paid_amount = totalPaid;
      updatedAMC.remaining_amount = updatedAMC.total_amount - updatedAMC.total_paid_amount;
    }

    // Auto-update contract status if dates or amounts changed (and not a draft)
    if (updatedAMC.contract_status !== "Draft" && (updateData.contract_start_date || updateData.contract_end_date ||
      updateData.total_amount || updateData.total_paid_amount || updateData.payment_schedule)) {
      await updateContractStatus(updatedAMC);
    }

    // Auto-generate schedules if missing or if fundamental fields changed (and it's a draft or schedules are empty)
    const fundamentalChanged = updateData.contract_start_date ||
      updateData.contract_end_date ||
      updateData.service_frequency ||
      updateData.payment_frequency ||
      updateData.total_amount;

    if (fundamentalChanged || (updatedAMC.service_schedule.length === 0 && updatedAMC.contract_start_date && updatedAMC.contract_end_date)) {
      if (updatedAMC.contract_status === "Draft" || updatedAMC.service_schedule.length === 0) {
        const startDate = updatedAMC.contract_start_date;
        const endDate = updatedAMC.contract_end_date;

        if (startDate && endDate) {
          const liftsForSchedule = resolveLiftsForServiceSchedule(
            updatedAMC.lifts,
            !!updatedAMC.is_external,
            updatedAMC.external_elevator_names
          );
          let payFreq = updatedAMC.payment_frequency || "Annual";
          if (liftsForSchedule.length > 1) {
            payFreq = "Annual";
          }

          // Generate/Regenerate service schedule (never wipe rows that are already completed / in progress)
          if (!req.body.service_schedule || req.body.service_schedule.length === 0) {
            if (!serviceScheduleHasProtectedRows(checkAMC.service_schedule)) {
              updatedAMC.service_schedule = generateServiceSchedule(
                startDate,
                endDate,
                updatedAMC.service_frequency || "Monthly",
                liftsForSchedule
              );
              updatedAMC.total_services_completed = 0;
              updatedAMC.total_services_pending = updatedAMC.service_schedule.length;
            } else {
              const sch = updatedAMC.service_schedule || [];
              updatedAMC.total_services_completed = sch.filter(
                (s) => s.service_status === "Completed"
              ).length;
              updatedAMC.total_services_pending = sch.filter((s) =>
                ["Pending", "In Progress", "Overdue"].includes(s.service_status)
              ).length;
            }
          }

          // Generate/Regenerate payment schedule (do not replace if anything is already paid)
          if ((!req.body.payment_schedule || req.body.payment_schedule.length === 0) && updatedAMC.total_amount != null) {
            if (!paymentScheduleHasPaidRows(checkAMC.payment_schedule)) {
              updatedAMC.payment_frequency = payFreq;
              updatedAMC.payment_schedule = generatePaymentSchedule(
                startDate,
                endDate,
                payFreq,
                updatedAMC.total_amount
              );
            }
          }
        }
      }
    }

    await updatedAMC.save();

    const user_details = await Users.findById(req.auth.id);
    await ActivityLog.create({
      user_id: req.auth?.id || null,
      user_name: user_details.name,
      action: "UPDATE_AMC",
      type: "Update",
      description: `${user_details.name} has updated AMC contract ${updatedAMC.contract_number}.`,
      title: "AMC Contract Updated",
      project_id: updatedAMC.project_id,
    });

    return ResponseOk(res, 200, "AMC contract updated successfully", updatedAMC);
  } catch (error) {
    console.error("[UpdateAMC]", error);
    return ErrorHandler(res, 500, "Server error while updating AMC contract");
  }
};

const UpdateServiceSchedule = async (req, res) => {
  try {
    const { amcId, serviceId } = req.query;
    const updateData = req.body;

    if (!amcId || !serviceId) {
      return ErrorHandler(res, 400, "AMC ID and Service ID are required");
    }

    const query = { _id: amcId };

    // Branch visibility logic
    if (req.auth && req.auth.id) {
      const userRole = await User_Associate_With_Role.findOne({
        user_id: new mongoose.Types.ObjectId(req.auth.id),
      });

      if (userRole) {
        const role = await Roles.findOne({ id: userRole.role_id });
        if (role && role.name !== "Admin") {
          const user = await Users.findById(req.auth.id);
          Object.assign(query, nonAdminAmcVisibilityMatch(user));
        }
      }
    }

    const amc = await AMC.findOne(query);
    if (!amc) {
      return ErrorHandler(
        res,
        404,
        "AMC contract not found or unauthorized"
      );
    }

    if (amc.amc_record_status === "Archived") {
      return ErrorHandler(res, 403, "Service schedule cannot be changed for an archived AMC.");
    }

    if (amc.contract_status === "Completed") {
      return ErrorHandler(
        res,
        403,
        "Service schedule cannot be changed for a completed AMC contract."
      );
    }

    const serviceIndex = amc.service_schedule.findIndex(
      (s) => s._id.toString() === serviceId
    );

    if (serviceIndex === -1) {
      return ErrorHandler(res, 404, "Service schedule not found");
    }

    // Update service schedule item
    const oldServiceStatus = amc.service_schedule[serviceIndex].service_status;

    Object.keys(updateData).forEach((key) => {
      if (updateData[key] !== undefined) {
        amc.service_schedule[serviceIndex][key] = updateData[key];
      }
    });

    // Update service counts if status changed
    if (updateData.service_status === "Completed" && oldServiceStatus !== "Completed") {
      amc.total_services_completed = (amc.total_services_completed || 0) + 1;
      amc.total_services_pending = Math.max(0, (amc.total_services_pending || 0) - 1);
      amc.last_service_date = updateData.completed_date || new Date();

      // Calculate next service date
      if (amc.service_frequency) {
        const nextServiceDate = new Date(amc.service_schedule[serviceIndex].scheduled_date);
        const intervals = {
          Monthly: 1,
          Quarterly: 3,
          "Half-Yearly": 6,
          Annual: 12,
        };
        const months = intervals[amc.service_frequency] || 1;
        nextServiceDate.setMonth(nextServiceDate.getMonth() + months);
        amc.next_service_date = nextServiceDate;
      }
    } else if (updateData.service_status !== "Completed" && oldServiceStatus === "Completed") {
      amc.total_services_completed = Math.max(0, (amc.total_services_completed || 0) - 1);
      amc.total_services_pending = (amc.total_services_pending || 0) + 1;
    }

    await amc.save();

    const user_details = await Users.findById(req.auth.id);
    await ActivityLog.create({
      user_id: req.auth?.id || null,
      user_name: user_details.name,
      action: "UPDATE_AMC_SERVICE",
      type: "Update",
      description: `${user_details.name} has updated service schedule for AMC ${amc.contract_number}.`,
      title: "AMC Service Updated",
      project_id: amc.project_id,
    });

    return ResponseOk(
      res,
      200,
      "Service schedule updated successfully",
      amc.service_schedule[serviceIndex]
    );
  } catch (error) {
    console.error("[UpdateServiceSchedule]", error);
    return ErrorHandler(
      res,
      500,
      "Server error while updating service schedule"
    );
  }
};

const UpdatePaymentSchedule = async (req, res) => {
  try {
    const { amcId, paymentId } = req.query;
    const updateData = req.body;

    if (!amcId || !paymentId) {
      return ErrorHandler(res, 400, "AMC ID and Payment ID are required");
    }

    const query = { _id: amcId };

    // Branch visibility logic
    if (req.auth && req.auth.id) {
      const userRole = await User_Associate_With_Role.findOne({
        user_id: new mongoose.Types.ObjectId(req.auth.id),
      });

      if (userRole) {
        const role = await Roles.findOne({ id: userRole.role_id });
        if (role && role.name !== "Admin") {
          const user = await Users.findById(req.auth.id);
          Object.assign(query, nonAdminAmcVisibilityMatch(user));
        }
      }
    }

    const amc = await AMC.findOne(query);
    if (!amc) {
      return ErrorHandler(
        res,
        404,
        "AMC contract not found or unauthorized"
      );
    }

    if (amc.amc_record_status === "Archived") {
      return ErrorHandler(res, 403, "Payment schedule cannot be changed for an archived AMC.");
    }

    if (amc.contract_status === "Completed") {
      return ErrorHandler(
        res,
        403,
        "Payment schedule cannot be changed for a completed AMC contract."
      );
    }

    const paymentIndex = amc.payment_schedule.findIndex(
      (p) => p._id.toString() === paymentId
    );

    if (paymentIndex === -1) {
      return ErrorHandler(res, 404, "Payment schedule not found");
    }

    // Update payment schedule item
    const oldPaymentStatus = amc.payment_schedule[paymentIndex].payment_status;
    const oldAmount = amc.payment_schedule[paymentIndex].amount;

    Object.keys(updateData).forEach((key) => {
      if (updateData[key] !== undefined) {
        amc.payment_schedule[paymentIndex][key] = updateData[key];
      }
    });

    // Recalculate total_paid_amount from all payments with status "Paid"
    // This ensures accuracy even if payments are added/edited manually
    const totalPaid = amc.payment_schedule
      .filter((payment) => payment.payment_status === "Paid")
      .reduce((sum, payment) => sum + (payment.amount || 0), 0);

    amc.total_paid_amount = totalPaid;
    amc.remaining_amount = amc.total_amount - amc.total_paid_amount;

    // Auto-update contract status based on payment and dates
    await updateContractStatus(amc);

    await amc.save();

    const user_details = await Users.findById(req.auth.id);
    await ActivityLog.create({
      user_id: req.auth?.id || null,
      user_name: user_details.name,
      action: "UPDATE_AMC_PAYMENT",
      type: "Update",
      description: `${user_details.name} has updated payment schedule for AMC ${amc.contract_number}.`,
      title: "AMC Payment Updated",
      project_id: amc.project_id,
    });

    return ResponseOk(
      res,
      200,
      "Payment schedule updated successfully",
      amc.payment_schedule[paymentIndex]
    );
  } catch (error) {
    console.error("[UpdatePaymentSchedule]", error);
    return ErrorHandler(
      res,
      500,
      "Server error while updating payment schedule"
    );
  }
};

const RenewAMC = async (req, res) => {
  try {
    const canEdit = await canCreateOrEditAMC(req);
    if (!canEdit) {
      return ErrorHandler(res, 403, "Only Admin and Supervisor can renew AMC contracts");
    }

    const { amcId } = req.query;
    const body = req.body || {};
    const allowOverlap =
      body.allow_overlapping_amc === true ||
      body.allow_overlapping_amc === "true" ||
      body.allowOverlap === true;

    if (!amcId) {
      return ErrorHandler(res, 400, "AMC ID is required");
    }

    const query = { _id: amcId };
    if (req.auth?.id) {
      const userRole = await User_Associate_With_Role.findOne({
        user_id: new mongoose.Types.ObjectId(req.auth.id),
      });
      if (userRole) {
        const role = await Roles.findOne({ id: userRole.role_id });
        if (role && role.name !== "Admin") {
          const user = await Users.findById(req.auth.id);
          Object.assign(query, nonAdminAmcVisibilityMatch(user));
        }
      }
    }

    let renewedObj;
    let previousContractNumber;

    try {
      // Multi-document transactions require a replica set. Local/dev MongoDB is often standalone
      // and throws → 500. Use ordered writes + rollback instead.
      const oldAMC = await AMC.findOne(query);
      if (!oldAMC) {
        const e = new Error("RENEW_NOT_FOUND");
        throw e;
      }

      if (oldAMC.amc_record_status === "Archived") {
        const e = new Error("RENEW_ARCHIVED");
        throw e;
      }

      if (oldAMC.contract_status === "Completed" || oldAMC.contract_status === "Cancelled") {
        const e = new Error("RENEW_TERMINAL");
        throw e;
      }

      previousContractNumber = oldAMC.contract_number;

      const startDate = body.contract_start_date
        ? new Date(body.contract_start_date)
        : body.new_start_date
          ? new Date(body.new_start_date)
          : new Date();

      let endDate = body.contract_end_date ? new Date(body.contract_end_date) : null;
      let durationMonths = Number(
        body.contract_duration_months != null
          ? body.contract_duration_months
          : oldAMC.contract_duration_months || 12
      );

      if (endDate && !Number.isNaN(endDate.getTime())) {
        durationMonths = Math.max(
          1,
          Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44))
        );
      } else {
        endDate = new Date(startDate);
        endDate.setMonth(endDate.getMonth() + durationMonths);
      }

      const oldLean = oldAMC.toObject();

      const overlapping = await findOverlappingSiblingAmc(
        oldLean,
        startDate,
        endDate,
        oldAMC._id,
        allowOverlap,
        null
      );
      if (overlapping) {
        const e = new Error("RENEW_OVERLAP");
        e.overlapContract = overlapping.contract_number;
        throw e;
      }

      const paymentKind = oldAMC.amc_payment_type || "Paid";

      let contractAmount =
        body.contract_amount != null ? Number(body.contract_amount) : Number(oldAMC.contract_amount || 0);
      let gstAmount =
        body.gst_amount != null ? Number(body.gst_amount) : Number(oldAMC.gst_amount || 0);
      if (paymentKind === "Free") {
        contractAmount = 0;
        gstAmount = 0;
      }

      const includeGst =
        typeof body.include_gst === "boolean" ? body.include_gst : oldAMC.include_gst !== false;

      let totalAmt;
      if (paymentKind === "Free") {
        totalAmt = 0;
      } else if (body.total_amount != null) {
        totalAmt = Number(body.total_amount);
      } else if (includeGst) {
        totalAmt = contractAmount + gstAmount;
      } else {
        totalAmt = contractAmount;
      }

      const prevContractAmtStored =
        body.previous_contract_amount != null
          ? Number(body.previous_contract_amount)
          : oldAMC.contract_amount != null
            ? Number(oldAMC.contract_amount)
            : 0;

      const newContractNumber = await generateContractNumber();

      const liftsForRenew = resolveLiftsForServiceSchedule(
        oldAMC.lifts,
        !!oldAMC.is_external,
        oldAMC.external_elevator_names
      );
      const renewPayFreq =
        liftsForRenew.length > 1 ? "Annual" : oldAMC.payment_frequency || "Annual";

      const newSchedule = generateServiceSchedule(
        startDate,
        endDate,
        oldAMC.service_frequency || "Monthly",
        liftsForRenew
      );

      const newPaymentSchedule =
        paymentKind === "Free" || totalAmt <= 0
          ? []
          : generatePaymentSchedule(startDate, endDate, renewPayFreq, totalAmt);

      const newDocRaw = oldAMC.toObject();
      delete newDocRaw._id;
      delete newDocRaw.createdAt;
      delete newDocRaw.updatedAt;
      delete newDocRaw.__v;

      Object.assign(newDocRaw, {
        contract_number: newContractNumber,
        contract_start_date: startDate,
        contract_end_date: endDate,
        contract_duration_months: durationMonths,
        payment_frequency: renewPayFreq,
        service_schedule: newSchedule,
        payment_schedule: newPaymentSchedule,
        total_paid_amount: 0,
        remaining_amount: totalAmt,
        contract_amount: contractAmount,
        gst_amount: gstAmount,
        total_amount: totalAmt,
        include_gst: includeGst,
        gst_percentage:
          body.gst_percentage != null ? Number(body.gst_percentage) : oldAMC.gst_percentage || 0,
        contract_status: "Active",
        amc_record_status: "Active",
        previous_amc_id: oldAMC._id,
        superseded_by_amc_id: null,
        renewal_history: [],
        renewal_date: null,
        previous_contract_amount: prevContractAmtStored,
        total_services_completed: 0,
        total_services_pending: newSchedule.length,
        last_service_date: null,
        next_service_date: null,
        /** Fresh term: do not copy material lines from the archived AMC */
        materials: [],
      });

      let created;
      try {
        const createdArr = await AMC.create([newDocRaw]);
        created = createdArr[0];
      } catch (createErr) {
        console.error("[RenewAMC] AMC.create", createErr);
        throw createErr;
      }

      try {
        oldAMC.amc_record_status = "Archived";
        oldAMC.superseded_by_amc_id = created._id;
        oldAMC.contract_status = "Completed";
        await oldAMC.save();

        await AMCRenewal.create([
          {
            original_amc_id: oldAMC._id,
            renewed_amc_id: created._id,
            original_contract_number: previousContractNumber,
            new_contract_number: created.contract_number,
            renewed_at: new Date(),
            renewed_by: req.auth?.id ? new mongoose.Types.ObjectId(req.auth.id) : null,
          },
        ]);
      } catch (afterErr) {
        await AMC.findByIdAndDelete(created._id);
        console.error("[RenewAMC] archive/link failed, rolled back new AMC", afterErr);
        throw afterErr;
      }

      const refreshed = await AMC.findById(created._id)
        .populate("elevator_ids", "elevator_name")
        .populate("project_id", "site_name")
        .populate("previous_amc_id", "contract_number contract_start_date contract_end_date");

      renewedObj = refreshed.toObject ? refreshed.toObject() : refreshed;
      attachDisplayStatus(renewedObj);
    } catch (err) {
      if (err.message === "RENEW_NOT_FOUND") {
        return ErrorHandler(res, 404, "AMC contract not found or access denied");
      }
      if (err.message === "RENEW_ARCHIVED") {
        return ErrorHandler(res, 400, "Archived AMC contracts cannot be renewed.");
      }
      if (err.message === "RENEW_TERMINAL") {
        return ErrorHandler(
          res,
          400,
          "Completed or cancelled contracts cannot be renewed. Open the current active AMC from the list."
        );
      }
      if (err.message === "RENEW_OVERLAP") {
        return ErrorHandler(
          res,
          400,
          `Another active AMC for this site overlaps the selected period (${err.overlapContract || "existing"}). Adjust dates or set allow_overlapping_amc to true.`
        );
      }
      throw err;
    }

    const user_details = await Users.findById(req.auth?.id);
    const logProjectId =
      renewedObj.project_id &&
      (typeof renewedObj.project_id === "object" && renewedObj.project_id._id != null
        ? renewedObj.project_id._id
        : renewedObj.project_id);
    await ActivityLog.create({
      user_id: req.auth?.id || null,
      user_name: user_details?.name,
      action: "RENEW_AMC",
      type: "Create",
      description: `${user_details?.name || "User"} renewed AMC ${previousContractNumber} → ${renewedObj.contract_number} (new AMC; previous archived). previousAmcId=${amcId}`,
      title: "AMC Contract Renewed",
      project_id: logProjectId || undefined,
    });

    return ResponseOk(res, 200, "AMC renewed successfully", {
      renewedAMC: renewedObj,
      previousContractNumber,
      previousAmcId: amcId,
      inPlaceRenewal: false,
    });
  } catch (error) {
    console.error("[RenewAMC]", error);
    return ErrorHandler(res, 500, "Server error while renewing AMC");
  }
};

const GetRenewalHistory = async (req, res) => {
  try {
    const { amcId } = req.query;
    if (!amcId) {
      return ErrorHandler(res, 400, "AMC ID is required");
    }

    const amc = await AMC.findById(amcId)
      .select("renewal_history contract_number")
      .lean();

    const rev = [...(amc?.renewal_history || [])].reverse();
    const embeddedTerms = rev.map((h, i) => ({
      kind: "embedded_term",
      _id: h._id,
      renewed_at: h.renewed_at,
      renewed_by: h.renewed_by,
      original_contract_number: h.contract_number,
      new_contract_number: i === 0 ? amc?.contract_number : rev[i - 1].contract_number,
      term_start_date: h.contract_start_date,
      term_end_date: h.contract_end_date,
      snapshot: h,
    }));

    const legacyLinks = await AMCRenewal.find({
      $or: [{ original_amc_id: amcId }, { renewed_amc_id: amcId }],
    })
      .sort({ renewed_at: -1 })
      .populate("original_amc_id", "contract_number contract_start_date contract_end_date")
      .populate("renewed_amc_id", "contract_number contract_start_date contract_end_date")
      .lean();

    const legacyMapped = legacyLinks.map((r) => ({ kind: "legacy_chain", ...r }));

    const merged = [...embeddedTerms, ...legacyMapped].sort(
      (a, b) => new Date(b.renewed_at || 0) - new Date(a.renewed_at || 0)
    );

    return ResponseOk(res, 200, "Renewal history", merged);
  } catch (error) {
    console.error("[GetRenewalHistory]", error);
    return ErrorHandler(res, 500, "Server error while fetching renewal history");
  }
};

const GetAMCDashboardStats = async (req, res) => {
  try {
    const { branchId } = req.query;
    const matchStage = {};
    let complaintBranchFilter;
    if (req.auth?.id) {
      const userRole = await User_Associate_With_Role.findOne({
        user_id: new mongoose.Types.ObjectId(req.auth.id),
      });
      if (userRole) {
        const role = await Roles.findOne({ id: userRole.role_id });
        if (role && role.name !== "Admin") {
          const user = await Users.findById(req.auth.id);
          if (branchId) {
            const isAssigned = user.branches.some((b) => b.toString() === branchId);
            const inBranch = amcInBranchMatch(branchId);
            complaintBranchFilter = new mongoose.Types.ObjectId(branchId);
            if (isAssigned) {
              Object.assign(matchStage, inBranch);
            } else {
              Object.assign(matchStage, {
                $and: [
                  inBranch,
                  { $or: [{ supervisor_id: user._id }, { technician_ids: user._id }] },
                ],
              });
            }
          } else {
            Object.assign(matchStage, nonAdminAmcVisibilityMatch(user));
            complaintBranchFilter = { $in: user.branches || [] };
          }
        } else if (branchId) {
          Object.assign(matchStage, amcBranchMatchForUserBranches([], branchId));
          complaintBranchFilter = new mongoose.Types.ObjectId(branchId);
        }
      }
    }

    if (complaintBranchFilter === undefined) {
      complaintBranchFilter = matchStage.branch_id;
    }
    const data = await getComprehensiveAmcDashboard(
      mergeWithActiveAmcRecord(matchStage),
      complaintBranchFilter
    );
    return ResponseOk(res, 200, "AMC dashboard stats", data);
  } catch (error) {
    console.error("[GetAMCDashboardStats]", error);
    return ErrorHandler(res, 500, "Server error while fetching AMC dashboard stats");
  }
};

/**
 * POST multipart form field "files" — returns [{ fileType, fileUrl }] for AMC attachments.
 */
const UploadAMCDocuments = async (req, res) => {
  try {
    const ok = await canCreateOrEditAMC(req);
    if (!ok) {
      return ErrorHandler(res, 403, "Only Admin and Supervisor can upload AMC documents");
    }
    const uploaded = req.files || [];
    if (!Array.isArray(uploaded) || uploaded.length === 0) {
      return ErrorHandler(res, 400, "No files uploaded");
    }
    const data = uploaded.map((file) => {
      const mime = file.mimetype || "";
      let fileType = "image";
      if (mime.startsWith("application/pdf")) fileType = "pdf";
      else if (mime.startsWith("video/")) fileType = "video";
      const sub = fileType === "pdf" ? "pdfs" : fileType === "video" ? "videos" : "images";
      const fileUrl = `/public/uploads/${sub}/${file.filename}`;
      return { fileType, fileUrl };
    });
    return ResponseOk(res, 200, "Files uploaded", data);
  } catch (error) {
    console.error("[UploadAMCDocuments]", error);
    return ErrorHandler(res, 500, error.message || "Server error while uploading files");
  }
};

const DeleteAMC = async (req, res) => {
  try {
    const { amcId } = req.query;
    const { password } = req.body;

    if (!amcId || !password) {
      return ErrorHandler(res, 400, "Password and AMC ID are required");
    }

    const query = { _id: amcId };

    // Branch visibility logic
    if (req.auth && req.auth.id) {
      const userRole = await User_Associate_With_Role.findOne({
        user_id: new mongoose.Types.ObjectId(req.auth.id),
      });

      if (userRole) {
        const role = await Roles.findOne({ id: userRole.role_id });
        if (role && role.name !== "Admin") {
          const user = await Users.findById(req.auth.id);
          Object.assign(query, nonAdminAmcVisibilityMatch(user));
        }
      }
    }

    const amc = await AMC.findOne(query);
    if (!amc) {
      return ErrorHandler(
        res,
        404,
        "AMC contract not found or unauthorized to delete"
      );
    }

    const email = req.auth.email;
    const user = await Users.findOne({
      $or: [email ? { email } : null].filter(Boolean),
    });

    if (!user) {
      return ErrorHandler(res, 404, "User not found");
    }

    const bcrypt = require("bcryptjs");
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return ErrorHandler(res, 400, "Invalid password");
    }

    const deletedAMC = await AMC.findByIdAndDelete(amcId);

    if (!deletedAMC) {
      return ErrorHandler(res, 404, "AMC contract not found");
    }

    const user_details = await Users.findById(req.auth.id);
    await ActivityLog.create({
      user_id: req.auth?.id || null,
      user_name: user_details.name,
      action: "DELETE_AMC",
      type: "Delete",
      description: `${user_details.name} has deleted AMC contract ${deletedAMC.contract_number}.`,
      title: "AMC Contract Deleted",
      project_id: deletedAMC.project_id,
    });

    return ResponseOk(res, 200, "AMC contract deleted successfully", deletedAMC);
  } catch (error) {
    console.error("[DeleteAMC]", error);
    return ErrorHandler(res, 500, "Server error while deleting AMC contract");
  }
};

module.exports = {
  CreateAMC,
  ViewAMC,
  ListServiceVisits,
  GetAMCSummary,
  GetAMCById,
  UpdateAMC,
  UpdateServiceSchedule,
  UpdatePaymentSchedule,
  RenewAMC,
  GetRenewalHistory,
  GetAMCDashboardStats,
  DeleteAMC,
  UploadAMCDocuments,
};

