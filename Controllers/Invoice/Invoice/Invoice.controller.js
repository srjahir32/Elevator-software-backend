const { Invoice, Payment } = require("../../Models/Invoice.model");
const { AMC } = require("../../Models/AMC.model");
const { DeliveryChallan } = require("../../Models/DeliveryChallan.model");
const { ResponseOk, ErrorHandler } = require("../../Utils/ResponseHandler");
const { ActivityLog } = require("../../Models/Activitylog.model");
const { Users, User_Associate_With_Role, Roles } = require("../../Models/User.model");
const mongoose = require("mongoose");

async function getRoleUser(req) {
    if (!req.auth?.id) return { role: null, user: null };
    const user = await Users.findById(req.auth.id);
    const userRole = await User_Associate_With_Role.findOne({
        user_id: new mongoose.Types.ObjectId(req.auth.id),
    });
    const role = userRole ? await Roles.findOne({ id: userRole.role_id }) : null;
    return { role, user };
}

function cleanQueryParam(v) {
    if (v === undefined || v === null || v === "") return null;
    const s = String(v).trim();
    if (s.toLowerCase() === "null" || s.toLowerCase() === "undefined") return null;
    return s;
}

async function resolveInvoiceBranchFilter(req, branchIdRaw) {
    const branchId = cleanQueryParam(branchIdRaw);
    const { role, user } = await getRoleUser(req);
    if (!user) return { ok: false, status: 401, msg: "Unauthorized" };
    const isAdmin = role?.name === "Admin";
    if (isAdmin) {
        if (!branchId) return { ok: true, filter: undefined };
        return { ok: true, filter: new mongoose.Types.ObjectId(branchId) };
    }
    const allowed = (user.branches || []).map((b) => b.toString());
    if (!allowed.length) {
        return { ok: true, filter: new mongoose.Types.ObjectId("000000000000000000000000") };
    }
    if (branchId) {
        if (!allowed.includes(branchId)) return { ok: false, status: 403, msg: "Not allowed for this branch" };
        return { ok: true, filter: new mongoose.Types.ObjectId(branchId) };
    }
    return { ok: true, filter: { $in: user.branches } };
}

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

/** Labels from InvoiceForm.jsx → Invoice.model enum */
const FRONTEND_INVOICE_TYPE_MAP = {
    "AMC Annual": "AMC",
    Partial: "AMC",
    "Additional Charges": "COMBINED",
    "Spare Parts": "SPARE",
};

