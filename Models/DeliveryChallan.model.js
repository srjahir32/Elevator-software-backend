const mongoose = require("mongoose");

const DeliveryChallanItemSchema = new mongoose.Schema({
    part_name: { type: String, required: true },
    part_code: { type: String },
    quantity: { type: Number, required: true, default: 1 },
    unit_price: { type: Number, required: true, default: 0 },
    total_price: { type: Number, required: true, default: 0 },
});

const DeliveryChallanSchema = new mongoose.Schema(
    {
        challan_number: { type: String, required: true, unique: true },
        project_id: { type: mongoose.Schema.Types.ObjectId, ref: "project", default: null },
        elevator_ids: [{ type: mongoose.Schema.Types.ObjectId, ref: "elevator" }],
        is_external: { type: Boolean, default: false },
        external_project_name: { type: String },
        external_elevator_names: [{ type: String }],
        client_name: { type: String },
        client_email: { type: String },
        client_mobile: { type: String },
        client_address: { type: String },
        service_id: { type: mongoose.Schema.Types.ObjectId, ref: "maintenance_log", default: null },
        ticket_id: { type: mongoose.Schema.Types.ObjectId, ref: "complaintforms", default: null },
        delivery_date: { type: Date, required: true, default: Date.now },
        delivery_location: { type: String },
        total_amount: { type: Number, required: true, default: 0 },
        status: {
            type: String,
            enum: ["Draft", "Issued", "Delivered", "Closed"],
            default: "Draft",
        },
        remarks: { type: String },
        items: [DeliveryChallanItemSchema],
        branch_id: { type: mongoose.Schema.Types.ObjectId, ref: "branch" },
        created_by: { type: mongoose.Schema.Types.ObjectId, ref: "user" },
        /** AMC-linked challan (frontend sends amc_id + lift_indices) */
        amc_id: { type: mongoose.Schema.Types.ObjectId, ref: "amc", default: null },
        challan_type: { type: String, default: "Material Delivery" },
        lift_indices: [{ type: Number }],
        lift_labels: [{ type: String }],
        service_schedule_id: { type: mongoose.Schema.Types.ObjectId, default: null },
        technician_ids: [{ type: mongoose.Schema.Types.ObjectId, ref: "users" }],
    },
    { timestamps: true, versionKey: false }
);

DeliveryChallanSchema.index({ project_id: 1 });
DeliveryChallanSchema.index({ elevator_ids: 1 });
DeliveryChallanSchema.index({ status: 1 });
DeliveryChallanSchema.index({ amc_id: 1 });

const DeliveryChallan = mongoose.model("delivery_challan", DeliveryChallanSchema);

module.exports = { DeliveryChallan };
