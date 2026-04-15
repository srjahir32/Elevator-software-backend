const { DeliveryChallan } = require("../../Models/DeliveryChallan.model");
const { AMC } = require("../../Models/AMC.model");
const { ResponseOk, ErrorHandler } = require("../../Utils/ResponseHandler");
const { ActivityLog } = require("../../Models/Activitylog.model");
const { Users } = require("../../Models/User.model");
const mongoose = require("mongoose");
/** Register refs used by populate(service_id, ticket_id) */
require("../../Models/MaintenanceLog.model");
require("../../Models/HandOverForm.model");

function normalizeChallanItems(items) {
    if (!Array.isArray(items)) return [];
    return items.map((item) => {
        const qty = Number(item.quantity) || 1;
        const unitPrice = Number(item.rate ?? item.unit_price ?? 0);
        const total_price =
            item.amount != null && item.amount !== "" && !Number.isNaN(Number(item.amount))
                ? Number(item.amount)
                : qty * unitPrice;
        return {
            part_name: item.name || item.part_name || "Item",
            part_code: item.part_code || "",
            quantity: qty,
            unit_price: unitPrice,
            total_price,
        };
    });
}

function cleanBranchId(bid) {
    if (bid == null || bid === "") return null;
    const s = String(bid);
    if (s === "null" || s === "undefined") return null;
    return bid;
}

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
        const body = req.body;
        const {
            amc_id,
            challan_type,
            lift_indices,
            lift_labels,
            service_schedule_id,
            technician_ids,
            challan_date,
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
            branch_id,
        } = body;

        if (amc_id) {
            const amc = await AMC.findById(amc_id).lean();
            if (!amc) {
                return ErrorHandler(res, 404, "AMC not found");
            }

            const normalizedItems = normalizeChallanItems(items);
            if (normalizedItems.length === 0) {
                return ErrorHandler(res, 400, "Items are required");
            }

            const total_amount = normalizedItems.reduce((sum, item) => sum + item.total_price, 0);
            const internalElevators = amc.elevator_ids || [];
            const externalNames = amc.external_elevator_names || [];
            const intLen = internalElevators.length;
            let resolvedElevatorIds = [];
            let resolvedExternalNames = [];

            const indices = Array.isArray(lift_indices)
                ? lift_indices.map((x) => Number(x)).filter((n) => !Number.isNaN(n))
                : [];

            if (indices.length > 0) {
                for (const i of indices) {
                    if (i < intLen && internalElevators[i]) {
                        resolvedElevatorIds.push(internalElevators[i]);
                    } else if (i >= intLen) {
                        const name = externalNames[i - intLen];
                        if (name) resolvedExternalNames.push(name);
                    }
                }
            } else {
                resolvedElevatorIds = [...internalElevators];
                resolvedExternalNames = [...externalNames];
            }

            const challanIsExternal = !!amc.is_external;
            const effProjectId = amc.project_id || null;

            if (challanIsExternal) {
                if (externalNames.length === 0) {
                    return ErrorHandler(
                        res,
                        400,
                        "This external AMC has no elevator names on file; add them on the AMC contract"
                    );
                }
            } else if (effProjectId) {
                if (resolvedElevatorIds.length === 0 && resolvedExternalNames.length === 0) {
                    return ErrorHandler(
                        res,
                        400,
                        "Select at least one lift, or add elevators to this AMC contract"
                    );
                }
            } else {
                return ErrorHandler(
                    res,
                    400,
                    "This AMC is not linked to a project and is not marked external; fix the AMC record"
                );
            }

            const challan_number = await generateChallanNumber();
            const effDelivery = challan_date
                ? new Date(challan_date)
                : delivery_date
                  ? new Date(delivery_date)
                  : new Date();
            const effBranch = cleanBranchId(branch_id) || amc.branch_id;

            const extNamesForDoc = challanIsExternal
                ? resolvedExternalNames.length
                    ? resolvedExternalNames
                    : externalNames
                : resolvedExternalNames;

            const newChallan = await DeliveryChallan.create({
                challan_number,
                project_id: effProjectId,
                elevator_ids: resolvedElevatorIds,
                is_external: challanIsExternal,
                external_project_name: amc.external_project_name || amc.contract_number || "",
                external_elevator_names: extNamesForDoc,
                client_name: amc.client_name,
                client_email: amc.client_email,
                client_mobile: amc.client_mobile,
                client_address: amc.client_address,
                service_id: service_id || null,
                ticket_id: ticket_id || null,
                delivery_date: effDelivery,
                delivery_location,
                total_amount,
                remarks,
                items: normalizedItems,
                branch_id: effBranch || undefined,
                created_by: req.auth?.id,
                amc_id,
                challan_type: challan_type || "Material Delivery",
                lift_indices: indices,
                lift_labels: Array.isArray(lift_labels) ? lift_labels : [],
                service_schedule_id: service_schedule_id || null,
                technician_ids: Array.isArray(technician_ids) ? technician_ids : [],
            });

            const user = await Users.findById(req.auth?.id);
            await ActivityLog.create({
                user_id: req.auth?.id,
                user_name: user?.name || "System",
                action: "CREATE_CHALLAN",
                type: "Create",
                description: `Delivery Challan ${challan_number} created for AMC ${amc.contract_number || amc_id}`,
                title: "Challan Created",
                project_id: effProjectId || undefined,
            });

            return ResponseOk(res, 201, "Delivery Challan created successfully", newChallan);
        }

        if (is_external) {
            if (!external_project_name) {
                return ErrorHandler(res, 400, "New AMC Name and Items are required");
            }
        } else {
            if (!project_id || !elevator_ids || elevator_ids.length === 0) {
                return ErrorHandler(res, 400, "Project, Elevator(s), and Items are required");
            }
        }

        const normalizedItems = normalizeChallanItems(items);
        if (normalizedItems.length === 0) {
            return ErrorHandler(res, 400, "Items are required");
        }

        const challan_number = await generateChallanNumber();
        const total_amount = normalizedItems.reduce((sum, item) => sum + item.total_price, 0);

        const safe_project_id = is_external || !project_id ? null : project_id;
        const safe_elevator_ids = is_external || !elevator_ids ? [] : elevator_ids;
        const safe_external_elevator_names = is_external ? external_elevator_names || [] : [];

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
            delivery_date: delivery_date || new Date(),
            delivery_location,
            total_amount,
            remarks,
            items: normalizedItems,
            branch_id: cleanBranchId(branch_id) || undefined,
            created_by: req.auth?.id,
        });

        const user = await Users.findById(req.auth?.id);
        await ActivityLog.create({
            user_id: req.auth?.id,
            user_name: user?.name || "System",
            action: "CREATE_CHALLAN",
            type: "Create",
            description: `Delivery Challan ${challan_number} created for project ${is_external ? external_project_name : project_id}`,
            title: "Challan Created",
            project_id: safe_project_id,
        });

        return ResponseOk(res, 201, "Delivery Challan created successfully", newChallan);
    } catch (error) {
        console.error("[CreateChallan]", error);
        return ErrorHandler(res, 500, "Server error while creating Delivery Challan");
    }
};

