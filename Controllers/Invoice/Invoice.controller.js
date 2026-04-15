const { Invoice, Payment } = require("../../Models/Invoice.model");
const { AMC } = require("../../Models/AMC.model");
const { DeliveryChallan } = require("../../Models/DeliveryChallan.model");
const { ResponseOk, ErrorHandler } = require("../../Utils/ResponseHandler");
const { ActivityLog } = require("../../Models/Activitylog.model");
const { Users } = require("../../Models/User.model");
const mongoose = require("mongoose");

// Generate unique invoice number: INV-YYYY-0001
const generateInvoiceNumber = async () => {
    const year = new Date().getFullYear();
    const prefix = `INV-${year}-`;

    const lastInvoice = await Invoice.findOne({
        invoice_number: { $regex: `^${prefix}` }
    }).sort({ invoice_number: -1 });

    let sequence = 1;
    if (lastInvoice) {
        const lastParts = lastInvoice.invoice_number.split("-");
        sequence = parseInt(lastParts[lastParts.length - 1]) + 1;
    }

    return `${prefix}${sequence.toString().padStart(4, "0")}`;
};

const normalizeInvoiceType = (rawType) => {
    const t = String(rawType || "").trim().toLowerCase();
    if (!t) return "";
    if (t === "amc" || t === "amc annual" || t === "partial") return "AMC";
    if (t === "spare" || t === "spare parts" || t === "additional charges") return "SPARE";
    if (t === "combined") return "COMBINED";
    return String(rawType || "").trim().toUpperCase();
};

