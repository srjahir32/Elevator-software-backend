const mongoose = require('mongoose');

const ErectorSchema = new mongoose.Schema({
  project_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'project',
    required: true
  },
  erector_name: {
    type: String, required: true
  },
  date: {
    type: Date, required: true
  },
  site_name: {
    type: String
  },
  center_name: {
    type: String
  },
  contact_no: {
    type: String
  },
  total_lift: {
    type: String
  },
  types_lift: {
    type: String
  },
  location: {
    type: String
  },
  specification: {
    type: String
  },
  floor: {
    type: String
  },
  type_of_door: {
    type: String
  },
  total_floor: {
    type: String
  },
  block: {
    type: String
  },
  passenger: {
    type: String,
    default: "8"
  },
  TRA_MRL: {
    type: String,
    enum: ["MRL", "TRA"],
    default: "MRL"
  },
  Scaffolding_charges: {
    type: String
  },
  hoist_way_charge: {
    type: String
  },
  wiring_work: {
    type: String
  },
  other_charges: {
    type: String
  },
  wiring_adjustment_charges: {
    type: String
  },
  out_station_charges: {
    type: String
  },
  complete_date: {
    type: Date
  }
}, {
  timestamps: true,
  versionKey: false
});

const Erector = mongoose.model('erector', ErectorSchema);

const InstallationTermsSchema = new mongoose.Schema({
  erector_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'erector',
    required: true
  },
  total_charges: {
    type: String,
    required: true
  },
  rail_door_frame: {
    type: String,
    default: "Pending"
  },
  rail_door_frame_is_marked: {
    type: Boolean,
    default: false
  },
  machine_roping_door: {
    type: String
  },
  machine_roping_door_is_marked: {
    type: Boolean,
    default: false
  },
  cabin_lift_startup: {
    type: String
  },
  cabin_lift_startup_is_marked: {
    type: Boolean,
    default: false
  },
  after_handover_lift_party: {
    type: String
  },
  after_handover_lift_party_is_marked: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true,
  versionKey: false
});


const InstallationTerms = mongoose.model('installation_terms', InstallationTermsSchema);


const PaymentRecordSchema = new mongoose.Schema({
  erector_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'erector',
    required: true
  },
  date: {
    type: Date, required: true
  },
  payment_amount: {
    type: String, required: true
  },
  type_of_payment: {
    type: String,
    enum: ['Cash', 'Bank Transfer', 'Cheque', 'UPI','RTGS','Other'],
    default: 'Cash'
  },
  by_whom: { type: String } 
}, {
  timestamps: true,
  versionKey: false
});

const PaymentRecord = mongoose.model('payment_record', PaymentRecordSchema);




const MiniErectorSchema = new mongoose.Schema({
  erector_name: {
    type: String, required: true
  },
  date: {
    type: Date, required: true
  },
  mobile_no: {
    type: String, required: true
  },
 aadhar_no: {
  type: String,
  // unique: true,
  // sparse: true,
  validate: {
    validator: function (v) {
      return /^\d{12}$/.test(v);
    },
    message: 'Aadhar number must be 12 digits'
  },
  default: null
},
}, {
  timestamps: true,
  versionKey: false
});

const MiniErector = mongoose.model('mini_erector', MiniErectorSchema);



module.exports = {
  Erector,
  InstallationTerms,
  PaymentRecord,
  MiniErector
}