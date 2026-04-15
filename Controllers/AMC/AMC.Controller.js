const { AMC } = require("../../Models/AMC.model");
const { Elevators, Project } = require("../../Models/Project.model");
const { Users, User_Associate_With_Role, Roles } = require("../../Models/User.model");
const { ResponseOk, ErrorHandler } = require("../../Utils/ResponseHandler");
const { ActivityLog } = require("../../Models/Activitylog.model");
const { AMCRenewal } = require("../../Models/AMCRenewal.model");
const mongoose = require("mongoose");

const RENEWAL_DUE_DAYS = 30;

/** Branch ObjectIds valid for Mongo $in */
function toBranchObjectIds(branchIds) {
  if (!branchIds || !branchIds.length) return [];
  const out = [];
  for (const b of branchIds) {
    if (b == null) continue;
    const s = String(b);
    if (!mongoose.Types.ObjectId.isValid(s)) continue;
    out.push(new mongoose.Types.ObjectId(s));
  }
  return out;
}

/**
 * AMC.branch_id is sometimes null while the linked project has branch_id set.
 * Branch-filtered lists should include those AMCs when the project belongs to the branch(es).
 */
async function projectIdsForBranches(branchIds) {
  const bids = toBranchObjectIds(branchIds);
  if (!bids.length) return [];
  const rows = await Project.find({ branch_id: { $in: bids } }).select("_id").lean();
  return rows.map((r) => r._id);
}

function amcBranchOrProjectMatch(branchIds, projectIds) {
  const bids = toBranchObjectIds(branchIds);
  if (!bids.length) return null;
  const or = [{ branch_id: { $in: bids } }];
  if (projectIds && projectIds.length) {
    or.push({ project_id: { $in: projectIds } });
  }
  return { $or: or };
}

/**
 * Compute display status for UI (date-based, not stored).
 * Upcoming | Active | Renewal Due | Expired | Cancelled
 */
function getDisplayStatus(amc) {
  if (amc.amc_record_status === "Archived") return "Archived";
  if (amc.contract_status === "Cancelled") return "Cancelled";
  if (amc.contract_status === "Completed") return "Expired";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = amc.contract_start_date ? new Date(amc.contract_start_date) : null;
  const end = amc.contract_end_date ? new Date(amc.contract_end_date) : null;
  if (!start || !end) return amc.contract_status || "Pending";
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  if (today < start) return "Upcoming";
  if (today > end) return "Expired";
  const daysRemaining = Math.ceil((end - today) / (1000 * 60 * 60 * 24));
  if (daysRemaining <= RENEWAL_DUE_DAYS) return "Renewal Due";
  return "Active";
}

/**
 * Add displayStatus to a single AMC object (mutates).
 */
function attachDisplayStatus(amc) {
  if (amc && typeof amc === "object") {
    amc.displayStatus = getDisplayStatus(amc);
  }
  return amc;
}

function matchActiveAmcRecord() {
  return {
    $nor: [{ amc_record_status: "Archived" }, { amc_record_status: "archived" }],
  };
}

function mergeWithActiveAmcRecord(inner) {
  const active = matchActiveAmcRecord();
  if (!inner || typeof inner !== "object") return active;
  if (inner.$and && Array.isArray(inner.$and)) {
    return { $and: [...inner.$and, active] };
  }
  return { $and: [inner, active] };
}