const CreateInvoice = async (req, res) => {
    try {
        const {
            invoice_type,
            amc_id,
            project_id,
            is_external = false,
            external_project_name,
            client_name,
            client_email,
            client_mobile,
            client_address,
            elevator_ids,
            external_elevator_names,
            contract_id,
            challan_id,
            invoice_date,
            due_date,
            items,
            tax_amount = 0,
            branch_id
        } = req.body;

        const normalizedInvoiceType = normalizeInvoiceType(invoice_type);
        if (!normalizedInvoiceType) {
            return ErrorHandler(res, 400, "Invoice Type is required");
        }

        let resolvedProjectId = project_id || null;
        let resolvedIsExternal = !!is_external;
        let resolvedExternalProjectName = external_project_name || "";
        let resolvedClientName = client_name || "";
        let resolvedClientEmail = client_email || "";
        let resolvedClientMobile = client_mobile || "";
        let resolvedClientAddress = client_address || "";
        let resolvedElevatorIds = Array.isArray(elevator_ids) ? elevator_ids : [];
        let resolvedExternalElevatorNames = Array.isArray(external_elevator_names) ? external_elevator_names : [];
        let resolvedContractId = contract_id && contract_id !== "" ? contract_id : null;
        let resolvedBranchId = branch_id && branch_id !== "" ? branch_id : null;

        const amcIdForLookup = amc_id || resolvedContractId;
        if (amcIdForLookup && mongoose.Types.ObjectId.isValid(String(amcIdForLookup))) {
            const amc = await AMC.findById(amcIdForLookup).lean();
            if (amc) {
                if (!resolvedProjectId && amc.project_id) resolvedProjectId = amc.project_id;
                if (!resolvedContractId) resolvedContractId = amc._id;
                if (!is_external) resolvedIsExternal = !!amc.is_external;
                if (!resolvedExternalProjectName) resolvedExternalProjectName = amc.external_project_name || "";
                if (!resolvedClientName) resolvedClientName = amc.client_name || "";
                if (!resolvedClientEmail) resolvedClientEmail = amc.client_email || "";
                if (!resolvedClientMobile) resolvedClientMobile = amc.client_mobile || "";
                if (!resolvedClientAddress) resolvedClientAddress = amc.client_address || "";
                if (resolvedElevatorIds.length === 0) {
                    resolvedElevatorIds = Array.isArray(amc.elevator_ids) ? amc.elevator_ids : [];
                }
                if (resolvedExternalElevatorNames.length === 0) {
                    resolvedExternalElevatorNames = Array.isArray(amc.external_elevator_names) ? amc.external_elevator_names : [];
                }
                if (!resolvedBranchId && amc.branch_id) resolvedBranchId = amc.branch_id;
            }
        }

        if (resolvedIsExternal && !resolvedExternalProjectName) {
            return ErrorHandler(res, 400, "New AMC Name is required");
        }

        if (!resolvedIsExternal && !resolvedProjectId) {
            return ErrorHandler(res, 400, "Project is required");
        }

        // Clean up optional ObjectIds
        const safe_project_id = (resolvedIsExternal || !resolvedProjectId) ? null : resolvedProjectId;
        const safe_elevator_ids = (resolvedIsExternal || !resolvedElevatorIds) ? [] : resolvedElevatorIds;
        const safe_external_elevator_names = resolvedIsExternal ? resolvedExternalElevatorNames : [];
        const cleanContractId = resolvedContractId;
        const cleanChallanId = challan_id && challan_id !== "" ? challan_id : null;
        const cleanBranchId = resolvedBranchId;

        let finalItems = items || [];

        // If AMC Invoice and no items provided, try to fetch from contract
        if (normalizedInvoiceType === "AMC" && cleanContractId && finalItems.length === 0) {
            const contract = await AMC.findById(cleanContractId);
            if (contract) {
                finalItems.push({
                    description: `AMC Service - ${contract.contract_number}`,
                    quantity: 1,
                    unit_price: contract.total_amount || 0,
                    total_price: contract.total_amount || 0
                });
            }
        }

        // If Spare Invoice and no items provided, try to fetch from challan
        if (normalizedInvoiceType === "SPARE" && cleanChallanId && finalItems.length === 0) {
            const challan = await DeliveryChallan.findById(cleanChallanId);
            if (challan) {
                if (challan.status !== "Delivered") {
                    return ErrorHandler(res, 400, "Challan must be delivered before invoicing");
                }
                finalItems = (challan.items || []).map(item => ({
                    description: item.part_name,
                    quantity: item.quantity,
                    unit_price: item.unit_price,
                    total_price: item.total_price || (item.quantity * item.unit_price)
                }));
            }
        }

        const invoice_number = await generateInvoiceNumber();

        const subtotal = finalItems.reduce((sum, item) => sum + (Number(item.total_price) || (Number(item.quantity) * Number(item.unit_price)) || 0), 0);
        const total_amount = subtotal + Number(tax_amount);

        const newInvoice = await Invoice.create({
            invoice_number,
            invoice_type: normalizedInvoiceType,
            project_id: safe_project_id,
            is_external: resolvedIsExternal,
            external_project_name: resolvedExternalProjectName || null,
            client_name: resolvedClientName || null,
            client_email: resolvedClientEmail || null,
            client_mobile: resolvedClientMobile || null,
            client_address: resolvedClientAddress || null,
            elevator_ids: safe_elevator_ids,
            external_elevator_names: safe_external_elevator_names,
            contract_id: cleanContractId,
            challan_id: cleanChallanId,
            invoice_date: invoice_date || new Date(),
            due_date: due_date && due_date !== "" ? due_date : null,
            subtotal,
            tax_amount,
            total_amount,
            balance_amount: total_amount,
            items: finalItems,
            branch_id: cleanBranchId,
            created_by: req.auth?.id
        });

        const user = await Users.findById(req.auth?.id);
        await ActivityLog.create({
            user_id: req.auth?.id,
            user_name: user?.name,
            action: "CREATE_INVOICE",
            type: "Create",
            description: `Invoice ${invoice_number} created for project ${resolvedIsExternal ? resolvedExternalProjectName : resolvedProjectId}`,
            title: "Invoice Created",
            project_id: safe_project_id
        });

        return ResponseOk(res, 201, "Invoice created successfully", newInvoice);
    } catch (error) {
        console.error("[CreateInvoice] Error Details:", {
            message: error.message,
            stack: error.stack,
            name: error.name,
            errors: error.errors // Mongoose validation errors
        });
        return ErrorHandler(res, 500, error.message || "Server error while creating invoice");
    }
};

const GetInvoices = async (req, res) => {
    try {
        const { project_id, invoice_type, status, branch_id } = req.query;
        const query = {};
        if (project_id) query.project_id = project_id;
        if (invoice_type) query.invoice_type = invoice_type;
        if (status) query.status = status;
        if (branch_id && branch_id !== "null" && branch_id !== "undefined") query.branch_id = branch_id;

        const invoices = await Invoice.find(query)
            .populate("project_id", "site_name")
            .populate("contract_id", "contract_number")
            .populate("elevator_ids", "elevator_name")
            .sort({ createdAt: -1 });

        return ResponseOk(res, 200, "Invoices retrieved successfully", invoices);
    } catch (error) {
        return ErrorHandler(res, 500, "Server error");
    }
};

