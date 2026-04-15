const mongoose = require("mongoose");

// AMC Service Schedule Schema
const ServiceScheduleSchema = new mongoose.Schema(
  {
    service_type: {
      type: String,
      enum: ["Monthly", "Quarterly", "Half-Yearly", "Annual", "Custom"],
      required: true,
    },
    scheduled_date: {
      type: Date,
      required: true,
    },
    completed_date: {
      type: Date,
      default: null,
    },
    service_status: {
      type: String,
      enum: ["Pending", "In Progress", "Completed", "Skipped", "Overdue"],
      default: "Pending",
    },
    technician_name: {
      type: String,
      default: null,
    },
    technician_contact: {
      type: String,
      default: null,
    },
    service_notes: {
      type: String,
      default: null,
    },
    service_cost: {
      type: Number,
      default: 0,
    },
    lift_label: {
      type: String,
      default: null,
    },
    maintenance_checklist: [
      {
        item: {
          type: String,
          required: true,
        },
        status: {
          type: String,
          enum: ["Pending", "Checked", "Issue Found", "Fixed"],
          default: "Pending",
        },
        notes: {
          type: String,
          default: null,
        },
      },
    ],
    parts_replaced: [
      {
        part_name: {
          type: String,
          required: true,
        },
        part_number: {
          type: String,
          default: null,
        },
        quantity: {
          type: Number,
          default: 1,
        },
        cost: {
          type: Number,
          default: 0,
        },
        replaced_date: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    files: [
      {
        fileType: {
          type: String,
          enum: ["image", "pdf", "video"],
          required: true,
        },
        fileUrl: {
          type: String,
          required: true,
        },
      },
    ],
  },
  { _id: true, timestamps: true }
);

// AMC Payment Schedule Schema
const PaymentScheduleSchema = new mongoose.Schema(
  {
    payment_date: {
      type: Date,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    payment_status: {
      type: String,
      enum: ["Pending", "Paid", "Partial", "Overdue"],
      default: "Pending",
    },
    payment_method: {
      type: String,
      enum: ["Cash", "Cheque", "Bank Transfer", "UPI", "Other", "RTGS", "NEFT"],
      default: null,
    },
    payment_mode: {
      type: String,
      enum: ["Cash", "Bill"],
      default: null,
    },
    paid_date: {
      type: Date,
      default: null,
    },
    transaction_id: {
      type: String,
      default: null,
    },
    notes: {
      type: String,
      default: null,
    },
  },
  { _id: true, timestamps: true }
);

/** Snapshot of a closed term when renewing in-place (same AMC document, new contract period). */
const RenewalTermSnapshotSchema = new mongoose.Schema(
  {
    contract_number: { type: String, required: true },
    contract_start_date: { type: Date, default: null },
    contract_end_date: { type: Date, default: null },
    contract_duration_months: { type: Number, default: null },
    contract_amount: { type: Number, default: null },
    gst_amount: { type: Number, default: null },
    total_amount: { type: Number, default: null },
    total_paid_amount: { type: Number, default: 0 },
    remaining_amount: { type: Number, default: null },
    total_services_completed: { type: Number, default: 0 },
    total_services_pending: { type: Number, default: 0 },
    payment_frequency: { type: String, default: null },
    service_frequency: { type: String, default: null },
    service_schedule: [ServiceScheduleSchema],
    payment_schedule: [PaymentScheduleSchema],
    renewed_at: { type: Date, default: Date.now },
    renewed_by: { type: mongoose.Schema.Types.ObjectId, ref: "users", default: null },
    /** Client, lifts, notes, etc. — full context for “Term detail” UI */
    extra: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: true, timestamps: false }
);

/** Per-lift pricing lines (external / multi-lift AMC form) */
const AMCLiftLineSchema = new mongoose.Schema(
  {
    floors: { type: Number, default: 0 },
    /** Optional display name (e.g. "Passenger A"); service schedule uses this when set */
    lift_name: { type: String, default: "", trim: true },
    maker: { type: String, default: "" },
    operation_type: {
      type: String,
      enum: ["Automatic", "Manual"],
      default: "Automatic",
    },
    amount_with_material: { type: Number, default: 0 },
    amount_without_material: { type: Number, default: 0 },
  },
  { _id: false }
);

const AMCMaterialLineSchema = new mongoose.Schema(
  {
    lift_index: { type: Number, default: null },
    /** Optional elevator ref when lift lines are empty or order differs from lifts[] */
    lift_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "elevator",
      required: false,
      default: null,
    },
    name: { type: String, required: true },
    quantity: { type: Number, default: 1 },
    price: { type: Number, default: 0 },
  },
  { _id: false }
);

// AMC Schema
const AMCSchema = new mongoose.Schema(
  {
    contract_number: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    elevator_ids: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: "elevator",
      required: false,
    }],
    project_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "project",
      required: false,
    },
    is_external: {
      type: Boolean,
      default: false,
    },
    external_project_name: {
      type: String,
      trim: true,
    },
    external_elevator_names: [{
      type: String,
      trim: true,
    }],
    client_name: {
      type: String,
    },
    client_email: {
      type: String,
      required: false,
    },
    client_mobile: {
      type: String,
    },
    client_address: {
      type: String,
      required: false,
    },
    city: {
      type: String,
      default: null,
    },
    area: {
      type: String,
      default: null,
    },
    agreement_no: {
      type: String,
      default: null,
      trim: true,
    },
    supervisor_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      default: null,
    },
    technician_ids: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "users",
      },
    ],
    branch_ids: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "branch",
      },
    ],
    lifts: [AMCLiftLineSchema],
    materials: [AMCMaterialLineSchema],
    previous_contract_amount: {
      type: Number,
      default: 0,
    },
    contract_start_date: {
      type: Date,
    },
    contract_end_date: {
      type: Date,
    },
    contract_duration_months: {
      type: Number,
      default: 12,
    },
    amc_type: {
      type: String,
      enum: ["Comprehensive", "Non-Comprehensive"],
      default: "Comprehensive",
    },
    /** Billing: Paid AMC uses contract/total amounts; Free AMC stores zero amounts. */
    amc_payment_type: {
      type: String,
      enum: ["Free", "Paid"],
      default: "Paid",
    },
    contract_amount: {
      type: Number,
    },
    gst_amount: {
      type: Number,
      default: 0,
    },
    gst_percentage: {
      type: Number,
      default: 0,
    },
    /** When false, contract totals exclude GST (gst_amount 0, total = contract_amount). */
    include_gst: {
      type: Boolean,
      default: true,
    },
    total_amount: {
      type: Number,
    },
    // External Elevator Details
    type_of_elevator: {
      type: String,
      default: null,
    },
    operation_type: {
      type: String,
      default: null,
    },
    passenger_capacity: {
      type: String,
      default: null,
    },
    speed: {
      type: String,
      default: null,
    },
    no_of_floors: {
      type: String,
      default: null,
    },
    stops: {
      type: String,
      default: null,
    },
    opening_type: {
      type: String,
      default: null,
    },
    lift_well_width: {
      type: Number,
      default: null,
    },
    lift_well_depth: {
      type: Number,
      default: null,
    },
    car_enclouser_type: {
      type: String,
      default: null,
    },
    car_flooring_type: {
      type: String,
      default: null,
    },
    car_door_type: {
      type: String,
      default: null,
    },
    landing_door_type: {
      type: String,
      default: null,
    },
    clear_opening_height: {
      type: Number,
      default: null,
    },
    clear_opening_width: {
      type: Number,
      default: null,
    },
    false_ceiling: {
      type: String,
      default: null,
    },
    ms_door_frames: {
      type: String,
      default: null,
    },
    ard_system: {
      type: Boolean,
      default: false,
    },
    overload_sensor: {
      type: Boolean,
      default: false,
    },
    telephone: {
      type: Boolean,
      default: false,
    },
    fan_blower: {
      type: String,
      default: null,
    },
    lop_cop: {
      type: String,
      default: null,
    },
    opening_center_telescope_no: {
      type: String,
      default: null,
    },
    handrail_box: {
      type: String,
      default: null,
    },
    rfid: {
      type: String,
      default: null,
    },
    tft_display: {
      type: String,
      default: null,
    },
    seal_size: {
      type: String,
      default: null,
    },
    rated_load: {
      type: String,
      default: null,
    },
    cabin_height: {
      type: String,
      default: null,
    },
    payment_frequency: {
      type: String,
      enum: ["Monthly", "Quarterly", "Half-Yearly", "Annual", "One-Time"],
      default: "Annual",
    },
    service_frequency: {
      type: String,
      enum: ["Monthly", "Quarterly", "Half-Yearly", "Annual", "Custom"],
      default: "Monthly",
    },
    service_schedule: [ServiceScheduleSchema],
    payment_schedule: [PaymentScheduleSchema],
    total_paid_amount: {
      type: Number,
      default: 0,
    },
    remaining_amount: {
      type: Number,
      default: 0,
    },
    contract_status: {
      type: String,
      enum: ["Active", "Expired", "Cancelled", "Pending", "Completed", "Draft"],
      default: "Pending",
    },
    /** Active = current AMC row; Archived = superseded when renewed into a new AMC document. */
    amc_record_status: {
      type: String,
      enum: ["Active", "Archived"],
      default: "Active",
    },
    /** Set on the new AMC created by renewal — points to the archived predecessor. */
    previous_amc_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "amc",
      default: null,
    },
    /** Set on the archived AMC — points to the replacement active AMC. */
    superseded_by_amc_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "amc",
      default: null,
    },
    renewal_date: {
      type: Date,
      default: null,
    },
    /** Past contract terms (snapshots) after in-place renewal — same AMC id, no duplicate list row. */
    renewal_history: {
      type: [RenewalTermSnapshotSchema],
      default: [],
    },
    auto_renewal: {
      type: Boolean,
      default: false,
    },
    renewal_reminder_days: {
      type: Number,
      default: 30,
    },
    terms_and_conditions: {
      type: String,
      default: null,
    },
    additional_notes: {
      type: String,
      default: null,
    },
    assigned_technician: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      default: null,
    },
    technician_contact: {
      type: String,
      default: null,
    },
    emergency_contact_name: {
      type: String,
      default: null,
    },
    emergency_contact_number: {
      type: String,
      default: null,
    },
    warranty_period_months: {
      type: Number,
      default: 0,
    },
    warranty_start_date: {
      type: Date,
      default: null,
    },
    warranty_end_date: {
      type: Date,
      default: null,
    },
    service_reminder_days: {
      type: Number,
      default: 7, // Remind 7 days before service
    },
    last_service_date: {
      type: Date,
      default: null,
    },
    next_service_date: {
      type: Date,
      default: null,
    },
    total_services_completed: {
      type: Number,
      default: 0,
    },
    total_services_pending: {
      type: Number,
      default: 0,
    },
    branch_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "branch",
      required: false,
    },
    files: [
      {
        fileType: {
          type: String,
          enum: ["image", "pdf", "video"],
          required: true,
        },
        fileUrl: {
          type: String,
          required: true,
        },
      },
    ],
    status: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Indexes for better query performance (contract_number: unique on field already indexes it)
