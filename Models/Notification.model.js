const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      required: true,
    },
    mark_as_read: {
      type: Boolean,
      required: true,
    },
    content: {
      type: String,
      required: true, 
    },
    action_type: {
      type: String,
      required: true,
    },
    action_id: {
      type: String,
      required: true,
    },
    action_route: {
      type: String,
      required: false,
    },
  },
  {
    timestamps: true,
  }
);

const NotificationSchema = mongoose.model('Notification', notificationSchema);

module.exports = { NotificationSchema };