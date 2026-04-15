const mongoose = require("mongoose");

const LicenseeSchema = new mongoose.Schema(
  {
    branch_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "branch",
      default: null,
    },
    project_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "project",
      required: true,
    },
    elevator_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "elevator",
      required: true,
    },
    license_number: {
      type: String,
      required: true,
      trim: true,
    },
    license_start_date: {
      type: Date,
      required: true,
    },
    license_end_date: {
      type: Date,
      required: true,
    },
    /** Set when this row was replaced by a renewal — excluded from “current” list & dashboard alerts */
    superseded_by_license_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "licensee",
      default: null,
    },
    superseded_at: {
      type: Date,
      default: null,
    },
    /** New row points to the license it replaced (renewal chain) */
    replaced_license_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "licensee",
      default: null,
    },
  },
  { timestamps: true, versionKey: false }
);

LicenseeSchema.index({ branch_id: 1, license_end_date: 1 });
LicenseeSchema.index({ project_id: 1, elevator_id: 1 });
LicenseeSchema.index({ project_id: 1, elevator_id: 1, superseded_by_license_id: 1, createdAt: -1 });

const Licensee = mongoose.model("licensee", LicenseeSchema);

module.exports = { Licensee };
