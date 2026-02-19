const mongoose = require('mongoose');

const ImageSchema = new mongoose.Schema({
  project_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'project', 
    required: true
  },
  table_type: {
    type: String,
    required: true
  },
  table_id: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  table_sub_id: {
    type: mongoose.Schema.Types.ObjectId,
    required: false 
  },
  document_url: {
    type: String,
    required: true
  }
}, {
  timestamps: true 
});

const Image = mongoose.model('images', ImageSchema);


module.exports = {Image};
