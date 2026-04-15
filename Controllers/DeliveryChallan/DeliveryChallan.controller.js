const { DeliveryChallan } = require("../../Models/DeliveryChallan.model");
const { ResponseOk, ErrorHandler } = require("../../Utils/ResponseHandler");
const { ActivityLog } = require("../../Models/Activitylog.model");
const { Users } = require("../../Models/User.model");
const { Project, Elevators } = require("../../Models/Project.model");
const { MaintenanceLog } = require("../../Models/MaintenanceLog.model");
const { ComplaintForm } = require("../../Models/HandOverForm.model");
const { AMC } = require("../../Models/AMC.model");
const mongoose = require("mongoose");

// Generate unique challan number: CH-YYYY-0001
const generateChallanNumber = async () => {
    const year = new Date().getFullYear();
    const prefix = `CH-${year}-`;

    const lastChallan = await DeliveryChallan.findOne({
        challan_number: { $regex: `^${prefix}` }
    }).sort({ challan_number: -1 });

    let sequence = 1;
    if (lastChallan) {
        const lastParts = lastChallan.challan_number.split("-");
        sequence = parseInt(lastParts[lastParts.length - 1]) + 1;
    }

    return `${prefix}${sequence.toString().padStart(4, "0")}`;
};

const CreateChallan = async (req, res) => {
    try {
        const {
            project_id,
            elevator_ids,
            amc_id,
            challan_type,
            lift_indices,
            lift_labels,
            service_schedule_id,
            technician_ids,
            is_external,
            external_project_name,
            external_elevator_names,
            client_name,
            client_email,
            client_mobile,
            client_address,
            service_id,
            ticket_id,
            challan_date,
            delivery_date,
            delivery_location,
            remarks,
            items,
            branch_id
        } = req.body;

        let resolvedProjectId = project_id || null;
        let resolvedElevatorIds = Array.isArray(elevator_ids) ? elevator_ids : [];
        let resolvedIsExternal = !!is_external;
        let resolvedExternalProjectName = external_project_name || "";
        let resolvedExternalElevatorNames = Array.isArray(external_elevator_names) ? external_elevator_names : [];
        let resolvedClientName = client_name || "";
        let resolvedClientEmail = client_email || "";
        let resolvedClientMobile = client_mobile || "";
        let resolvedClientAddress = client_address || "";
        let resolvedBranchId = branch_id || null;

        if (amc_id && mongoose.Types.ObjectId.isValid(String(amc_id))) {
            const amc = await AMC.findById(amc_id).lean();
            if (amc) {
                if (!resolvedProjectId && amc.project_id) resolvedProjectId = amc.project_id;
                if (resolvedElevatorIds.length === 0 && Array.isArray(amc.elevator_ids)) {
                    resolvedElevatorIds = amc.elevator_ids;
                }
                if (!is_external) resolvedIsExternal = !!amc.is_external;
                if (!resolvedExternalProjectName) resolvedExternalProjectName = amc.external_project_name || "";
                if (resolvedExternalElevatorNames.length === 0) {
                    resolvedExternalElevatorNames = Array.isArray(amc.external_elevator_names) ? amc.external_elevator_names : [];
                }
                if (!resolvedClientName) resolvedClientName = amc.client_name || "";
                if (!resolvedClientEmail) resolvedClientEmail = amc.client_email || "";
                if (!resolvedClientMobile) resolvedClientMobile = amc.client_mobile || "";
                if (!resolvedClientAddress) resolvedClientAddress = amc.client_address || "";
                if (!resolvedBranchId && amc.branch_id) resolvedBranchId = amc.branch_id;
            }
        }

        const normalizedItems = (Array.isArray(items) ? items : [])
            .filter(Boolean)
            .map((item) => {
                const quantity = Number(item.quantity) || 1;
                const unitPrice = Number(item.unit_price ?? item.rate ?? 0) || 0;
                const totalPrice = Number(item.total_price ?? item.amount ?? (quantity * unitPrice)) || (quantity * unitPrice);
                return {
                    part_name: item.part_name || item.name || "",
                    part_code: item.part_code || "",
                    quantity,
                    unit_price: unitPrice,
                    total_price: totalPrice,
                };
            })
            .filter((item) => String(item.part_name || "").trim() !== "");

        if (resolvedIsExternal) {
            if (!resolvedExternalProjectName || normalizedItems.length === 0) {
                return ErrorHandler(res, 400, "New AMC Name and Items are required");
            }
        } else {
            if (!resolvedProjectId || resolvedElevatorIds.length === 0 || normalizedItems.length === 0) {
                return ErrorHandler(res, 400, "Project, Elevator(s), and Items are required");
            }
        }

        const challan_number = await generateChallanNumber();

        // Calculate total amount
        const total_amount = normalizedItems.reduce((sum, item) => {
            const itemTotal = (item.quantity || 0) * (item.unit_price || 0);
            item.total_price = itemTotal; // Enforce calculation
            return sum + itemTotal;
        }, 0);

        const safe_project_id = (resolvedIsExternal || !resolvedProjectId) ? null : resolvedProjectId;
        const safe_elevator_ids = (resolvedIsExternal || !resolvedElevatorIds) ? [] : resolvedElevatorIds;
        const safe_external_elevator_names = resolvedIsExternal ? resolvedExternalElevatorNames : [];

        const newChallan = await DeliveryChallan.create({
            challan_number,
            project_id: safe_project_id,
            elevator_ids: safe_elevator_ids,
            is_external: resolvedIsExternal,
            external_project_name: resolvedExternalProjectName || null,
            external_elevator_names: safe_external_elevator_names,
            client_name: resolvedClientName || null,
            client_email: resolvedClientEmail || null,
            client_mobile: resolvedClientMobile || null,
            client_address: resolvedClientAddress || null,
            service_id: service_id || service_schedule_id || null,
            ticket_id,
            delivery_date: challan_date || delivery_date || new Date(),
            delivery_location,
            total_amount,
            remarks,
            items: normalizedItems,
            branch_id: resolvedBranchId || null,
            created_by: req.auth?.id,
            amc_id: amc_id || null,
            challan_type: challan_type || "Material Delivery",
            lift_indices: Array.isArray(lift_indices) ? lift_indices : [],
            lift_labels: Array.isArray(lift_labels) ? lift_labels : [],
            service_schedule_id: service_schedule_id || null,
            technician_ids: Array.isArray(technician_ids) ? technician_ids : [],
        });

        // Activity Log
        const user = await Users.findById(req.auth?.id);
        await ActivityLog.create({
            user_id: req.auth?.id,
            user_name: user?.name || "System",
            action: "CREATE_CHALLAN",
            type: "Create",
            description: `Delivery Challan ${challan_number} created for project ${resolvedIsExternal ? resolvedExternalProjectName : resolvedProjectId}`,
            title: "Challan Created",
            project_id: safe_project_id
        });

        return ResponseOk(res, 201, "Delivery Challan created successfully", newChallan);
    } catch (error) {
        console.error("[CreateChallan]", error);
        return ErrorHandler(res, 500, "Server error while creating Delivery Challan");
    }
};