const CreateInvoice = async (req, res) => {
    try {
        const {
            invoice_type: rawInvoiceType,
            project_id: bodyProjectId,
            amc_id,
            is_external: bodyIsExternal,
            external_project_name: bodyExternalName,
            client_name: bodyClientName,
            client_email: bodyClientEmail,
            client_mobile: bodyClientMobile,
            client_address: bodyClientAddress,
            elevator_ids: bodyElevatorIds,
            external_elevator_names: bodyExternalElevatorNames,
            contract_id,
            challan_id,
            challan_ids,
            invoice_date,
            due_date,
            items,
            tax_amount: bodyTaxAmount = 0,
            gst_percentage,
            branch_id,
        } = req.body;

        const invoice_type =
            FRONTEND_INVOICE_TYPE_MAP[rawInvoiceType] || rawInvoiceType;

        if (!invoice_type) {
            return ErrorHandler(res, 400, "Invoice Type is required");
        }
        if (!["AMC", "SPARE", "COMBINED"].includes(invoice_type)) {
            return ErrorHandler(res, 400, "Invalid invoice type");
        }

        const amcIdRaw = amc_id || contract_id;
        let amcDoc = null;
        if (amcIdRaw && mongoose.Types.ObjectId.isValid(String(amcIdRaw))) {
            amcDoc = await AMC.findById(amcIdRaw);
            if (!amcDoc) {
                return ErrorHandler(res, 404, "AMC not found");
            }
        }

        let is_external =
            bodyIsExternal !== undefined ? Boolean(bodyIsExternal) : false;
        let project_id = bodyProjectId;
        let external_project_name = bodyExternalName;
        let client_name = bodyClientName;
        let client_email = bodyClientEmail;
        let client_mobile = bodyClientMobile;
        let client_address = bodyClientAddress;
        let elevator_ids = bodyElevatorIds;
        let external_elevator_names = bodyExternalElevatorNames;

        if (amcDoc) {
            is_external = !!amcDoc.is_external;
            if (!project_id && amcDoc.project_id) {
                project_id = amcDoc.project_id.toString();
            }
            external_project_name =
                external_project_name || amcDoc.external_project_name || undefined;
            client_name = client_name || amcDoc.client_name;
            client_email = client_email || amcDoc.client_email;
            client_mobile = client_mobile || amcDoc.client_mobile;
            client_address = client_address || amcDoc.client_address;
            if (!elevator_ids?.length) {
                elevator_ids = amcDoc.elevator_ids || [];
            }
            if (
                is_external &&
                (!external_elevator_names || !external_elevator_names.length)
            ) {
                external_elevator_names = amcDoc.external_elevator_names || [];
            }
        }

        if (is_external && !external_project_name) {
            return ErrorHandler(res, 400, "New AMC Name is required");
        }

        if (!is_external && !project_id && !amcDoc) {
            return ErrorHandler(res, 400, "Project or AMC is required");
        }

        const safe_project_id =
            is_external || !project_id ? null : project_id;
        const safe_elevator_ids =
            is_external || !elevator_ids?.length ? [] : elevator_ids;
        const safe_external_elevator_names = is_external
            ? external_elevator_names || []
            : [];
        const cleanContractId = amcDoc
            ? amcDoc._id.toString()
            : contract_id && contract_id !== ""
              ? contract_id
              : null;

        let cleanChallanId =
            challan_id && challan_id !== "" ? String(challan_id) : null;
        if (
            !cleanChallanId &&
            Array.isArray(challan_ids) &&
            challan_ids.length > 0
        ) {
            cleanChallanId = String(challan_ids[0]);
        }
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
                    total_price: contract.total_amount || 0,
                });
            }
        }

        // If Spare Invoice and no items provided, try to fetch from challan
        if (invoice_type === "SPARE" && cleanChallanId && finalItems.length === 0) {
            const challan = await DeliveryChallan.findById(cleanChallanId);
            if (challan) {
                if (!["Delivered", "Closed"].includes(challan.status)) {
                    return ErrorHandler(
                        res,
                        400,
                        "Challan must be delivered before invoicing"
                    );
                }
                finalItems = (challan.items || []).map((item) => ({
                    description: item.part_name,
                    quantity: item.quantity,
                    unit_price: item.unit_price,
                    total_price:
                        item.total_price ||
                        item.quantity * item.unit_price,
                }));
            }
        }

        const invoice_number = await generateInvoiceNumber();

        const subtotal = finalItems.reduce(
            (sum, item) =>
                sum +
                (Number(item.total_price) ||
                    Number(item.quantity) * Number(item.unit_price) ||
                    0),
            0
        );
        let tax_amount = Number(bodyTaxAmount) || 0;
        const gstPct = Number(gst_percentage);
        if (
            (!tax_amount || tax_amount === 0) &&
            !Number.isNaN(gstPct) &&
            gstPct > 0
        ) {
            tax_amount = Math.round((subtotal * gstPct) / 100);
        }
        const total_amount = subtotal + tax_amount;

        const logTarget =
            is_external && external_project_name
                ? external_project_name
                : project_id || cleanContractId || "AMC";

        const quotation_id_raw = req.body?.quotation_id;
        const quotation_id =
            quotation_id_raw && mongoose.Types.ObjectId.isValid(String(quotation_id_raw))
                ? new mongoose.Types.ObjectId(String(quotation_id_raw))
                : null;

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
            quotation_id,
            invoice_date: invoice_date || new Date(),
            due_date: due_date && due_date !== "" ? due_date : null,
            subtotal,
            tax_amount,
            total_amount,
            balance_amount: total_amount,
            items: finalItems,
            branch_id: cleanBranchId,
            created_by: req.auth?.id,
        });

        const user = await Users.findById(req.auth?.id);
        await ActivityLog.create({
            user_id: req.auth?.id,
            user_name: user?.name,
            action: "CREATE_INVOICE",
            type: "Create",
            description: `Invoice ${invoice_number} created for ${logTarget}`,
            title: "Invoice Created",
            project_id: safe_project_id,
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

const GetInvoiceStats = async (req, res) => {
    try {
        const scope = await resolveInvoiceBranchFilter(req, req.query.branch_id);
        if (!scope.ok) return ErrorHandler(res, scope.status, scope.msg);

        const branchMatch = {};
        if (scope.filter !== undefined) branchMatch.branch_id = scope.filter;

        const nonCancelled = { status: { $ne: "Cancelled" }, ...branchMatch };
        const issued = {
            ...nonCancelled,
            status: { $in: ["Sent", "Partial Paid", "Paid"] },
        };
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);

        const [invoicedRow, receivedRow, outstandingRow, overdue] = await Promise.all([
            Invoice.aggregate([
                { $match: issued },
                { $group: { _id: null, total: { $sum: { $ifNull: ["$total_amount", 0] } } } },
            ]),
            Invoice.aggregate([
                { $match: nonCancelled },
                { $group: { _id: null, total: { $sum: { $ifNull: ["$paid_amount", 0] } } } },
            ]),
            Invoice.aggregate([
                { $match: { ...nonCancelled, balance_amount: { $gt: 0 } } },
                { $group: { _id: null, total: { $sum: { $ifNull: ["$balance_amount", 0] } } } },
            ]),
            Invoice.countDocuments({
                ...branchMatch,
                status: { $nin: ["Paid", "Cancelled", "Draft"] },
                balance_amount: { $gt: 0 },
                due_date: { $lt: todayEnd },
            }),
        ]);

        return ResponseOk(res, 200, "Invoice stats", {
            total_invoiced: invoicedRow[0]?.total || 0,
            total_received: receivedRow[0]?.total || 0,
            total_outstanding: outstandingRow[0]?.total || 0,
            overdue,
        });
    } catch (error) {
        console.error("[GetInvoiceStats]", error);
        return ErrorHandler(res, 500, "Server error while loading invoice stats");
    }
};

const GetInvoices = async (req, res) => {
    try {
        const { project_id, invoice_type, status, branch_id, quotation_id } = req.query;
        const query = {};
        if (project_id) query.project_id = project_id;
        if (invoice_type) query.invoice_type = invoice_type;
        if (status) query.status = status;
        if (quotation_id && mongoose.Types.ObjectId.isValid(String(quotation_id))) {
            query.quotation_id = new mongoose.Types.ObjectId(String(quotation_id));
        }
        const cleanBranch = cleanQueryParam(branch_id);
        if (cleanBranch) query.branch_id = cleanBranch;

        const invoices = await Invoice.find(query)
            .populate("project_id", "site_name name client_name")
            .populate(
                "contract_id",
                "contract_number external_project_name client_name agreement_no"
            )
            .populate("elevator_ids", "elevator_name")
            .sort({ createdAt: -1 });

        return ResponseOk(res, 200, "Invoices retrieved successfully", invoices);
    } catch (error) {
        return ErrorHandler(res, 500, "Server error");
    }
};

const GetInvoicesByAMC = async (req, res) => {
    try {
        const { amcId } = req.params;
        if (!amcId || !mongoose.Types.ObjectId.isValid(amcId)) {
            return ErrorHandler(res, 400, "Invalid AMC id");
        }
        const oid = new mongoose.Types.ObjectId(amcId);

        const invoices = await Invoice.find({ contract_id: oid })
            .populate("project_id", "site_name name client_name")
            .populate(
                "contract_id",
                "contract_number external_project_name client_name agreement_no"
            )
            .populate("challan_id")
            .populate("elevator_ids", "elevator_name")
            .sort({ createdAt: -1 })
            .lean();

        const match = { contract_id: oid, status: { $ne: "Cancelled" } };
        const total = await Invoice.countDocuments(match);
        const paid = await Invoice.countDocuments({ ...match, status: "Paid" });
        const issued = await Invoice.countDocuments({ ...match, status: "Sent" });

        const invoicedAgg = await Invoice.aggregate([
            {
                $match: {
                    ...match,
                    status: { $in: ["Sent", "Partial Paid", "Paid"] },
                },
            },
            { $group: { _id: null, total: { $sum: { $ifNull: ["$total_amount", 0] } } } },
        ]);
        const outstandingAgg = await Invoice.aggregate([
            { $match: { ...match, balance_amount: { $gt: 0 } } },
            { $group: { _id: null, total: { $sum: { $ifNull: ["$balance_amount", 0] } } } },
        ]);

        return ResponseOk(res, 200, "Invoices for AMC", {
            invoices,
            stats: {
                total,
                paid,
                issued,
                total_invoiced: invoicedAgg[0]?.total || 0,
                total_outstanding: outstandingAgg[0]?.total || 0,
            },
        });
    } catch (error) {
        console.error("[GetInvoicesByAMC]", error);
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

const INVOICE_STATUSES = [
    "Draft",
    "Sent",
    "Issued",
    "Partial Paid",
    "Paid",
    "Cancelled",
    "Overdue",
];

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

        invoice.status = status;

        if (status === "Paid") {
            invoice.paid_amount = Number(invoice.total_amount) || 0;
            invoice.balance_amount = 0;
        }

        await invoice.save();

        return ResponseOk(res, 200, "Invoice status updated", invoice);
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

/** Same as AddPayment; invoice id comes from URL (frontend uses /record_payment/:id) */
const RecordPayment = async (req, res) => {
    const { id } = req.params;
    if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        return ErrorHandler(res, 400, "Invalid invoice id");
    }
    req.body = { ...req.body, invoice_id: id };
    return AddPayment(req, res);
};

const DeleteInvoice = async (req, res) => {
    try {
        const { id } = req.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return ErrorHandler(res, 400, "Invalid invoice id");
        }

        const invoice = await Invoice.findById(id);
        if (!invoice) {
            return ErrorHandler(res, 404, "Invoice not found");
        }

        const { role, user } = await getRoleUser(req);
        if (!user) return ErrorHandler(res, 401, "Unauthorized");
        const isAdmin = role?.name === "Admin";
        if (!isAdmin && invoice.branch_id) {
            const allowed = (user.branches || []).map((b) => b.toString());
            if (!allowed.includes(String(invoice.branch_id))) {
                return ErrorHandler(res, 403, "Not allowed for this branch");
            }
        }

        const paymentCount = await Payment.countDocuments({ invoice_id: id });
        if (paymentCount > 0 || (Number(invoice.paid_amount) || 0) > 0) {
            return ErrorHandler(
                res,
                400,
                "Cannot delete an invoice that has payments recorded"
            );
        }

        await Invoice.findByIdAndDelete(id);

        const u = await Users.findById(req.auth?.id);
        await ActivityLog.create({
            user_id: req.auth?.id || null,
            user_name: u?.name || "System",
            action: "DELETE_INVOICE",
            type: "Delete",
            description: `Invoice ${invoice.invoice_number} deleted`,
            title: "Invoice Deleted",
            project_id: invoice.project_id || null,
        });

        return ResponseOk(res, 200, "Invoice deleted successfully", null);
    } catch (error) {
        console.error("[DeleteInvoice]", error);
        return ErrorHandler(res, 500, "Server error while deleting invoice");
    }
};

module.exports = {
    CreateInvoice,
    GetInvoiceStats,
    GetInvoices,
    GetInvoicesByAMC,
    GetInvoiceById,
    MarkInvoiceSent,
    UpdateInvoiceStatus,
    AddPayment,
    RecordPayment,
    DeleteInvoice,
};
