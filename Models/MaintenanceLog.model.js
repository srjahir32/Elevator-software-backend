const mongoose = require("mongoose");

const MaintenanceLogSchema = new mongoose.Schema(
  {
    amc_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "amc",
      required: true,
    },
    service_schedule_id: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    service_status: {
      type: String,
      enum: ["Pending", "In Progress", "Completed", "Skipped", "Overdue"],
      default: "Pending",
    },
    completed_date: { type: Date, default: null },
    technician_name: { type: String, default: null },
    technician_contact: { type: String, default: null },
    remarks: { type: String, default: null },
    service_notes: { type: String, default: null },
    service_cost: { type: Number, default: 0 },
    files: [
      {
        fileType: { type: String, enum: ["image", "pdf", "video"], required: true },
        fileUrl: { type: String, required: true },
      },
    ],
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: "user", default: null },
  },
  { timestamps: true, versionKey: false }
);

MaintenanceLogSchema.index({ amc_id: 1 });
MaintenanceLogSchema.index({ service_schedule_id: 1 });

const MaintenanceLog = mongoose.model("maintenance_log", MaintenanceLogSchema);
module.exports = { MaintenanceLog };
