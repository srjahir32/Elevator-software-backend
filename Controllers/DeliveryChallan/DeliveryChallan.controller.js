const { DeliveryChallan } = require("../../Models/DeliveryChallan.model");
const { ResponseOk, ErrorHandler } = require("../../Utils/ResponseHandler");
const { ActivityLog } = require("../../Models/Activitylog.model");
const { Users } = require("../../Models/User.model");
const { Project, Elevators } = require("../../Models/Project.model");
const { MaintenanceLog } = require("../../Models/MaintenanceLog.model");
const { ComplaintForm } = require("../../Models/HandOverForm.model");
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
            is_external,
            external_project_name,
            external_elevator_names,
            client_name,
            client_email,
            client_mobile,
            client_address,
            service_id,
            ticket_id,
            delivery_date,
            delivery_location,
            remarks,
            items,
            branch_id
        } = req.body;

        if (is_external) {
            if (!external_project_name || !items || items.length === 0) {
                return ErrorHandler(res, 400, "New AMC Name and Items are required");
            }
        } else {
            if (!project_id || !elevator_ids || elevator_ids.length === 0 || !items || items.length === 0) {
                return ErrorHandler(res, 400, "Project, Elevator(s), and Items are required");
            }
        }

        const challan_number = await generateChallanNumber();

        // Calculate total amount
        const total_amount = items.reduce((sum, item) => {
            const itemTotal = (item.quantity || 0) * (item.unit_price || 0);
            item.total_price = itemTotal; // Enforce calculation
            return sum + itemTotal;
        }, 0);

        const safe_project_id = (is_external || !project_id) ? null : project_id;
        const safe_elevator_ids = (is_external || !elevator_ids) ? [] : elevator_ids;
        const safe_external_elevator_names = is_external ? external_elevator_names : [];

        const newChallan = await DeliveryChallan.create({
            challan_number,
            project_id: safe_project_id,
            elevator_ids: safe_elevator_ids,
            is_external,
            external_project_name,
            external_elevator_names: safe_external_elevator_names,
            client_name,
            client_email,
            client_mobile,
            client_address,
            service_id,
            ticket_id,
            delivery_date,
            delivery_location,
            total_amount,
            remarks,
            items,
            branch_id,
            created_by: req.auth?.id
        });

        // Activity Log
        const user = await Users.findById(req.auth?.id);
        await ActivityLog.create({
            user_id: req.auth?.id,
            user_name: user?.name || "System",
            action: "CREATE_CHALLAN",
            type: "Create",
            description: `Delivery Challan ${challan_number} created for project ${is_external ? external_project_name : project_id}`,
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
    GetChallanById,
    UpdateChallan,
    MarkDelivered
};
