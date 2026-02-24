const { AMC } = require("../../Models/AMC.model");
const { Elevators } = require("../../Models/Project.model");
const { Users, User_Associate_With_Role, Roles } = require("../../Models/User.model");
const { ResponseOk, ErrorHandler } = require("../../Utils/ResponseHandler");
const { ActivityLog } = require("../../Models/Activitylog.model");
const { AMCRenewal } = require("../../Models/AMCRenewal.model");
const mongoose = require("mongoose");

const RENEWAL_DUE_DAYS = 30;

/**
 * Compute display status for UI (date-based, not stored).
 * Upcoming | Active | Renewal Due | Expired | Cancelled
 */
function getDisplayStatus(amc) {
  if (amc.contract_status === "Cancelled") return "Cancelled";
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

  while (currentDate <= end) {
    schedule.push({
      service_type: frequency,
      scheduled_date: new Date(currentDate),
      service_status: "Pending",
    });

    currentDate.setMonth(currentDate.getMonth() + months);
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
  const totalMonths = Math.ceil(
    (end - start) / (1000 * 60 * 60 * 24 * 30)
  );
  const numberOfPayments = Math.ceil(totalMonths / months);
  const amountPerPayment = totalAmount / numberOfPayments;

  while (currentDate <= end) {
    schedule.push({
      payment_date: new Date(currentDate),
      amount: Math.round(amountPerPayment * 100) / 100,
      payment_status: "Pending",
    });

    currentDate.setMonth(currentDate.getMonth() + months);
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
      elevator_id,
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
      terms_and_conditions,
      additional_notes,
      assigned_technician,
      branch_id,
      service_schedule,
      payment_schedule,
      files,
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
    if (!elevator_id) missingFields.push("Elevator");
    if (!project_id) missingFields.push("Project");
    if (!client_name) missingFields.push("Client Name");
    if (!client_mobile) missingFields.push("Client Mobile");
    if (!contract_start_date) missingFields.push("Contract Start Date");
    if (!contract_end_date) missingFields.push("Contract End Date");
    if (contract_amount == null || contract_amount === "") missingFields.push("Contract Amount");
    if (total_amount == null || total_amount === "") missingFields.push("Total Amount");

    if (missingFields.length > 0) {
      return ErrorHandler(
        res,
        400,
        `Missing required fields: ${missingFields.join(", ")}`
      );
    }

    // Prevent duplicate active AMC for same elevator
    const existingActive = await AMC.findOne({
      elevator_id,
      contract_status: "Active",
    });
    if (existingActive) {
      return ErrorHandler(
        res,
        400,
        "An active AMC already exists for this elevator. Please expire or cancel it before creating a new one."
      );
    }

    // Check if elevator exists
    const elevator = await Elevators.findById(elevator_id);
    if (!elevator) {
      return ErrorHandler(res, 404, "Elevator not found");
    }

    // Generate contract number
    const contract_number = await generateContractNumber();

    const totalAmountNum = Number(total_amount);
    const startDate = new Date(contract_start_date);
    const endDate = new Date(contract_end_date);
    const durationMonths = contract_duration_months || Math.round((endDate - startDate) / (1000 * 60 * 60 * 24 * 30.44)) || 12;

    // Generate service schedule if not provided
    let finalServiceSchedule = service_schedule;
    if (!service_schedule || service_schedule.length === 0) {
      finalServiceSchedule = generateServiceSchedule(
        startDate,
        endDate,
        service_frequency || "Monthly"
      );
    }

    // Generate payment schedule if not provided
    let finalPaymentSchedule = payment_schedule;
    if (!payment_schedule || payment_schedule.length === 0) {
      finalPaymentSchedule = generatePaymentSchedule(
        startDate,
        endDate,
        payment_frequency || "Annual",
        totalAmountNum
      );
    }

    const amc = await AMC.create({
      contract_number,
      elevator_id,
      project_id,
      client_name,
      client_email,
      client_mobile,
      client_address,
      contract_start_date: startDate,
      contract_end_date: endDate,
      contract_duration_months: durationMonths,
      contract_amount: Number(contract_amount),
      gst_amount: Number(gst_amount || 0),
      total_amount: totalAmountNum,
      payment_frequency: payment_frequency || "Annual",
      service_frequency: service_frequency || "Monthly",
      service_schedule: finalServiceSchedule,
      payment_schedule: finalPaymentSchedule,
      total_paid_amount: 0,
      remaining_amount: totalAmountNum,
      contract_status: startDate <= new Date() ? "Active" : "Pending",
      auto_renewal: auto_renewal || false,
      renewal_reminder_days: renewal_reminder_days != null ? Number(renewal_reminder_days) : 30,
      amc_type: amc_type || "Comprehensive",
      total_services_completed: 0,
      total_services_pending: finalServiceSchedule.length,
      terms_and_conditions,
      additional_notes,
      assigned_technician,
      branch_id,
      files: Array.isArray(files) ? files : undefined,
    });

    const user_details = await Users.findById(req.auth.id);
    await ActivityLog.create({
      user_id: req.auth?.id || null,
      user_name: user_details.name,
      action: "ADD_AMC",
      type: "Create",
      description: `${user_details.name} has created AMC contract ${contract_number}.`,
      title: "AMC Contract Added",
      project_id: project_id,
    });

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
    } = req.query;

    const matchStage = {};

    // Branch visibility logic
    if (req.auth && req.auth.id) {
      const userRole = await User_Associate_With_Role.findOne({
        user_id: new mongoose.Types.ObjectId(req.auth.id),
      });

      if (userRole) {
        const role = await Roles.findOne({ id: userRole.role_id });

        if (role && role.name !== "Admin") {
          if (branchId) {
            const user = await Users.findById(req.auth.id);
            const isAssigned = user.branches.some(
              (b) => b.toString() === branchId
            );

            if (isAssigned) {
              matchStage.branch_id = new mongoose.Types.ObjectId(branchId);
            } else {
              return ErrorHandler(
                res,
                403,
                "You are not assigned to this branch"
              );
            }
          } else {
            const user = await Users.findById(req.auth.id);
            matchStage.branch_id = { $in: user.branches };
          }
        } else if (branchId) {
          matchStage.branch_id = new mongoose.Types.ObjectId(branchId);
        }
      }
    }

    if (elevator_id) {
      matchStage.elevator_id = new mongoose.Types.ObjectId(elevator_id);
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

    const sortField = ["contract_start_date", "contract_end_date", "total_amount", "createdAt"].includes(sortBy) ? sortBy : "createdAt";
    const sortDir = sortOrder === "asc" ? 1 : -1;

    const skip = Math.max(0, (Number(page) - 1) * Number(limit));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));

    const pipeline = [
      { $match: matchStage },
      {
        $lookup: {
          from: "elevators",
          localField: "elevator_id",
          foreignField: "_id",
          as: "elevator",
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
      { $unwind: { path: "$elevator", preserveNullAndEmptyArrays: true } },
      { $unwind: { path: "$project", preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          elevator_name: "$elevator.elevator_name",
          project_name: "$project.site_name",
        },
      },
      { $project: { elevator: 0, project: 0 } },
      { $sort: { [sortField]: sortDir } },
      { $skip: skip },
      { $limit: limitNum },
    ];

    const countPipeline = [
      { $match: matchStage },
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
          matchStage.branch_id = branchId
            ? (user.branches.some((b) => b.toString() === branchId) ? new mongoose.Types.ObjectId(branchId) : null)
            : { $in: user.branches };
        } else if (branchId) {
          matchStage.branch_id = new mongoose.Types.ObjectId(branchId);
        }
      }
    }
    if (matchStage.branch_id === null) {
      return ResponseOk(res, 200, "AMC summary", { total: 0, active: 0, expired: 0, renewalDue: 0 });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayEnd = new Date(today);
    todayEnd.setDate(todayEnd.getDate() + RENEWAL_DUE_DAYS);

    const [total, active, expired, renewalDue] = await Promise.all([
      AMC.countDocuments(matchStage),
      AMC.countDocuments({
        ...matchStage,
        contract_status: "Active",
        contract_end_date: { $gt: todayEnd },
      }),
      AMC.countDocuments({
        ...matchStage,
        $or: [
          { contract_end_date: { $lt: today } },
          { contract_status: "Expired" },
          { contract_status: "Completed" },
        ],
      }),
      AMC.countDocuments({
        ...matchStage,
        contract_status: "Active",
        contract_end_date: { $gt: today, $lte: todayEnd },
      }),
    ]);

    return ResponseOk(res, 200, "AMC summary", {
      total,
      active,
      expired,
      renewalDue,
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
          query.branch_id = { $in: user.branches || [] };
        }
      }
    }

    const amc = await AMC.findOne(query)
      .populate("elevator_id", "elevator_name type_of_elevator")
      .populate("project_id", "site_name site_address client_name")
      .populate("branch_id", "name");

    if (!amc) {
      return ErrorHandler(res, 404, "AMC contract not found or access denied");
    }

    const amcObj = amc.toObject ? amc.toObject() : amc;
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

    // Recalculate remaining amount if total_amount or total_paid_amount changed
    if (updateData.total_amount !== undefined) {
      updateData.remaining_amount =
        updateData.total_amount - (checkAMC.total_paid_amount || 0);
    }

    const updatedAMC = await AMC.findByIdAndUpdate(
      amcId,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    if (!updatedAMC) {
      return ErrorHandler(res, 404, "AMC contract not found");
    }

    // Recalculate total_paid_amount if payment_schedule was updated
    if (updateData.payment_schedule) {
      const totalPaid = updatedAMC.payment_schedule
        .filter((payment) => payment.payment_status === "Paid")
        .reduce((sum, payment) => sum + (payment.amount || 0), 0);
      
      updatedAMC.total_paid_amount = totalPaid;
      updatedAMC.remaining_amount = updatedAMC.total_amount - updatedAMC.total_paid_amount;
    }

    // Auto-update contract status if dates or amounts changed
    if (updateData.contract_start_date || updateData.contract_end_date || 
        updateData.total_amount || updateData.total_paid_amount || updateData.payment_schedule) {
      await updateContractStatus(updatedAMC);
      await updatedAMC.save();
    }

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
    const { new_start_date, contract_duration_months } = req.body || {};

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
          query.branch_id = { $in: user.branches || [] };
        }
      }
    }

    const oldAMC = await AMC.findOne(query)
      .populate("elevator_id", "elevator_name")
      .populate("project_id", "site_name");
    if (!oldAMC) {
      return ErrorHandler(res, 404, "AMC contract not found or access denied");
    }

    const startDate = new_start_date ? new Date(new_start_date) : new Date();
    const durationMonths = Number(contract_duration_months || oldAMC.contract_duration_months || 12);
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + durationMonths);

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
      oldAMC.total_amount || 0
    );

    const newAMC = await AMC.create({
      contract_number: newContractNumber,
      elevator_id: oldAMC.elevator_id,
      project_id: oldAMC.project_id,
      client_name: oldAMC.client_name,
      client_email: oldAMC.client_email,
      client_mobile: oldAMC.client_mobile,
      client_address: oldAMC.client_address,
      contract_start_date: startDate,
      contract_end_date: endDate,
      contract_duration_months: durationMonths,
      contract_amount: oldAMC.contract_amount,
      gst_amount: oldAMC.gst_amount,
      total_amount: oldAMC.total_amount,
      payment_frequency: oldAMC.payment_frequency,
      service_frequency: oldAMC.service_frequency,
      service_schedule: newSchedule,
      payment_schedule: newPaymentSchedule,
      total_paid_amount: 0,
      remaining_amount: oldAMC.total_amount,
      contract_status: "Active",
      auto_renewal: oldAMC.auto_renewal,
      renewal_reminder_days: oldAMC.renewal_reminder_days,
      amc_type: oldAMC.amc_type,
      terms_and_conditions: oldAMC.terms_and_conditions,
      additional_notes: oldAMC.additional_notes,
      assigned_technician: oldAMC.assigned_technician,
      technician_contact: oldAMC.technician_contact,
      emergency_contact_name: oldAMC.emergency_contact_name,
      emergency_contact_number: oldAMC.emergency_contact_number,
      warranty_period_months: oldAMC.warranty_period_months,
      warranty_start_date: oldAMC.warranty_start_date,
      warranty_end_date: oldAMC.warranty_end_date,
      service_reminder_days: oldAMC.service_reminder_days,
      branch_id: oldAMC.branch_id,
      total_services_completed: 0,
      total_services_pending: newSchedule.length,
    });

    oldAMC.contract_status = "Completed";
    await oldAMC.save();

    await AMCRenewal.create({
      original_amc_id: oldAMC._id,
      renewed_amc_id: newAMC._id,
      original_contract_number: oldAMC.contract_number,
      new_contract_number: newContractNumber,
      renewed_by: req.auth?.id || null,
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
    const { branchId } = req.query;
    const matchStage = {};
    if (req.auth?.id) {
      const userRole = await User_Associate_With_Role.findOne({
        user_id: new mongoose.Types.ObjectId(req.auth.id),
      });
      if (userRole) {
        const role = await Roles.findOne({ id: userRole.role_id });
        if (role && role.name !== "Admin") {
          const user = await Users.findById(req.auth.id);
          matchStage.branch_id = branchId
            ? (user.branches.some((b) => b.toString() === branchId) ? new mongoose.Types.ObjectId(branchId) : null)
            : { $in: user.branches };
        } else if (branchId) {
          matchStage.branch_id = new mongoose.Types.ObjectId(branchId);
        }
      }
    }
    if (matchStage.branch_id === null) {
      return ResponseOk(res, 200, "AMC dashboard stats", {
        activeAMCCount: 0,
        expiringSoonCount: 0,
        monthlyRevenue: 0,
      });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayEnd = new Date(today);
    todayEnd.setDate(todayEnd.getDate() + RENEWAL_DUE_DAYS);
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    endOfMonth.setHours(23, 59, 59, 999);

    const [activeAMCCount, expiringSoonCount, amcsWithPayments] = await Promise.all([
      AMC.countDocuments({
        ...matchStage,
        contract_status: "Active",
        contract_end_date: { $gt: today },
      }),
      AMC.countDocuments({
        ...matchStage,
        contract_status: "Active",
        contract_end_date: { $gt: today, $lte: todayEnd },
      }),
      AMC.find(
        { ...matchStage, "payment_schedule.paid_date": { $gte: startOfMonth, $lte: endOfMonth } },
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
  GetAMCSummary,
  GetAMCById,
  UpdateAMC,
  UpdateServiceSchedule,
  UpdatePaymentSchedule,
  RenewAMC,
  GetRenewalHistory,
  GetAMCDashboardStats,
  DeleteAMC,
};

