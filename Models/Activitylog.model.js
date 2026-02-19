const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      required: false,
    },
    user_name: {
      type: String,
      required: false,
    },
    action: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      required: true, 
    },
    description: {
      type: String,
      required: false,
    },
    title: {
      type: String,
      required: true,
    },
    project_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'projects',
      required: false,
    },
  },
  {
    timestamps: true,
  }
);

const ActivityLog = mongoose.model('ActivityLog', activityLogSchema);

module.exports = { ActivityLog };
