const mongoose = require("mongoose");

const ActivityEntrySchema = new mongoose.Schema(
  {
    action: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    performed_by_name: { type: String, default: null },
    from_status: { type: String, default: null },
    to_status: { type: String, default: null },
    remark: { type: String, default: null },
  },
  { _id: true }
);

const ComplaintSchema = new mongoose.Schema(
  {
    complaint_number: { type: String, required: true, unique: true, trim: true },
    branch_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "branch",
      default: null,
    },
    amc_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "amc",
      required: true,
    },
    lift_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "elevator",
      default: null,
    },
    project_name: { type: String, default: "" },
    lift_label: { type: String, default: "" },
    description: { type: String, required: true },
    party_mobile: { type: String, default: "" },
    status: {
      type: String,
      enum: ["Open", "In Progress", "Resolved", "Closed"],
      default: "Open",
    },
    assigned_technician_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      default: null,
    },
    complaint_datetime: { type: Date, required: true },
    closed_at: { type: Date, default: null },
    resolution_minutes: { type: Number, default: null },
    closing_remark: { type: String, default: null },
    service_schedule_id: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      default: null,
    },
    activity_log: [ActivityEntrySchema],
  },
  { timestamps: true, versionKey: false }
);

ComplaintSchema.index({ branch_id: 1, complaint_datetime: -1 });
ComplaintSchema.index({ amc_id: 1 });
ComplaintSchema.index({ status: 1 });

const Complaint = mongoose.model("complaint", ComplaintSchema);

module.exports = { Complaint };