const GetChallans = async (req, res) => {
    try {
        const { project_id, amc_id, status, branch_id } = req.query;
        const query = {};
        if (project_id) query.project_id = project_id;
        if (amc_id && amc_id !== "null" && amc_id !== "undefined") query.amc_id = amc_id;
        if (status) query.status = status;
        if (branch_id && branch_id !== "null" && branch_id !== "undefined") query.branch_id = branch_id;

        const challans = await DeliveryChallan.find(query)
            .populate("project_id", "site_name")
            .populate("elevator_ids", "elevator_name")
            .populate("amc_id", "contract_number external_project_name client_name")
            .populate("technician_ids", "name contact_number")
            .sort({ createdAt: -1 });

        return ResponseOk(res, 200, "Challans retrieved successfully", challans);
    } catch (error) {
        return ErrorHandler(res, 500, "Server error while fetching challans");
    }
};

const GetChallanStats = async (req, res) => {
    try {
        const branchId = cleanBranchId(req.query.branch_id);
        const match = {};
        if (branchId && mongoose.Types.ObjectId.isValid(branchId)) {
            match.branch_id = new mongoose.Types.ObjectId(branchId);
        }

        const total = await DeliveryChallan.countDocuments(match);
        const draft = await DeliveryChallan.countDocuments({ ...match, status: "Draft" });
        const issued = await DeliveryChallan.countDocuments({ ...match, status: "Issued" });
        const delivered = await DeliveryChallan.countDocuments({
            ...match,
            status: { $in: ["Delivered", "Closed"] },
        });

        const valAgg = await DeliveryChallan.aggregate([
            { $match: { ...match, status: { $in: ["Delivered", "Closed"] } } },
            { $group: { _id: null, total: { $sum: { $ifNull: ["$total_amount", 0] } } } },
        ]);
        const delivered_value = valAgg[0]?.total || 0;

        return ResponseOk(res, 200, "Challan stats", {
            total,
            draft,
            issued,
            delivered,
            delivered_value,
        });
    } catch (error) {
        console.error("[GetChallanStats]", error);
        return ErrorHandler(res, 500, "Server error while loading challan stats");
    }
};

