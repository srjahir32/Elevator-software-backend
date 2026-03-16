const mongoose = require("mongoose");

const TechnicianSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
        },
        contact_number: {
            type: String,
            required: true,
            trim: true,
        },
        email: {
            type: String,
            trim: true,
            lowercase: true,
            default: null,
        },
        address: {
            type: String,
            trim: true,
            default: null,
        },
        is_active: {
            type: Boolean,
            default: true,
        },
        branch_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "branch",
            required: false,
        },
    },
    {
        timestamps: true,
        versionKey: false,
    }
);

const Technician = mongoose.model("technician", TechnicianSchema);

module.exports = { Technician };
