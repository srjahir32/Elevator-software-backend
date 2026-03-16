const mongoose = require("mongoose");

const InvoiceItemSchema = new mongoose.Schema({
    description: { type: String, required: true },
    quantity: { type: Number, required: true, default: 1 },
    unit_price: { type: Number, required: true, default: 0 },
    total_price: { type: Number, required: true, default: 0 },
});

const InvoiceSchema = new mongoose.Schema(
    {
        invoice_number: { type: String, required: true, unique: true },
        invoice_type: {
            type: String,
            enum: ["AMC", "SPARE", "COMBINED"],
            required: true,
        },
        project_id: { type: mongoose.Schema.Types.ObjectId, ref: "project", required: false },
        is_external: { type: Boolean, default: false },
        external_project_name: { type: String },
        external_elevator_names: [{ type: String }],
        elevator_ids: [{ type: mongoose.Schema.Types.ObjectId, ref: "elevator" }],
        client_name: { type: String },
        client_email: { type: String },
        client_mobile: { type: String },
        client_address: { type: String },
        contract_id: { type: mongoose.Schema.Types.ObjectId, ref: "amc", default: null },
        challan_id: { type: mongoose.Schema.Types.ObjectId, ref: "delivery_challan", default: null },
        invoice_date: { type: Date, required: true, default: Date.now },
        due_date: { type: Date },
        subtotal: { type: Number, required: true, default: 0 },
        tax_amount: { type: Number, default: 0 },
        total_amount: { type: Number, required: true, default: 0 },
        paid_amount: { type: Number, default: 0 },
        balance_amount: { type: Number, default: 0 },
        status: {
            type: String,
            enum: ["Draft", "Sent", "Partial Paid", "Paid", "Cancelled"],
            default: "Draft",
        },
        items: [InvoiceItemSchema],
        branch_id: { type: mongoose.Schema.Types.ObjectId, ref: "branch" },
        created_by: { type: mongoose.Schema.Types.ObjectId, ref: "user" },
    },
    { timestamps: true, versionKey: false }
);

InvoiceSchema.index({ invoice_number: 1 });
InvoiceSchema.index({ project_id: 1 });
InvoiceSchema.index({ contract_id: 1 });
InvoiceSchema.index({ challan_id: 1 });
InvoiceSchema.index({ elevator_ids: 1 });

const PaymentSchema = new mongoose.Schema(
    {
        invoice_id: { type: mongoose.Schema.Types.ObjectId, ref: "invoice", required: true },
        payment_date: { type: Date, required: true, default: Date.now },
        payment_mode: {
            type: String,
            enum: ["Cash", "UPI", "Bank", "Cheque"],
            required: true,
        },
        amount: { type: Number, required: true },
        reference_number: { type: String },
        remarks: { type: String },
        created_by: { type: mongoose.Schema.Types.ObjectId, ref: "user" },
    },
    { timestamps: true, versionKey: false }
);

const Invoice = mongoose.model("invoice", InvoiceSchema);
const Payment = mongoose.model("payment", PaymentSchema);

module.exports = { Invoice, Payment };
