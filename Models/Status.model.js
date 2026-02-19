const mongoose = require('mongoose');

const StatusTypeSchema = new mongoose.Schema({
  id: {
    type: Number,
    required: true,
    unique: true
  },
  data_name: {
    type: String,
    required: true,
    enum: ['Pending', 'Approved', 'Rejected'] 
    },
}, {
  versionKey: false,
  timestamps: false
});

const Status_Type = mongoose.model('status_type', StatusTypeSchema);

module.exports = {Status_Type};