const GetInvoiceStats = async (req, res) => {
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

        const [total, draft, sent, issued, partialPaid, paid, cancelled, overdue] = await Promise.all([
            Invoice.countDocuments(query),
            Invoice.countDocuments({ ...query, status: "Draft" }),
            Invoice.countDocuments({ ...query, status: "Sent" }),
            Invoice.countDocuments({ ...query, status: "Issued" }),
            Invoice.countDocuments({ ...query, status: "Partial Paid" }),
            Invoice.countDocuments({ ...query, status: "Paid" }),
            Invoice.countDocuments({ ...query, status: "Cancelled" }),
            Invoice.countDocuments({ ...query, status: "Overdue" }),
        ]);

        const amountAgg = await Invoice.aggregate([
            { $match: query },
            {
                $group: {
                    _id: null,
                    total_amount: { $sum: { $ifNull: ["$total_amount", 0] } },
                    paid_amount: { $sum: { $ifNull: ["$paid_amount", 0] } },
                    balance_amount: { $sum: { $ifNull: ["$balance_amount", 0] } },
                },
            },
        ]);

        const summary = amountAgg[0] || { total_amount: 0, paid_amount: 0, balance_amount: 0 };

        return ResponseOk(res, 200, "Invoice stats", {
            total,
            draft,
            sent,
            issued,
            partial_paid: partialPaid,
            paid,
            cancelled,
            overdue,
            total_amount: summary.total_amount || 0,
            paid_amount: summary.paid_amount || 0,
            balance_amount: summary.balance_amount || 0,
        });
    } catch (error) {
        console.error("[GetInvoiceStats]", error);
        return ErrorHandler(res, 500, "Server error while fetching invoice stats");
    }
};

const GetInvoiceById = async (req, res) => {
    try {
        const invoice = await Invoice.findById(req.params.id)
            .populate("project_id")
            .populate("contract_id")
            .populate("challan_id")
            .populate("elevator_ids");

        if (!invoice) return ErrorHandler(res, 404, "Invoice not found");

        const payments = await Payment.find({ invoice_id: req.params.id });

        return ResponseOk(res, 200, "Invoice details", { invoice, payments });
    } catch (error) {
        return ErrorHandler(res, 500, "Server error");
    }
};

const MarkInvoiceSent = async (req, res) => {
    try {
        const invoice = await Invoice.findById(req.params.id);
        if (!invoice) return ErrorHandler(res, 404, "Invoice not found");

        invoice.status = "Sent";
        await invoice.save();

        return ResponseOk(res, 200, "Invoice marked as Sent", invoice);
    } catch (error) {
        return ErrorHandler(res, 500, "Server error");
    }
};

const INVOICE_STATUSES = ["Draft", "Sent", "Issued", "Partial Paid", "Paid", "Cancelled", "Overdue"];

const UpdateInvoiceStatus = async (req, res) => {
    try {
        const { status } = req.body;
        if (!status) {
            return ErrorHandler(res, 400, "Status is required");
        }
        if (!INVOICE_STATUSES.includes(status)) {
            return ErrorHandler(res, 400, "Invalid status");
        }

        const invoice = await Invoice.findById(req.params.id);
        if (!invoice) return ErrorHandler(res, 404, "Invoice not found");
        if (invoice.status === "Cancelled") {
            return ErrorHandler(res, 400, "Cannot update a cancelled invoice");
        }

        const updated = await Invoice.findByIdAndUpdate(
            req.params.id,
            { status },
            { new: true, runValidators: true }
        );
        return ResponseOk(res, 200, "Invoice status updated", updated);
    } catch (error) {
        console.error("[UpdateInvoiceStatus]", error);
        return ErrorHandler(res, 500, "Server error while updating invoice status");
    }
};

const AddPayment = async (req, res) => {
    try {
        const { payment_date, payment_mode, amount, reference_number, remarks } = req.body;
        const invoice_id = req.body.invoice_id || req.params.id;

        if (!invoice_id || !amount) {
            return ErrorHandler(res, 400, "Invoice ID and Amount are required");
        }

        const invoice = await Invoice.findById(invoice_id);
        if (!invoice) return ErrorHandler(res, 404, "Invoice not found");

        const newPayment = await Payment.create({
            invoice_id,
            payment_date,
            payment_mode,
            amount,
            reference_number,
            remarks,
            created_by: req.auth?.id
        });

        // Update Invoice status and amounts
        invoice.paid_amount += Number(amount);
        invoice.balance_amount = invoice.total_amount - invoice.paid_amount;

        if (invoice.balance_amount <= 0) {
            invoice.status = "Paid";
        } else if (invoice.paid_amount > 0) {
            invoice.status = "Partial Paid";
        }

        await invoice.save();

        return ResponseOk(res, 201, "Payment recorded successfully", newPayment);
    } catch (error) {
        console.error("[AddPayment]", error);
        return ErrorHandler(res, 500, "Server error while recording payment");
    }
};

module.exports = {
    CreateInvoice,
    GetInvoices,
    GetInvoiceStats,
    GetInvoiceById,
    MarkInvoiceSent,
    UpdateInvoiceStatus,
    AddPayment
};