const GetChallans = async (req, res) => {
    try {
        const { project_id, status, branch_id } = req.query;
        const query = {};
        if (project_id) query.project_id = project_id;
        if (status) query.status = status;
        if (branch_id && branch_id !== "null" && branch_id !== "undefined") query.branch_id = branch_id;

        const challans = await DeliveryChallan.find(query)
            .populate("project_id", "site_name")
            .populate("elevator_ids", "elevator_name")
            .sort({ createdAt: -1 });

        return ResponseOk(res, 200, "Challans retrieved successfully", challans);
    } catch (error) {
        return ErrorHandler(res, 500, "Server error while fetching challans");
    }
};

const GetChallanStats = async (req, res) => {
    try {
        const branchRaw = req.query.branch_id || req.query.branchId;
        const query = {};
        if (
            branchRaw &&
            branchRaw !== "null" &&
            branchRaw !== "undefined" &&
            mongoose.Types.ObjectId.isValid(String(branchRaw))
        ) {
            query.branch_id = new mongoose.Types.ObjectId(String(branchRaw));
        }

        const [total, draft, issued, delivered] = await Promise.all([
            DeliveryChallan.countDocuments(query),
            DeliveryChallan.countDocuments({ ...query, status: "Draft" }),
            DeliveryChallan.countDocuments({ ...query, status: "Issued" }),
            DeliveryChallan.countDocuments({ ...query, status: { $in: ["Delivered", "Closed"] } }),
        ]);

        const valueAgg = await DeliveryChallan.aggregate([
            { $match: { ...query, status: { $in: ["Delivered", "Closed"] } } },
            { $group: { _id: null, delivered_value: { $sum: { $ifNull: ["$total_amount", 0] } } } },
        ]);

        return ResponseOk(res, 200, "Challan stats", {
            total,
            draft,
            issued,
            delivered,
            delivered_value: valueAgg[0]?.delivered_value || 0,
        });
    } catch (error) {
        console.error("[GetChallanStats]", error);
        return ErrorHandler(res, 500, "Server error while fetching challan stats");
    }
};

