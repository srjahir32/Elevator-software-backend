const mongoose = require('mongoose');

const DeliveryListFormSchema = new mongoose.Schema({
    project_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'project',
        required: true
    },
    form_name: {
        type: String,
        required: true
    },
    date: {
        type: String,
        required: true
    },
    project_name: {
        type: String,   
        required: true
    },
    erector_name: {
        type: String,   
        required: true
    },
    panel_name: {
        type: String,   
        required: true
    },
    lop_cop: {
        type: String,   
        required: true
    },
     floor_count: {
        type: String,   
        required: true
    },
      wireman_date: {
        type: String,   
        required: true
    },
},{
    timestamps: true,
    versionKey: false
})

const DeliveryListForm = mongoose.model('delivery_list_form', DeliveryListFormSchema);
 
const DeliveryListSubFormSchema = new mongoose.Schema({
    id: {
        type: mongoose.Schema.Types.ObjectId,
        auto: true
    },
    type: {
        type: String,
        required: true
    },
    parent_form_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'delivery_list_form',
        required: true
    },
    metadata : {
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
},{
    timestamps: true,
    versionKey: false
})

const DeliveryListSubForm = mongoose.model('delivery_list_sub_form', DeliveryListSubFormSchema);

;

module.exports = {
    DeliveryListForm,
    DeliveryListSubForm,
};