const GetChallansByAMC = async (req, res) => {
    try {
        const { amcId } = req.params;
        if (!amcId || !mongoose.Types.ObjectId.isValid(amcId)) {
            return ErrorHandler(res, 400, "Invalid AMC id");
        }
        const oid = new mongoose.Types.ObjectId(amcId);
        const match = { amc_id: oid };

        const challans = await DeliveryChallan.find(match)
            .populate("project_id", "site_name")
            .populate("elevator_ids", "elevator_name")
            .populate("amc_id", "contract_number external_project_name client_name")
            .populate("technician_ids", "name contact_number")
            .sort({ createdAt: -1 });

        const [total, draft, issued, delivered] = await Promise.all([
            DeliveryChallan.countDocuments(match),
            DeliveryChallan.countDocuments({ ...match, status: "Draft" }),
            DeliveryChallan.countDocuments({ ...match, status: "Issued" }),
            DeliveryChallan.countDocuments({
                ...match,
                status: { $in: ["Delivered", "Closed"] },
            }),
        ]);

        const sumAgg = await DeliveryChallan.aggregate([
            { $match: match },
            { $group: { _id: null, t: { $sum: { $ifNull: ["$total_amount", 0] } } } },
        ]);
        const total_material_value = sumAgg[0]?.t || 0;

        return ResponseOk(res, 200, "Challans for AMC", {
            challans,
            stats: {
                total,
                draft,
                issued,
                delivered,
                total_material_value,
            },
        });
    } catch (error) {
        console.error("[GetChallansByAMC]", error);
        return ErrorHandler(res, 500, "Server error");
    }
};

const GetChallanById = async (req, res) => {
    try {
        console.log("Fetching challan by ID:", req.params.id);
        const challan = await DeliveryChallan.findById(req.params.id)
            .populate("project_id")
            .populate("elevator_ids")
            .populate("amc_id")
            .populate("service_id")
            .populate("ticket_id")
            .populate("technician_ids", "name contact_number email")
            .populate("branch_id", "name");

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
        const {
            status,
            items,
            delivery_location,
            remarks,
            elevator_ids,
            external_elevator_names,
            challan_type,
            lift_indices,
            lift_labels,
            service_schedule_id,
            technician_ids,
            challan_date,
        } = req.body;
        const challan = await DeliveryChallan.findById(req.params.id);
        if (!challan) return ErrorHandler(res, 404, "Challan not found");

        if (challan.status === "Closed") {
            return ErrorHandler(res, 400, "Cannot update a closed challan");
        }

        const updateData = {};
        if (status) updateData.status = status;
        if (delivery_location !== undefined) updateData.delivery_location = delivery_location;
        if (remarks !== undefined) updateData.remarks = remarks;
        if (elevator_ids) updateData.elevator_ids = elevator_ids;
        if (external_elevator_names) updateData.external_elevator_names = external_elevator_names;
        if (challan_type !== undefined) updateData.challan_type = challan_type;
        if (lift_indices !== undefined) updateData.lift_indices = lift_indices;
        if (lift_labels !== undefined) updateData.lift_labels = lift_labels;
        if (service_schedule_id !== undefined) updateData.service_schedule_id = service_schedule_id || null;
        if (technician_ids !== undefined) updateData.technician_ids = technician_ids;
        if (challan_date) updateData.delivery_date = new Date(challan_date);

        if (items) {
            const normalizedItems = normalizeChallanItems(items);
            updateData.items = normalizedItems;
            updateData.total_amount = normalizedItems.reduce((sum, item) => sum + item.total_price, 0);
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

const DeleteChallan = async (req, res) => {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return ErrorHandler(res, 400, "Invalid challan id");
        }
        const challan = await DeliveryChallan.findById(id);
        if (!challan) {
            return ErrorHandler(res, 404, "Challan not found");
        }
        if (challan.status === "Delivered" || challan.status === "Closed") {
            return ErrorHandler(
                res,
                400,
                "Cannot delete a delivered or closed challan"
            );
        }
        await DeliveryChallan.findByIdAndDelete(id);
        const user = await Users.findById(req.auth?.id);
        await ActivityLog.create({
            user_id: req.auth?.id || null,
            user_name: user?.name || "System",
            action: "DELETE_CHALLAN",
            type: "Delete",
            description: `Delivery challan ${challan.challan_number} deleted`,
            title: "Challan Deleted",
            project_id: challan.project_id || null,
        });
        return ResponseOk(res, 200, "Challan deleted successfully", null);
    } catch (error) {
        console.error("[DeleteChallan]", error);
        return ErrorHandler(res, 500, "Server error while deleting challan");
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
    MarkDelivered,
    DeleteChallan,
};