const GetChallansByAMC = async (req, res) => {
    try {
        const { amcId } = req.params;
        if (!amcId || !mongoose.Types.ObjectId.isValid(String(amcId))) {
            return ErrorHandler(res, 400, "Invalid AMC id");
        }

        const query = { amc_id: new mongoose.Types.ObjectId(String(amcId)) };
        const challans = await DeliveryChallan.find(query)
            .populate("project_id", "site_name")
            .populate("elevator_ids", "elevator_name")
            .sort({ createdAt: -1 });

        const [total, draft, issued, delivered] = await Promise.all([
            DeliveryChallan.countDocuments(query),
            DeliveryChallan.countDocuments({ ...query, status: "Draft" }),
            DeliveryChallan.countDocuments({ ...query, status: "Issued" }),
            DeliveryChallan.countDocuments({ ...query, status: { $in: ["Delivered", "Closed"] } }),
        ]);

        const totalAgg = await DeliveryChallan.aggregate([
            { $match: query },
            { $group: { _id: null, total_material_value: { $sum: { $ifNull: ["$total_amount", 0] } } } },
        ]);

        return ResponseOk(res, 200, "Challans for AMC", {
            challans,
            stats: {
                total,
                draft,
                issued,
                delivered,
                total_material_value: totalAgg[0]?.total_material_value || 0,
            },
        });
    } catch (error) {
        console.error("[GetChallansByAMC]", error);
        return ErrorHandler(res, 500, "Server error while fetching challans for AMC");
    }
};

const GetChallanById = async (req, res) => {
    try {
        console.log("Fetching challan by ID:", req.params.id);
        const challan = await DeliveryChallan.findById(req.params.id)
            .populate("project_id")
            .populate("elevator_ids")
            .populate("service_id")
            .populate("ticket_id");

        if (!challan) {
            console.log("Challan not found for ID:", req.params.id);
            return ErrorHandler(res, 404, "Challan not found");
        }
        return ResponseOk(res, 200, "Challan details", challan);
    } catch (error) {
        console.error("Error in GetChallanById:", error);
        return ErrorHandler(res, 500, "Server error");
    }
};

const UpdateChallan = async (req, res) => {
    try {
        const { status, items, delivery_location, remarks, elevator_ids, external_elevator_names } = req.body;
        const challan = await DeliveryChallan.findById(req.params.id);
        if (!challan) return ErrorHandler(res, 404, "Challan not found");

        if (challan.status === "Closed") {
            return ErrorHandler(res, 400, "Cannot update a closed challan");
        }

        const updateData = {};
        if (status) updateData.status = status;
        if (delivery_location) updateData.delivery_location = delivery_location;
        if (remarks) updateData.remarks = remarks;
        if (elevator_ids) updateData.elevator_ids = elevator_ids;
        if (external_elevator_names) updateData.external_elevator_names = external_elevator_names;

        if (items) {
            updateData.items = items;
            updateData.total_amount = items.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0);
        }

        const updated = await DeliveryChallan.findByIdAndUpdate(req.params.id, updateData, { new: true });
        return ResponseOk(res, 200, "Challan updated", updated);
    } catch (error) {
        return ErrorHandler(res, 500, "Server error");
    }
};

const CHALLAN_STATUSES = ["Draft", "Issued", "Delivered", "Closed"];

const UpdateChallanStatus = async (req, res) => {
    try {
        const { status } = req.body;
        if (!status) {
            return ErrorHandler(res, 400, "Status is required");
        }
        if (!CHALLAN_STATUSES.includes(status)) {
            return ErrorHandler(res, 400, "Invalid status");
        }

        const challan = await DeliveryChallan.findById(req.params.id);
        if (!challan) return ErrorHandler(res, 404, "Challan not found");
        if (challan.status === "Closed") {
            return ErrorHandler(res, 400, "Cannot update a closed challan");
        }

        const updated = await DeliveryChallan.findByIdAndUpdate(
            req.params.id,
            { status },
            { new: true, runValidators: true }
        );
        return ResponseOk(res, 200, "Challan status updated", updated);
    } catch (error) {
        console.error("[UpdateChallanStatus]", error);
        return ErrorHandler(res, 500, "Server error");
    }
};

const MarkDelivered = async (req, res) => {
    try {
        const challan = await DeliveryChallan.findById(req.params.id);
        if (!challan) return ErrorHandler(res, 404, "Challan not found");

        if (challan.status !== "Issued") {
            return ErrorHandler(res, 400, "Challan must be in Issued status to mark as Delivered");
        }

        challan.status = "Delivered";
        await challan.save();

        return ResponseOk(res, 200, "Challan marked as Delivered", challan);
    } catch (error) {
        return ErrorHandler(res, 500, "Server error");
    }
};

module.exports = {
    CreateChallan,
    GetChallans,
    GetChallanStats,
    GetChallansByAMC,
    GetChallanById,
    UpdateChallan,
    UpdateChallanStatus,
    MarkDelivered
};
