const { AMC } = require("../../Models/AMC.model");
const { Elevators } = require("../../Models/Project.model");
const { Users, User_Associate_With_Role, Roles } = require("../../Models/User.model");
const { ResponseOk, ErrorHandler } = require("../../Utils/ResponseHandler");
const { ActivityLog } = require("../../Models/Activitylog.model");
const mongoose = require("mongoose");

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
    const {
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
      terms_and_conditions,
      additional_notes,
      assigned_technician,
      branch_id,
      service_schedule,
      payment_schedule,
    } = req.body;

    // Validation with detailed error messages
    const missingFields = [];
    if (!elevator_id) missingFields.push("Elevator");
    if (!project_id) missingFields.push("Project");
    if (!client_name) missingFields.push("Client Name");
    if (!client_mobile) missingFields.push("Client Mobile");
    if (!contract_start_date) missingFields.push("Contract Start Date");
    if (!contract_end_date) missingFields.push("Contract End Date");
    if (!contract_amount) missingFields.push("Contract Amount");
    if (!total_amount) missingFields.push("Total Amount");

    if (missingFields.length > 0) {
      return ErrorHandler(
        res,
        400,
        `Missing required fields: ${missingFields.join(", ")}`
      );
    }

    // Check if elevator exists
    const elevator = await Elevators.findById(elevator_id);
    if (!elevator) {
      return ErrorHandler(res, 404, "Elevator not found");
    }

    // Generate contract number
    const contract_number = await generateContractNumber();

    // Generate service schedule if not provided
    let finalServiceSchedule = service_schedule;
    if (!service_schedule || service_schedule.length === 0) {
      finalServiceSchedule = generateServiceSchedule(
        contract_start_date,
        contract_end_date,
        service_frequency || "Monthly"
      );
    }

    // Generate payment schedule if not provided
    let finalPaymentSchedule = payment_schedule;
    if (!payment_schedule || payment_schedule.length === 0) {
      finalPaymentSchedule = generatePaymentSchedule(
        contract_start_date,
        contract_end_date,
        payment_frequency || "Annual",
        total_amount
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
      contract_start_date,
      contract_end_date,
      contract_duration_months: contract_duration_months || 12,
      contract_amount,
      gst_amount: gst_amount || 0,
      total_amount,
      payment_frequency: payment_frequency || "Annual",
      service_frequency: service_frequency || "Monthly",
      service_schedule: finalServiceSchedule,
      payment_schedule: finalPaymentSchedule,
      total_paid_amount: 0,
      remaining_amount: total_amount,
      contract_status: contract_start_date && new Date(contract_start_date) <= new Date() ? "Active" : "Pending",
      auto_renewal: auto_renewal || false,
      total_services_completed: 0,
      total_services_pending: finalServiceSchedule.length,
      terms_and_conditions,
      additional_notes,
      assigned_technician,
      branch_id,
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
      fromDate,
      toDate,
      minAmount,
      maxAmount,
      branchId,
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

    if (fromDate || toDate) {
      matchStage.contract_start_date = {};
      if (fromDate) matchStage.contract_start_date.$gte = new Date(fromDate);
      if (toDate) matchStage.contract_start_date.$lte = new Date(toDate);
    }

    if (minAmount || maxAmount) {
      matchStage.total_amount = {};
      if (minAmount) matchStage.total_amount.$gte = Number(minAmount);
      if (maxAmount) matchStage.total_amount.$lte = Number(maxAmount);
    }

    const amcs = await AMC.aggregate([
      {
        $match: matchStage,
      },
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
      {
        $unwind: {
          path: "$elevator",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $unwind: {
          path: "$project",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $addFields: {
          elevator_name: "$elevator.elevator_name",
          project_name: "$project.site_name",
        },
      },
      {
        $project: {
          elevator: 0,
          project: 0,
        },
      },
      {
        $sort: { createdAt: -1 },
      },
    ]);

    if (!amcs || amcs.length === 0) {
      return ErrorHandler(res, 200, "No AMC contracts found");
    }

    return ResponseOk(res, 200, "AMC contracts retrieved successfully", amcs);
  } catch (error) {
    console.error("[ViewAMC]", error);
    return ErrorHandler(
      res,
      500,
      "Server error while retrieving AMC contracts"
    );
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

    return ResponseOk(res, 200, "AMC contract retrieved successfully", amc);
  } catch (error) {
    console.error("[GetAMCById]", error);
    return ErrorHandler(res, 500, "Server error while retrieving AMC contract");
  }
};

const UpdateAMC = async (req, res) => {
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
  GetAMCById,
  UpdateAMC,
  UpdateServiceSchedule,
  UpdatePaymentSchedule,
  DeleteAMC,
};

