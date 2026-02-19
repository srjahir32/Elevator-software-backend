
const mongoose = require("mongoose");

const QCEntrySchema = new mongoose.Schema({
  project_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "project",
    required: true,
  },
  qc_name: {
    type: String,
    required: true,
    trim: true,
  },
  areaName: {
    type: String,
    required: true,
    trim: true,
  },
  date: {
    type: Date,
    required: true,
  },
  siteName: {
    type: String,
    required: true,
    trim: true,
  },
  jobNumber: {
    type: String,
    trim: true,
  },
  wingOrLiftNo: {
    type: String,
    trim: true,
  },
  type: {
    type: String,
    trim: true,
  },
  sideSupervisor: {
    type: String,
    trim: true,
  },
  wiremanName: {
    type: String,
    required: true,
    trim: true,
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
  notes: {
    type: String,
    trim: true,
  },
  inspection_data: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
}, {
  timestamps: true,
});

const QCEntry = mongoose.model("qcentrys", QCEntrySchema);



const MeachanicalQcSchema = new mongoose.mongoose.Schema({
  id: {
    type: mongoose.Schema.Types.ObjectId,
    auto: true
  },
  project_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'project',
    required: true
  },

  site_name: {
    type: String,
    required: true
  },
  date: {
    type: Date,
    required: true
  },
  mobile_number: {
    type: String,
    required: true
  },
  supervisor_name: {
    type: String,
    required: true
  },
  elevator: {
    type: String,
    required: true
  },
  block: {
    type: String,
    required: true
  },
  machine_make: {
    type: String,
    required: true
  },
  machine_hp: {
    type: String,
    required: true
  },
  machine_sr_no: {
    type: String,
    required: true
  },
  drive_make: {
    type: String,
    required: true
  },
  drive_hp: {
    type: String,
    required: true
  },
  drive_sr_no: {
    type: String,
    required: true
  },
  lift_floor: {
    type: String,
    required: true
  },
  lift_capacity: {
    type: String,
    required: true
  },
  lift_type: {
    type: String,
    required: true
  },
}, {
  timestamps: true,
  versionKey: false
})

const MeachanicalQc = mongoose.model('meachanical_qc', MeachanicalQcSchema);

const MeachanicalQcFormSchema = new mongoose.Schema({

  parent_form_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'meachanical_qc',
    required: true
  },

  form_no: {
    type: String,
    required: true
  },
  sub_form_no: {
    type: String,
    required: true
  },
  form_type: {
    type: String,
    required: true
  },
  form_data: {
    type: mongoose.Schema.Types.Mixed,
    required: true
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
  ]
}, {
  timestamps: true,
  versionKey: false
})

const MeachanicalQcForm = mongoose.model('meachanical_qc_form', MeachanicalQcFormSchema);

module.exports = {
  QCEntry,
  MeachanicalQc,
  MeachanicalQcForm
}