const mongoose = require('mongoose');

const BranchSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  is_active: {
    type: Number,
    default: 1, // 1 for active, 0 for inactive
  }
}, {
  timestamps: true,
  versionKey: false,
});

const Branch = mongoose.model('branch', BranchSchema);

module.exports = Branch;