AMCSchema.index({ elevator_id: 1 });
AMCSchema.index({ project_id: 1 });
AMCSchema.index({ contract_start_date: 1 });
AMCSchema.index({ contract_end_date: 1 });
AMCSchema.index({ contract_status: 1 });
AMCSchema.index({ branch_id: 1 });
AMCSchema.index({ branch_id: 1, contract_status: 1 });
AMCSchema.index({ branch_id: 1, contract_end_date: 1 });
AMCSchema.index({ project_id: 1, amc_record_status: 1 });
AMCSchema.index({ amc_record_status: 1, contract_end_date: 1 });

// Pre-save middleware to calculate remaining amount and recalculate total_paid_amount
AMCSchema.pre("save", function (next) {
  // Recalculate total_paid_amount from all payments with status "Paid"
  if (this.payment_schedule && Array.isArray(this.payment_schedule)) {
    const totalPaid = this.payment_schedule
      .filter((payment) => payment.payment_status === "Paid")
      .reduce((sum, payment) => sum + (payment.amount || 0), 0);
    this.total_paid_amount = totalPaid;
  }

  // Calculate remaining amount
  if (this.total_amount && this.total_paid_amount !== undefined) {
    this.remaining_amount = this.total_amount - this.total_paid_amount;
  }
  next();
});

const AMC = mongoose.model("amc", AMCSchema);

module.exports = { AMC };

