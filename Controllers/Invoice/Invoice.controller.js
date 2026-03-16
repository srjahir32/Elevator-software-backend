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

const CreateInvoice = async (req, res) => {
    try {
        const {
            invoice_type,
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

        if (!invoice_type) {
            return ErrorHandler(res, 400, "Invoice Type is required");
        }

        if (is_external && !external_project_name) {
            return ErrorHandler(res, 400, "New AMC Name is required");
        }

        if (!is_external && !project_id) {
            return ErrorHandler(res, 400, "Project is required");
        }

        // Clean up optional ObjectIds
        const safe_project_id = (is_external || !project_id) ? null : project_id;
        const safe_elevator_ids = (is_external || !elevator_ids) ? [] : elevator_ids;
        const safe_external_elevator_names = is_external ? external_elevator_names : [];
        const cleanContractId = contract_id && contract_id !== "" ? contract_id : null;
        const cleanChallanId = challan_id && challan_id !== "" ? challan_id : null;
        const cleanBranchId = branch_id && branch_id !== "" ? branch_id : null;

        let finalItems = items || [];

        // If AMC Invoice and no items provided, try to fetch from contract
        if (invoice_type === "AMC" && cleanContractId && finalItems.length === 0) {
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
        if (invoice_type === "SPARE" && cleanChallanId && finalItems.length === 0) {
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
            invoice_type,
            project_id: safe_project_id,
            is_external,
            external_project_name,
            client_name,
            client_email,
            client_mobile,
            client_address,
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
            description: `Invoice ${invoice_number} created for project ${is_external ? external_project_name : project_id}`,
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

const AddPayment = async (req, res) => {
    try {
        const { invoice_id, payment_date, payment_mode, amount, reference_number, remarks } = req.body;

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
    GetInvoiceById,
    MarkInvoiceSent,
    AddPayment
};
