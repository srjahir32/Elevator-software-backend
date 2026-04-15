const { Technician } = require("../../Models/Technician.model");
const { ResponseOk, ErrorHandler } = require("../../Utils/ResponseHandler");
const { ActivityLog } = require("../../Models/Activitylog.model");
const { Users } = require("../../Models/User.model");
const { getTechnicianUsersForDropdown } = require("../../Utils/technicianUsers");

const CreateTechnician = async (req, res) => {
    try {
        const { name, contact_number, email, address, branch_id } = req.body;

        if (!name || !contact_number) {
            return ErrorHandler(res, 200, "Technician name and contact number are required");
        }

        const technician = await Technician.create({
            name,
            contact_number,
            email,
            address,
            branch_id: branch_id || null,
        });

        const user_details = await Users.findById(req.auth.id);
        if (user_details) {
            await ActivityLog.create({
                user_id: req.auth?.id || null,
                user_name: user_details.name,
                action: "ADD_TECHNICIAN",
                type: "Create",
                description: `${user_details.name} has created technician named as ${name}.`,
                title: "Technician Added",
            });
        }

        return ResponseOk(res, 201, "Technician created successfully", technician);
    } catch (error) {
        console.error("[CreateTechnician]", error);
        return ErrorHandler(res, 500, "Server error while creating technician");
    }
};

const GetAllTechnicians = async (req, res) => {
    try {
        const { branch_id } = req.query;
        const technicians = await getTechnicianUsersForDropdown({
            branch_id: branch_id || undefined,
        });
        return ResponseOk(res, 200, "Technicians retrieved successfully", technicians);
    } catch (error) {
        console.error("[GetAllTechnicians]", error);
        return ErrorHandler(res, 500, "Server error while retrieving technicians");
    }
};

const GetTechnicianById = async (req, res) => {
    try {
        const { id } = req.params;
        const technician = await Technician.findById(id);
        if (!technician) {
            return ErrorHandler(res, 200, "Technician not found");
        }
        return ResponseOk(res, 200, "Technician retrieved successfully", technician);
    } catch (error) {
        console.error("[GetTechnicianById]", error);
        return ErrorHandler(res, 500, "Server error while retrieving technician");
    }
};

const UpdateTechnician = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, contact_number, email, address, is_active, branch_id } = req.body;

        const updateData = {};
        if (name !== undefined) updateData.name = name;
        if (contact_number !== undefined) updateData.contact_number = contact_number;
        if (email !== undefined) updateData.email = email;
        if (address !== undefined) updateData.address = address;
        if (is_active !== undefined) updateData.is_active = is_active;
        if (branch_id !== undefined) updateData.branch_id = branch_id;

        const updatedTechnician = await Technician.findByIdAndUpdate(
            id,
            { $set: updateData },
            { new: true, runValidators: true }
        );

        if (!updatedTechnician) {
            return ErrorHandler(res, 200, "Technician not found");
        }

        const user_details = await Users.findById(req.auth.id);
        if (user_details) {
            await ActivityLog.create({
                user_id: req.auth?.id || null,
                user_name: user_details.name,
                action: "UPDATE_TECHNICIAN",
                type: "Update",
                description: `${user_details.name} has updated technician ${updatedTechnician.name}.`,
                title: "Technician Updated",
            });
        }

        return ResponseOk(res, 200, "Technician updated successfully", updatedTechnician);
    } catch (error) {
        console.error("[UpdateTechnician]", error);
        return ErrorHandler(res, 500, "Server error while updating technician");
    }
};

const DeleteTechnician = async (req, res) => {
    try {
        const { id } = req.params;

        const deletedTechnician = await Technician.findByIdAndDelete(id);

        if (!deletedTechnician) {
            return ErrorHandler(res, 200, "Technician not found");
        }

        const user_details = await Users.findById(req.auth.id);
        if (user_details) {
            await ActivityLog.create({
                user_id: req.auth?.id || null,
                user_name: user_details.name,
                action: "DELETE_TECHNICIAN",
                type: "Delete",
                description: `${user_details.name} has deleted technician ${deletedTechnician.name}.`,
                title: "Technician Deleted",
            });
        }

        return ResponseOk(res, 200, "Technician deleted successfully", deletedTechnician);
    } catch (error) {
        console.error("[DeleteTechnician]", error);
        return ErrorHandler(res, 500, "Server error while deleting technician");
    }
};

module.exports = {
    CreateTechnician,
    GetAllTechnicians,
    GetTechnicianById,
    UpdateTechnician,
    DeleteTechnician,
};