// Helper function to update contract status based on payment and dates
const updateContractStatus = async (amc) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const startDate = new Date(amc.contract_start_date);
  startDate.setHours(0, 0, 0, 0);

  const endDate = new Date(amc.contract_end_date);
  endDate.setHours(0, 0, 0, 0);

  // Use small tolerance for floating point comparison
  const allPaymentsPaid = Math.abs((amc.total_paid_amount || 0) - (amc.total_amount || 0)) < 0.01;
  const contractStarted = today >= startDate;
  const contractEnded = today > endDate;

  // Don't update if contract is manually cancelled
  if (amc.contract_status === "Cancelled") {
    return;
  }

  // Contract hasn't started yet
  if (!contractStarted) {
    amc.contract_status = "Pending";
    return;
  }

  // Contract is active (within date range) - FIRST CHECK
  if (contractStarted && !contractEnded) {
    // Contract should be Active during its period
    // This allows for ongoing services even if all payments are received
    amc.contract_status = "Active";
    return;
  }

  // Contract period has ended - THEN CHECK FOR COMPLETION
  if (contractEnded) {
    if (allPaymentsPaid) {
      amc.contract_status = "Completed";
    } else {
      amc.contract_status = "Expired";
    }
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

// Generate service schedule based on frequency
const generateServiceSchedule = (startDate, endDate, frequency) => {
  const schedule = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  let currentDate = new Date(start);

  const intervals = {
    Monthly: 1,
    Quarterly: 3,
    "Half-Yearly": 6,
    Annual: 12,
  };

  const months = intervals[frequency] || 1;

  // Use strict `< end` to avoid adding a boundary-extra visit
  // (e.g. 1-year monthly should be 12 visits, not 13).
  while (currentDate < end) {
    schedule.push({
      service_type: frequency,
      scheduled_date: new Date(currentDate),
      service_status: "Pending",
    });

    currentDate.setMonth(currentDate.getMonth() + months);
  }

  if (schedule.length === 0) {
    schedule.push({
      service_type: frequency,
      scheduled_date: new Date(start),
      service_status: "Pending",
    });
  }

  return schedule;
};

// Generate payment schedule based on frequency
const generatePaymentSchedule = (startDate, endDate, frequency, totalAmount) => {
  const schedule = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  let currentDate = new Date(start);

  const intervals = {
    Monthly: 1,
    Quarterly: 3,
    "Half-Yearly": 6,
    Annual: 12,
    "One-Time": 0,
  };

  if (frequency === "One-Time") {
    schedule.push({
      payment_date: new Date(start),
      amount: totalAmount,
      payment_status: "Pending",
    });
    return schedule;
  }

  const months = intervals[frequency] || 12;
  const paymentDates = [];

  // Use strict `< end` to avoid duplicate boundary installment on exact tenures
  // (e.g. 1-year annual should generate 1 payment, not 2).
  while (currentDate < end) {
    paymentDates.push(new Date(currentDate));
    currentDate.setMonth(currentDate.getMonth() + months);
  }

  if (paymentDates.length === 0) {
    paymentDates.push(new Date(start));
  }

  const numberOfPayments = paymentDates.length;
  const roundedPerPayment =
    Math.round((Number(totalAmount) / numberOfPayments) * 100) / 100;

  let assigned = 0;
  for (let i = 0; i < paymentDates.length; i++) {
    const isLast = i === paymentDates.length - 1;
    const amount = isLast
      ? Math.round((Number(totalAmount) - assigned) * 100) / 100
      : roundedPerPayment;
    assigned += amount;
    schedule.push({
      payment_date: paymentDates[i],
      amount,
      payment_status: "Pending",
    });
  }

  return schedule;
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
      previous_contract_amount,
      amc_payment_type,
      include_gst,
      gst_percentage,
      payment_frequency,
      service_frequency,
      auto_renewal,
      renewal_reminder_days,
      amc_type,
      terms_and_conditions,
      additional_notes,
      assigned_technician,
      supervisor_id,
      technician_ids,
      branch_ids,
      branch_id,
      lifts,
      materials,
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
    } = req.body;



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
      if (contract_amount == null || contract_amount === "") missingFields.push("Contract Amount");
      if (total_amount == null || total_amount === "") missingFields.push("Total Amount");
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

    // Generate service schedule if not provided
    let finalServiceSchedule = service_schedule || [];
    if ((!service_schedule || service_schedule.length === 0) && startDate && endDate) {
      finalServiceSchedule = generateServiceSchedule(
        startDate,
        endDate,
        service_frequency || "Monthly"
      );
    }

    // Generate payment schedule if not provided
    let finalPaymentSchedule = payment_schedule || [];
    if ((!payment_schedule || payment_schedule.length === 0) && startDate && endDate && totalAmountNum != null) {
      finalPaymentSchedule = generatePaymentSchedule(
        startDate,
        endDate,
        payment_frequency || "Annual",
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
      previous_contract_amount: previous_contract_amount != null ? Number(previous_contract_amount) : 0,
      payment_frequency: payment_frequency || "Annual",
      service_frequency: service_frequency || "Monthly",
      amc_payment_type: amc_payment_type || "Paid",
      service_schedule: finalServiceSchedule,
      payment_schedule: finalPaymentSchedule,
      total_paid_amount: 0,
      remaining_amount: totalAmountNum || 0,
      contract_status: is_draft ? "Draft" : (startDate && startDate <= new Date() ? "Active" : "Pending"),
      auto_renewal: auto_renewal || false,
      renewal_reminder_days: renewal_reminder_days != null ? Number(renewal_reminder_days) : 30,
      amc_type: amc_type || "Comprehensive",
      include_gst: include_gst !== false,
      gst_percentage: gst_percentage != null ? Number(gst_percentage) : 0,
      total_services_completed: 0,
      total_services_pending: finalServiceSchedule?.length || 0,
      terms_and_conditions,
      additional_notes,
      assigned_technician:
        assigned_technician ||
        (Array.isArray(technician_ids) && technician_ids.length ? technician_ids[0] : null),
      supervisor_id: supervisor_id || null,
      technician_ids: Array.isArray(technician_ids) ? technician_ids : (technician_ids ? [technician_ids] : []),
      branch_ids: Array.isArray(branch_ids) ? branch_ids : (branch_ids ? [branch_ids] : []),
      lifts: Array.isArray(lifts) ? lifts : [],
      materials: Array.isArray(materials) ? materials : [],
      branch_id,
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
    };


    const amc = await AMC.create(amcData);

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
      minAmount,
      maxAmount,
      branchId,
      page = 1,
      limit = 100,
      sortBy = "createdAt",
      sortOrder = "desc",
      amcRecordStatus,
    } = req.query;

    const cleanBranchId = (branchId && branchId !== "null" && branchId !== "undefined") ? branchId : null;
    const listRecordMode = String(amcRecordStatus || "active").toLowerCase();

    const matchStage = {};

    // Branch visibility logic
    if (req.auth && req.auth.id) {
      const userRole = await User_Associate_With_Role.findOne({
        user_id: new mongoose.Types.ObjectId(req.auth.id),
      });

      if (userRole) {
        const role = await Roles.findOne({ id: userRole.role_id });
        const isAdminRole = role && /^admin$/i.test(String(role.name || "").trim());

        if (role && !isAdminRole) {
          if (cleanBranchId) {
            const user = await Users.findById(req.auth.id);
            const isAssigned = user.branches.some(
              (b) => b.toString() === cleanBranchId
            );

            if (isAssigned) {
              const pids = await projectIdsForBranches([cleanBranchId]);
              const br = amcBranchOrProjectMatch([cleanBranchId], pids);
              if (br) {
                matchStage.$and = [...(matchStage.$and || []), br];
              }
            } else {
              return ErrorHandler(
                res,
                403,
                "You are not assigned to this branch"
              );
            }
          } else {
            const user = await Users.findById(req.auth.id);
            const branches = user.branches || [];
            const pids = await projectIdsForBranches(branches);
            const br = amcBranchOrProjectMatch(branches, pids);
            if (br) {
              matchStage.$and = [...(matchStage.$and || []), br];
            }
          }
        } else if (isAdminRole && cleanBranchId) {
          const pids = await projectIdsForBranches([cleanBranchId]);
          const br = amcBranchOrProjectMatch([cleanBranchId], pids);
          if (br) {
            matchStage.$and = [...(matchStage.$and || []), br];
          }
        }
      }
    }

    if (elevator_id) {
      matchStage.elevator_ids = new mongoose.Types.ObjectId(elevator_id);
    }

    if (project_id) {
      matchStage.project_id = new mongoose.Types.ObjectId(project_id);
    }

    if (contract_status) {
      matchStage.contract_status = contract_status;
    }

    // Display status filter (Active / Expired / Renewal Due)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayEnd = new Date(today);
    todayEnd.setDate(todayEnd.getDate() + RENEWAL_DUE_DAYS);
    if (displayStatusFilter === "Active") {
      matchStage.contract_status = "Active";
      matchStage.contract_end_date = { $gt: todayEnd };
    } else if (displayStatusFilter === "Renewal Due") {
      matchStage.contract_status = "Active";
      matchStage.contract_end_date = { $gt: today, $lte: todayEnd };
    } else if (displayStatusFilter === "Expired") {
      matchStage.$or = [
        { contract_end_date: { $lt: today } },
        { contract_status: "Expired" },
        { contract_status: "Completed" },
      ];
    } else if (displayStatusFilter === "Upcoming") {
      matchStage.contract_start_date = { $gt: today };
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
    const renewalLinks = await AMCRenewal.find({}, "original_amc_id").lean();
    const renewedOriginalIds = renewalLinks
      .map((r) => (r?.original_amc_id ? new mongoose.Types.ObjectId(String(r.original_amc_id)) : null))
      .filter(Boolean);

    let listMatch = { ...matchStage };
    if (listRecordMode === "archived") {
      listMatch = {
        $and: [
          listMatch,
          {
            $or: [
              { amc_record_status: "Archived" },
              { superseded_by_amc_id: { $exists: true, $ne: null } },
              ...(renewedOriginalIds.length ? [{ _id: { $in: renewedOriginalIds } }] : []),
            ],
          },
        ],
      };
    } else {
      listMatch = {
        $and: [
          listMatch,
          {
            $nor: [{ amc_record_status: "Archived" }, { amc_record_status: "archived" }],
          },
          {
            $or: [
              { superseded_by_amc_id: { $exists: false } },
              { superseded_by_amc_id: null },
            ],
          },
          ...(renewedOriginalIds.length ? [{ _id: { $nin: renewedOriginalIds } }] : []),
        ],
      };
    }

    const sortField = ["contract_start_date", "contract_end_date", "total_amount", "createdAt"].includes(sortBy) ? sortBy : "createdAt";
    const sortDir = sortOrder === "asc" ? 1 : -1;

    const skip = Math.max(0, (Number(page) - 1) * Number(limit));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));

    const pipeline = [
      { $match: listMatch },
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
          let: { pid: "$project_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $ne: ["$$pid", null] },
                    {
                      $or: [
                        { $eq: ["$_id", "$$pid"] },
                        {
                          $eq: [
                            { $toString: "$_id" },
                            { $toString: "$$pid" },
                          ],
                        },
                      ],
                    },
                  ],
                },
              },
            },
            { $limit: 1 },
          ],
          as: "project",
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "technician_ids",
          foreignField: "_id",
          as: "technician_users",
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "assigned_technician",
          foreignField: "_id",
          as: "assigned_technician_user",
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "supervisor_id",
          foreignField: "_id",
          as: "supervisor_user",
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
          area: {
            $let: {
              vars: {
                a: "$area",
                p: "$project.area",
              },
              in: {
                $let: {
                  vars: {
                    ta: { $trim: { input: { $ifNull: ["$$a", ""] } } },
                    tp: { $trim: { input: { $ifNull: ["$$p", ""] } } },
                  },
                  in: {
                    $cond: [
                      { $gt: [{ $strLenCP: "$$ta" }, 0] },
                      "$$ta",
                      {
                        $cond: [
                          { $gt: [{ $strLenCP: "$$tp" }, 0] },
                          "$$tp",
                          null,
                        ],
                      },
                    ],
                  },
                },
              },
            },
          },
          city: {
            $let: {
              vars: {
                c: "$city",
                p: "$project.city",
              },
              in: {
                $let: {
                  vars: {
                    tc: { $trim: { input: { $ifNull: ["$$c", ""] } } },
                    tp: { $trim: { input: { $ifNull: ["$$p", ""] } } },
                  },
                  in: {
                    $cond: [
                      { $gt: [{ $strLenCP: "$$tc" }, 0] },
                      "$$tc",
                      {
                        $cond: [
                          { $gt: [{ $strLenCP: "$$tp" }, 0] },
                          "$$tp",
                          null,
                        ],
                      },
                    ],
                  },
                },
              },
            },
          },
          technician_names_list: {
            $reduce: {
              input: {
                $map: {
                  input: { $ifNull: ["$technician_users", []] },
                  as: "t",
                  in: "$$t.name",
                },
              },
              initialValue: "",
              in: {
                $cond: [
                  { $eq: ["$$value", ""] },
                  { $ifNull: ["$$this", ""] },
                  {
                    $cond: [
                      { $eq: ["$$this", null] },
                      "$$value",
                      { $concat: ["$$value", ", ", "$$this"] },
                    ],
                  },
                ],
              },
            },
          },
          supervisor_name: {
            $let: {
              vars: { s: { $arrayElemAt: ["$supervisor_user", 0] } },
              in: "$$s.name",
            },
          },
          assigned_technician: {
            $let: {
              vars: { a: { $arrayElemAt: ["$assigned_technician_user", 0] } },
              in: {
                _id: "$$a._id",
                name: "$$a.name",
              },
            },
          },
        },
      },
      { $project: { elevators: 0, project: 0, technician_users: 0, assigned_technician_user: 0, supervisor_user: 0 } },
      { $sort: { [sortField]: sortDir } },
      { $skip: skip },
      { $limit: limitNum },
    ];

    const countPipeline = [
      { $match: listMatch },
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

    const amcQuery = {};
    if (branchId && branchId !== "null" && branchId !== "undefined") {
      amcQuery.branch_id = new mongoose.Types.ObjectId(branchId);
    }
    if (amcId && amcId !== "all") {
      amcQuery._id = new mongoose.Types.ObjectId(amcId);
    }

    const amcs = await AMC.find(amcQuery)
      .select("contract_number project_id external_project_name service_schedule")
      .populate("project_id", "site_name")
      .lean();

    let rows = [];
    for (const amc of amcs) {
      const projectName = amc?.project_id?.site_name || amc?.external_project_name || "";
      const schedule = Array.isArray(amc?.service_schedule) ? amc.service_schedule : [];
      for (const s of schedule) {
        rows.push({
          amc_id: amc._id,
          contract_number: amc.contract_number,
          project_name: projectName,
          scheduled_date: s?.scheduled_date || null,
          service_status: s?.service_status || "Pending",
          service_type: s?.service_type || null,
          lift_label: s?.lift_label || null,
          service_id: s?._id || null,
        });
      }
    }

    if (serviceStatus && serviceStatus !== "all") {
      const set = new Set(
        String(serviceStatus)
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)
      );
      rows = rows.filter((r) => set.has(String(r.service_status || "")));
    }

    if (scheduledFrom) {
      const from = new Date(scheduledFrom);
      rows = rows.filter((r) => r.scheduled_date && new Date(r.scheduled_date) >= from);
    }
    if (scheduledTo) {
      const to = new Date(scheduledTo);
      to.setHours(23, 59, 59, 999);
      rows = rows.filter((r) => r.scheduled_date && new Date(r.scheduled_date) <= to);
    }

    if (search && String(search).trim() !== "") {
      const q = String(search).toLowerCase();
      rows = rows.filter((r) =>
        String(r.contract_number || "").toLowerCase().includes(q) ||
        String(r.project_name || "").toLowerCase().includes(q) ||
        String(r.lift_label || "").toLowerCase().includes(q)
      );
    }

    rows.sort((a, b) => {
      const ta = a.scheduled_date ? new Date(a.scheduled_date).getTime() : 0;
      const tb = b.scheduled_date ? new Date(b.scheduled_date).getTime() : 0;
      return sortOrder === "asc" ? ta - tb : tb - ta;
    });

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(200, Math.max(1, Number(limit) || 50));
    const total = rows.length;
    const start = (pageNum - 1) * limitNum;
    const data = rows.slice(start, start + limitNum);

    return ResponseOk(res, 200, "Service visits retrieved successfully", {
      data,
      pagination: {
        page: pageNum,
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
    const cleanBranchId =
      req.query.branchId && req.query.branchId !== "null" && req.query.branchId !== "undefined"
        ? req.query.branchId
        : null;
    const matchStage = {};

    if (req.auth && req.auth.id) {
      const userRole = await User_Associate_With_Role.findOne({
        user_id: new mongoose.Types.ObjectId(req.auth.id),
      });
      if (userRole) {
        const role = await Roles.findOne({ id: userRole.role_id });
        const isAdminRole = role && /^admin$/i.test(String(role.name || "").trim());
        if (role && !isAdminRole) {
          const user = await Users.findById(req.auth.id);
          if (cleanBranchId) {
            const isAssigned = user.branches.some((b) => b.toString() === cleanBranchId);
            if (!isAssigned) {
              return ErrorHandler(res, 403, "You are not assigned to this branch");
            }
            const pids = await projectIdsForBranches([cleanBranchId]);
            const br = amcBranchOrProjectMatch([cleanBranchId], pids);
            if (br) matchStage.$and = [...(matchStage.$and || []), br];
          } else {
            const branches = user.branches || [];
            if (!branches.length) {
              return ResponseOk(res, 200, "AMC summary", {
                total: 0,
                active: 0,
                expired: 0,
                renewalDue: 0,
                archived: 0,
              });
            }
            const pids = await projectIdsForBranches(branches);
            const br = amcBranchOrProjectMatch(branches, pids);
            if (br) matchStage.$and = [...(matchStage.$and || []), br];
          }
        } else if (isAdminRole && cleanBranchId) {
          const pids = await projectIdsForBranches([cleanBranchId]);
          const br = amcBranchOrProjectMatch([cleanBranchId], pids);
          if (br) matchStage.$and = [...(matchStage.$and || []), br];
        }
      }
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayEnd = new Date(today);
    todayEnd.setDate(todayEnd.getDate() + RENEWAL_DUE_DAYS);
    const renewalLinks = await AMCRenewal.find({}, "original_amc_id").lean();
    const renewedOriginalIds = renewalLinks
      .map((r) => (r?.original_amc_id ? new mongoose.Types.ObjectId(String(r.original_amc_id)) : null))
      .filter(Boolean);

    const activeRecordsFilter = {
      $and: [
        mergeWithActiveAmcRecord({ ...matchStage }),
        {
          $or: [
            { superseded_by_amc_id: { $exists: false } },
            { superseded_by_amc_id: null },
          ],
        },
        ...(renewedOriginalIds.length ? [{ _id: { $nin: renewedOriginalIds } }] : []),
      ],
    };

    const [total, active, expired, renewalDue, archived] = await Promise.all([
      AMC.countDocuments(activeRecordsFilter),
      AMC.countDocuments({
        ...activeRecordsFilter,
        contract_status: "Active",
        contract_end_date: { $gt: todayEnd },
      }),
      AMC.countDocuments({
        ...activeRecordsFilter,
        $or: [
          { contract_end_date: { $lt: today } },
          { contract_status: "Expired" },
          { contract_status: "Completed" },
        ],
      }),
      AMC.countDocuments({
        ...activeRecordsFilter,
        contract_status: "Active",
        contract_end_date: { $gt: today, $lte: todayEnd },
      }),
      AMC.countDocuments({
        ...matchStage,
        $or: [
          { amc_record_status: "Archived" },
          { superseded_by_amc_id: { $exists: true, $ne: null } },
          ...(renewedOriginalIds.length ? [{ _id: { $in: renewedOriginalIds } }] : []),
        ],
      }),
    ]);

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
        const isAdminRole = role && /^admin$/i.test(String(role.name || "").trim());
        if (role && !isAdminRole) {
          const user = await Users.findById(req.auth.id);
          query.branch_id = { $in: user.branches || [] };
        }
      }
    }

    // Populate multiple elevators
    const amc = await AMC.findOne(query)
      .populate("elevator_ids", "elevator_name type_of_elevator")
      .populate("project_id", "site_name site_address client_name")
      .populate("branch_id", "name")
      .populate("supervisor_id", "name email contact_number")
      .populate("technician_ids", "name email contact_number")
      .populate("assigned_technician", "name email contact_number")
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
        const isAdminRole = role && /^admin$/i.test(String(role.name || "").trim());
        if (role && !isAdminRole) {
          const user = await Users.findById(req.auth.id);
          query.branch_id = { $in: user.branches || [] };
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
      "previous_contract_amount",
      "payment_frequency",
      "service_frequency",
      "auto_renewal",
      "renewal_reminder_days",
      "amc_type",
      "amc_payment_type",
      "terms_and_conditions",
      "additional_notes",
      "assigned_technician",
      "supervisor_id",
      "technician_ids",
      "branch_ids",
      "lifts",
      "materials",
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
      updatedAMC.contract_status = startDate <= new Date() ? "Active" : "Pending";
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
          // Generate/Regenerate service schedule
          if (!req.body.service_schedule || req.body.service_schedule.length === 0) {
            updatedAMC.service_schedule = generateServiceSchedule(
              startDate,
              endDate,
              updatedAMC.service_frequency || "Monthly"
            );
            updatedAMC.total_services_pending = updatedAMC.service_schedule.length;
          }

          // Generate/Regenerate payment schedule
          if ((!req.body.payment_schedule || req.body.payment_schedule.length === 0) && updatedAMC.total_amount != null) {
            updatedAMC.payment_schedule = generatePaymentSchedule(
              startDate,
              endDate,
              updatedAMC.payment_frequency || "Annual",
              updatedAMC.total_amount
            );
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
        const isAdminRole = role && /^admin$/i.test(String(role.name || "").trim());
        if (role && !isAdminRole) {
          const user = await Users.findById(req.auth.id);
          query.branch_id = { $in: user.branches || [] };
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
        const isAdminRole = role && /^admin$/i.test(String(role.name || "").trim());
        if (role && !isAdminRole) {
          const user = await Users.findById(req.auth.id);
          query.branch_id = { $in: user.branches || [] };
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
    const {
      new_start_date,
      contract_start_date,
      contract_end_date,
      contract_duration_months,
      previous_contract_amount,
      contract_amount,
      gst_amount,
      total_amount,
      include_gst,
    } = req.body || {};

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
        const isAdminRole = role && /^admin$/i.test(String(role.name || "").trim());
        if (role && !isAdminRole) {
          const user = await Users.findById(req.auth.id);
          query.branch_id = { $in: user.branches || [] };
        }
      }
    }

    const oldAMC = await AMC.findOne(query)
      .populate("elevator_ids", "elevator_name")
      .populate("project_id", "site_name");
    if (!oldAMC) {
      return ErrorHandler(res, 404, "AMC contract not found or access denied");
    }

    if (oldAMC.amc_record_status === "Archived") {
      return ErrorHandler(res, 400, "Archived AMC contracts cannot be renewed.");
    }

    if (oldAMC.contract_status === "Cancelled") {
      return ErrorHandler(
        res,
        400,
        "Cancelled contracts cannot be renewed. Open the current active AMC from the list."
      );
    }

    const startDate = contract_start_date
      ? new Date(contract_start_date)
      : new_start_date
        ? new Date(new_start_date)
        : new Date();
    let endDate = contract_end_date ? new Date(contract_end_date) : null;
    let durationMonths = Number(contract_duration_months || oldAMC.contract_duration_months || 12);
    if (!endDate || Number.isNaN(endDate.getTime())) {
      endDate = new Date(startDate);
      endDate.setMonth(endDate.getMonth() + durationMonths);
    }

    const newContractNumber = await generateContractNumber();

    const newSchedule = generateServiceSchedule(
      startDate,
      endDate,
      oldAMC.service_frequency || "Monthly"
    );
    const newPaymentSchedule = generatePaymentSchedule(
      startDate,
      endDate,
      oldAMC.payment_frequency || "Annual",
      total_amount != null ? Number(total_amount) : oldAMC.total_amount || 0
    );

    const plainRefId = (ref) => {
      if (ref == null) return null;
      if (typeof ref === "object" && ref._id != null) return ref._id;
      return ref;
    };
    const plainRefIdArray = (arr) =>
      Array.isArray(arr) ? arr.map((x) => plainRefId(x)).filter((id) => id != null) : [];

    const cloneLiftLines = (lifts) => {
      if (!Array.isArray(lifts)) return [];
      return lifts.map((l) => {
        const o = l && typeof l.toObject === "function" ? l.toObject() : { ...(l || {}) };
        return {
          floors: o.floors != null ? Number(o.floors) : 0,
          lift_name: o.lift_name != null ? String(o.lift_name) : "",
          maker: o.maker != null ? String(o.maker) : "",
          operation_type: o.operation_type === "Manual" ? "Manual" : "Automatic",
          amount_with_material: o.amount_with_material != null ? Number(o.amount_with_material) : 0,
          amount_without_material: o.amount_without_material != null ? Number(o.amount_without_material) : 0,
        };
      });
    };

    const cloneMaterialLines = (materials) => {
      if (!Array.isArray(materials)) return [];
      return materials.map((m) => {
        const o = m && typeof m.toObject === "function" ? m.toObject() : { ...(m || {}) };
        return {
          lift_index: o.lift_index != null ? Number(o.lift_index) : null,
          lift_id: plainRefId(o.lift_id) || null,
          name: o.name != null ? String(o.name) : "",
          quantity: o.quantity != null ? Number(o.quantity) : 1,
          price: o.price != null ? Number(o.price) : 0,
        };
      });
    };

    const elevatorIdsPlain = plainRefIdArray(oldAMC.elevator_ids);
    const projectIdPlain = plainRefId(oldAMC.project_id);
    const supervisorIdPlain = plainRefId(oldAMC.supervisor_id);
    const technicianIdsPlain = plainRefIdArray(oldAMC.technician_ids);
    const branchIdsPlain = plainRefIdArray(oldAMC.branch_ids);

    const newAMC = await AMC.create({
      contract_number: newContractNumber,
      elevator_ids: elevatorIdsPlain,
      external_elevator_names: oldAMC.external_elevator_names,
      is_external: oldAMC.is_external,
      external_project_name: oldAMC.external_project_name,
      project_id: projectIdPlain,
      client_name: oldAMC.client_name,
      client_email: oldAMC.client_email,
      client_mobile: oldAMC.client_mobile,
      client_address: oldAMC.client_address,
      area: oldAMC.area,
      city: oldAMC.city,
      agreement_no: oldAMC.agreement_no,
      contract_start_date: startDate,
      contract_end_date: endDate,
      contract_duration_months: durationMonths,
      contract_amount: contract_amount != null ? Number(contract_amount) : oldAMC.contract_amount,
      gst_amount: gst_amount != null ? Number(gst_amount) : oldAMC.gst_amount,
      total_amount: total_amount != null ? Number(total_amount) : oldAMC.total_amount,
      gst_percentage: oldAMC.gst_percentage != null ? Number(oldAMC.gst_percentage) : 0,
      include_gst: typeof include_gst === "boolean" ? include_gst : oldAMC.include_gst,
      amc_payment_type: oldAMC.amc_payment_type || "Paid",
      previous_contract_amount:
        previous_contract_amount != null
          ? Number(previous_contract_amount)
          : (oldAMC.contract_amount != null ? Number(oldAMC.contract_amount) : 0),
      payment_frequency: oldAMC.payment_frequency,
      service_frequency: oldAMC.service_frequency,
      service_schedule: newSchedule,
      payment_schedule: newPaymentSchedule,
      total_paid_amount: 0,
      remaining_amount: total_amount != null ? Number(total_amount) : oldAMC.total_amount,
      contract_status: "Active",
      amc_record_status: "Active",
      previous_amc_id: oldAMC._id,
      superseded_by_amc_id: null,
      auto_renewal: oldAMC.auto_renewal,
      renewal_reminder_days: oldAMC.renewal_reminder_days,
      amc_type: oldAMC.amc_type,
      terms_and_conditions: oldAMC.terms_and_conditions,
      additional_notes: oldAMC.additional_notes,
      supervisor_id: supervisorIdPlain,
      technician_ids: technicianIdsPlain,
      assigned_technician: plainRefId(oldAMC.assigned_technician),
      technician_contact: oldAMC.technician_contact,
      lifts: cloneLiftLines(oldAMC.lifts),
      materials: cloneMaterialLines(oldAMC.materials),
      branch_ids: branchIdsPlain,
      emergency_contact_name: oldAMC.emergency_contact_name,
      emergency_contact_number: oldAMC.emergency_contact_number,
      warranty_period_months: oldAMC.warranty_period_months,
      warranty_start_date: oldAMC.warranty_start_date,
      warranty_end_date: oldAMC.warranty_end_date,
      service_reminder_days: oldAMC.service_reminder_days,
      branch_id: plainRefId(oldAMC.branch_id) || oldAMC.branch_id,
      total_services_completed: 0,
      total_services_pending: newSchedule.length,
    });

    oldAMC.contract_status = "Completed";
    oldAMC.amc_record_status = "Archived";
    oldAMC.superseded_by_amc_id = newAMC._id;
    await oldAMC.save();

    await AMCRenewal.create({
      original_amc_id: oldAMC._id,
      renewed_amc_id: newAMC._id,
      original_contract_number: oldAMC.contract_number,
      new_contract_number: newContractNumber,
      renewed_by: req.auth?.id ? new mongoose.Types.ObjectId(req.auth.id) : null,
    });

    const user_details = await Users.findById(req.auth?.id);
    await ActivityLog.create({
      user_id: req.auth?.id || null,
      user_name: user_details?.name,
      action: "RENEW_AMC",
      type: "Update",
      description: `${user_details?.name || "User"} renewed AMC ${oldAMC.contract_number} as ${newContractNumber}.`,
      title: "AMC Contract Renewed",
      project_id: oldAMC.project_id,
    });

    const newAMCObj = newAMC.toObject ? newAMC.toObject() : newAMC;
    attachDisplayStatus(newAMCObj);

    return ResponseOk(res, 200, "AMC renewed successfully", {
      renewedAMC: newAMCObj,
      previousContractNumber: oldAMC.contract_number,
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
    const history = await AMCRenewal.find({
      $or: [{ original_amc_id: amcId }, { renewed_amc_id: amcId }],
    })
      .sort({ renewed_at: -1 })
      .populate("original_amc_id", "contract_number contract_start_date contract_end_date")
      .populate("renewed_amc_id", "contract_number contract_start_date contract_end_date");
    return ResponseOk(res, 200, "Renewal history", history);
  } catch (error) {
    console.error("[GetRenewalHistory]", error);
    return ErrorHandler(res, 500, "Server error while fetching renewal history");
  }
};

const GetAMCDashboardStats = async (req, res) => {
  try {
    const cleanBranchId =
      req.query.branchId && req.query.branchId !== "null" && req.query.branchId !== "undefined"
        ? req.query.branchId
        : null;
    const matchStage = {};
    if (req.auth?.id) {
      const userRole = await User_Associate_With_Role.findOne({
        user_id: new mongoose.Types.ObjectId(req.auth.id),
      });
      if (userRole) {
        const role = await Roles.findOne({ id: userRole.role_id });
        const isAdminRole = role && /^admin$/i.test(String(role.name || "").trim());
        if (role && !isAdminRole) {
          const user = await Users.findById(req.auth.id);
          if (cleanBranchId) {
            const isAssigned = user.branches.some((b) => b.toString() === cleanBranchId);
            if (!isAssigned) {
              return ErrorHandler(res, 403, "You are not assigned to this branch");
            }
            const pids = await projectIdsForBranches([cleanBranchId]);
            const br = amcBranchOrProjectMatch([cleanBranchId], pids);
            if (br) matchStage.$and = [...(matchStage.$and || []), br];
          } else {
            const branches = user.branches || [];
            if (!branches.length) {
              return ResponseOk(res, 200, "AMC dashboard stats", {
                activeAMCCount: 0,
                expiringSoonCount: 0,
                monthlyRevenue: 0,
              });
            }
            const pids = await projectIdsForBranches(branches);
            const br = amcBranchOrProjectMatch(branches, pids);
            if (br) matchStage.$and = [...(matchStage.$and || []), br];
          }
        } else if (isAdminRole && cleanBranchId) {
          const pids = await projectIdsForBranches([cleanBranchId]);
          const br = amcBranchOrProjectMatch([cleanBranchId], pids);
          if (br) matchStage.$and = [...(matchStage.$and || []), br];
        }
      }
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayEnd = new Date(today);
    todayEnd.setDate(todayEnd.getDate() + RENEWAL_DUE_DAYS);
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    endOfMonth.setHours(23, 59, 59, 999);

    const renewalLinksDash = await AMCRenewal.find({}, "original_amc_id").lean();
    const renewedOriginalIdsDash = renewalLinksDash
      .map((r) => (r?.original_amc_id ? new mongoose.Types.ObjectId(String(r.original_amc_id)) : null))
      .filter(Boolean);

    const activeRecordsFilterDash = {
      $and: [
        mergeWithActiveAmcRecord({ ...matchStage }),
        {
          $or: [
            { superseded_by_amc_id: { $exists: false } },
            { superseded_by_amc_id: null },
          ],
        },
        ...(renewedOriginalIdsDash.length ? [{ _id: { $nin: renewedOriginalIdsDash } }] : []),
      ],
    };

    const [activeAMCCount, expiringSoonCount, amcsWithPayments] = await Promise.all([
      AMC.countDocuments({
        ...activeRecordsFilterDash,
        contract_status: "Active",
        contract_end_date: { $gt: today },
      }),
      AMC.countDocuments({
        ...activeRecordsFilterDash,
        contract_status: "Active",
        contract_end_date: { $gt: today, $lte: todayEnd },
      }),
      AMC.find(
        {
          ...activeRecordsFilterDash,
          "payment_schedule.paid_date": { $gte: startOfMonth, $lte: endOfMonth },
        },
        { payment_schedule: 1 }
      ).lean(),
    ]);

    let monthlyRevenue = 0;
    for (const amc of amcsWithPayments || []) {
      for (const p of amc.payment_schedule || []) {
        if (p.payment_status === "Paid" && p.paid_date) {
          const d = new Date(p.paid_date);
          if (d >= startOfMonth && d <= endOfMonth) {
            monthlyRevenue += p.amount || 0;
          }
        }
      }
    }

    return ResponseOk(res, 200, "AMC dashboard stats", {
      activeAMCCount,
      expiringSoonCount,
      monthlyRevenue,
    });
  } catch (error) {
    console.error("[GetAMCDashboardStats]", error);
    return ErrorHandler(res, 500, "Server error while fetching AMC dashboard stats");
  }
};

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
        const isAdminRole = role && /^admin$/i.test(String(role.name || "").trim());
        if (role && !isAdminRole) {
          const user = await Users.findById(req.auth.id);
          query.branch_id = { $in: user.branches || [] };
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

