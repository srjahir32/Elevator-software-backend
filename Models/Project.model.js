const mongoose = require("mongoose");

//* Project Schema *//
const ProjectSchema = new mongoose.Schema(
  {
    site_name: {
      type: String,
      required: true,
    },
    aggrement_no: {
      type: String,
      default: null,
    },
    aggrement_date: {
      type: Date,
      default: null,
    },
    site_address: {
      type: String,
      required: true,
    },
    client_name: {
      type: String,
      required: true,
    },
    client_mobile: {
      type: String,
      required: false,
    },
    client_email: {
      type: String,
      required: false,
    },
    gst_no: {
      type: String,
      required: false,
    },
    payment_amount: {
      type: Number,
      required: true,
    },
    additional_notes: {
      type: String,
      required: false,
    },
    Site_Supervisor: {
      type: String,
      required: true,
    },
    cash_amount_project:{
      type: Number,
      required: false,
    },
    bank_amount_project:{
      type: Number,
      required: false,
    },
    total_amount_project:{
      type: Number,
      required: false,
    },
    payment_count_project:{
      type: Number,
      required: false,
    },
    status: {
      type: Number,
      // enum: [1, 2, 3],  // 1: pending, 2: approved, 3: rejected
      default: 0,
    },
    map_url: {
      type: String,
      required: false,
    },
    // location: {
    //     lat: { type: Number, required: true },
    //     lng: { type: Number, required: true },
    // },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

const Project = mongoose.model("project", ProjectSchema);

//* Elevator Schema *//
const ElevatorSchema = new mongoose.Schema(
  {
    project_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "project",
      required: true,
    },
    elevator_name: {
      type: String,
      required: true,
    },
    type_of_elevator: {
      type: String,
      required: true,
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
      required: true,
    },
    no_of_floors: {
      type: String,
      required: true,
    },
    stops: {
      type: String,
      required: true,
    },
    opening_type: {
      type: String,
      required: true,
    },
    lift_well_width: {
      type: Number,
      required: true,
    },
    lift_well_depth: {
      type: Number,
      required: true,
    },
    car_enclouser_type: {
      type: String,
      required: true,
    },
    car_flooring_type: {
      type: String,
      required: true,
    },
    car_door_type: {
      type: String,
      required: true,
    },
    landing_door_type: {
      type: String,
      required: true,
    },
    clear_opening_height: {
      type: Number,
      required: true,
    },
    clear_opening_width: {
      type: Number,
      required: true,
    },
    false_ceiling: {
      type: String,
      required: true,
    },
    ms_door_frames: {
      type: String,
      required: true,
    },
    ard_system: {
      type: Boolean,
      required: true,
      default: false,
    },
    overload_sensor: {
      type: Boolean,
      required: true,
      default: false,
    },
    telephone: {
      type: Boolean,
      required: true,
      default: false,
    },
    fan_blower: {
      type: String,
      required: true,
    },
    lop_cop: {
      type: String,
      required: true,
    },
    notes: {
      type: String,
      required: false,
    },
    opening_center_telescope_no: {
      type: String,
      required: false,
    },
    handrail_box: {
      type: String,
      required: false,
    },

    rfid: {
      type: String,
      required: false,
    },
    tft_display: {
      type: String,
      required: false,
    },
    // job_number:{
    //     type: String,
    //     required: false,
    // },
    seal_size: {
      type: String,
      required: false,
    },
    rated_load: {
      type: String,
      required: false,
    },
    cabin_height: {
      type: String,
      required: false,
    },
    files: [
      {
          fileType: {
              type: String,
              enum: ['image', 'video'],
              required: true
          },
          fileUrl: {
              type: String,
              required: true
          }
      }
  ],
    status: {
      type: Number,
      default: 0,
    },
    // price: {
    //     type: Number,
    //     default: 0,
    // },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

const Elevators = mongoose.model("elevator", ElevatorSchema);

//* Pre Installation Steps Schema *//

const PreInstallationSchema = new mongoose.Schema(
  {
    project_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "project",
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    lift_details: {
      type: String,
      default: null,
    },
    lift_shaft_plaster: {
      type: Boolean,
      default: false,
    },
    pit_water_ppc: {
      type: Boolean,
      default: false,
    },
    machine_room_pcc: {
      type: Boolean,
      default: false,
    },
    lift_machine_clean: {
      type: Boolean,
      default: false,
    },
    whitewash_wiring: {
      type: Boolean,
      default: false,
    },
    machine_room_ladder_door_window: {
      type: Boolean,
      default: false,
    },
    files: [
      {
        fileType: {
          type: String,
          enum: ["image", "video"],
          required: true,
        },
        fileUrl: {
          type: String,
          required: true,
        },
      },
    ],
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

const PreInstallation = mongoose.model(
  "pre_installation",
  PreInstallationSchema
);

//* Material Set Information Schema *//

const MaterialItemSchema = new mongoose.Schema(
  {
    partName: {
      type: String,
      required: false,
    },
    brandName: {
      type: String,
      required: false,
    },
    orderDetailsWithQty: {
      type: String,
      required: false,
    },
    qty: {
      type: String,
      required: false,
    },
    received: {
      type: Boolean,
      default: false,
      required: false,
    },
    receivedDate: {
      type: Date,
      default: null,
    },
    requireDate: {
      type: Date,
      default: null,
    },
    orderDate: {
      type: Date,
      default: null,
    },
    remarks: {
      type: String,
      default: null,
    },
    color: {
      type: String,
      required: false,
    },
    height: {
      type: String,
      required: false,
    },
    vision:{
      type: String,
      required: false,
    },
    billDetails:{
      type: String,
      required: false,
    },
    overload:{
      type: String,
      required: false,
    },
    meter:{
      type: String,
      required: false,
    },
    prograssive:{
      type: String,
      required: false,
    },
    counter_dbg:{
      type: String,
      required: false,
    },
    counter_weight:{
      type: String,
      required: false,
    },
    light:{
      type: String,
      required: false,
    },
    serial_parallel:{
      type: String,
      required: false,
    },

    files: [
      {
        _id: { type: mongoose.Schema.Types.ObjectId, auto: true },
        fileType: {
          type: String,
          enum: ["image", "pdf"],
          required: false,
        },
        fileUrl: {
          type: String,
          required: false,
        },
      },
    ]
    



  },
  { _id: true }
);


const MaterialSetSchema = new mongoose.Schema(
  {
    project_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "project",
      required: true,
    },
    materialSetTitle: {
      type: String,
      required: true,
    },
    vendorOrderList: {
      type: [MaterialItemSchema],
      default: [],
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

const MaterialSet = mongoose.model("material_set", MaterialSetSchema);

const VendorSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    company_name: {
      type: String,
      required: false,
      trim: true,
    },
    mobile_number: {
      type: String,
      required: false,
      match: /^\+?[0-9]{10,15}$/, // Optional + and 10–15 digits
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

const Vendor = mongoose.model("vendor", VendorSchema);

const PaymentEntrySchema = new mongoose.Schema(
  {
    id: {
      type: mongoose.Schema.Types.ObjectId,
      auto: true,
    },
    project_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "project",
      required: true,
    },
    date: {
      type: Date,
      required: true,
    },
    payment_Made: {
      type: Number,
      default: 0,
    },
    payment_method: {
      type: String,
      enum: ["Cash", "Cheque", "Bank Transfer", "UPI", "Other","RTGS","NEFT"],
    },
    payment_mode:{
      type: String,
      enum: ["Cash","Bill"],
    },
    paid_to: {
      type: String,
      required: true,
    },
    cash_amount:{
      type: Number,
      required: false,
    },
    bank_amount:{
      type: Number,
      required: false,
    },
    total_amount:{
      type: Number,
      required: false,
    },
    payment_count:{
      type: Number,
      required: false,
    }
  },
  {
    timestamps: true,
  }
);

const PaymentEntry = mongoose.model("PaymentEntry", PaymentEntrySchema);

module.exports = {
  Project,
  Elevators,
  PreInstallation,
  MaterialSet,
  Vendor,
  PaymentEntry,
};
