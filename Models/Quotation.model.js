const mongoose = require("mongoose");

/** Per-lift charge on the quotation (excl. GST; added to subtotal with line items). */
const QuotationLiftPricingSchema = new mongoose.Schema(
  {
    elevator_id: { type: mongoose.Schema.Types.ObjectId, ref: "elevator", default: null },
    lift_name: { type: String, default: "" },
    /** Denormalized for PDF / forms; falls back to populated elevator_id when blank */
    type_of_elevator: { type: String, default: "" },
    operation_type: { type: String, default: "" },
    floors: { type: String, default: "" },
    maker: { type: String, default: "" },
    amount: { type: Number, default: 0, min: 0 },
    /** Portion already moved to invoices from this lift line */
    invoiced_amount: { type: Number, default: 0, min: 0 },
  },
  { _id: true }
);

const QuotationItemSchema = new mongoose.Schema(
  {
    line_no: { type: Number, default: 0 },
    charge_type: {
      type: String,
      enum: ["Service", "Material", "Other"],
      default: "Service",
    },
    group_tag: { type: String, default: "" },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    quantity: { type: Number, required: true, default: 1, min: 0 },
    unit: { type: String, default: "Nos" },
    rate: { type: Number, required: true, default: 0, min: 0 },
    amount: { type: Number, required: true, default: 0, min: 0 },
    /** Cumulative qty already moved to invoices from this line */
    quantity_invoiced: { type: Number, default: 0, min: 0 },
  },
  { _id: true }
);

const QuotationSchema = new mongoose.Schema(
  {
    quotation_number: { type: String, required: true, unique: true, trim: true },
    quotation_date: { type: Date, default: Date.now },
    status: {
      type: String,
      enum: ["Draft", "Sent", "Approved", "Rejected", "Converted"],
      default: "Draft",
    },
    project_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "project",
      required: true,
    },
    branch_id: { type: mongoose.Schema.Types.ObjectId, ref: "branch", default: null },
    /** Empty or omit = all lifts / project-wide */
    elevator_ids: [{ type: mongoose.Schema.Types.ObjectId, ref: "elevator" }],
    client_name: { type: String, default: "" },
    client_email: { type: String, default: "" },
    client_mobile: { type: String, default: "" },
    client_address: { type: String, default: "" },
    gst_no: { type: String, default: "" },
    notes: { type: String, default: "" },
    terms_and_conditions: { type: String, default: "" },
    items: { type: [QuotationItemSchema], default: [] },
    lift_pricing: { type: [QuotationLiftPricingSchema], default: [] },
    gst_percentage: { type: Number, default: 18, min: 0, max: 100 },
    subtotal: { type: Number, default: 0, min: 0 },
    gst_amount: { type: Number, default: 0, min: 0 },
    total_amount: { type: Number, default: 0, min: 0 },
    rejected_reason: { type: String, default: "" },
    converted_amc_id: { type: mongoose.Schema.Types.ObjectId, ref: "amc", default: null },
    linked_invoice_ids: [{ type: mongoose.Schema.Types.ObjectId, ref: "invoice" }],
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: "user", default: null },
    sent_at: { type: Date, default: null },
    approved_at: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false }
);

QuotationSchema.index({ project_id: 1, status: 1 });
QuotationSchema.index({ branch_id: 1, quotation_date: -1 });
QuotationSchema.index({ client_name: "text", quotation_number: "text" });

const Quotation = mongoose.model("quotation", QuotationSchema);

module.exports = { Quotation };
