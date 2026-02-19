const Branch = require('../../Models/Branch.model');
const { ResponseOk, ErrorHandler } = require('../../Utils/ResponseHandler');
const { ActivityLog } = require('../../Models/Activitylog.model');
const { Users } = require('../../Models/User.model');

const CreateBranch = async (req, res) => {
    try {
        const { name } = req.body;

        if (!name) {
            return ErrorHandler(res, 200, "Branch name is required");
        }

        const branch = await Branch.create({ name });

        const user_details = await Users.findById(req.auth.id);
        if (user_details) {
            await ActivityLog.create({
                user_id: req.auth?.id || null,
                user_name: user_details.name,
                action: 'ADD_BRANCH',
                type: 'Create',
                description: `${user_details.name} has created branch named as ${name}.`,
                title: 'Branch Added',
            });
        }

        return ResponseOk(res, 201, "Branch created successfully", branch);
    } catch (error) {
        console.error("[CreateBranch]", error);
        return ErrorHandler(res, 500, "Server error while creating branch");
    }
};

const GetAllBranches = async (req, res) => {
    try {
        const branches = await Branch.find().sort({ createdAt: -1 });
        return ResponseOk(res, 200, "Branches retrieved successfully", branches);
    } catch (error) {
        console.error("[GetAllBranches]", error);
        return ErrorHandler(res, 500, "Server error while retrieving branches");
    }
};

const GetBranchById = async (req, res) => {
    try {
        const { id } = req.params;
        const branch = await Branch.findById(id);
        if (!branch) {
            return ErrorHandler(res, 200, "Branch not found");
        }
        return ResponseOk(res, 200, "Branch retrieved successfully", branch);
    } catch (error) {
        console.error("[GetBranchById]", error);
        return ErrorHandler(res, 500, "Server error while retrieving branch");
    }
};

const UpdateBranch = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, is_active } = req.body;

        const updateData = {};
        if (name !== undefined) updateData.name = name;
        if (is_active !== undefined) updateData.is_active = is_active;

        const updatedBranch = await Branch.findByIdAndUpdate(
            id,
            { $set: updateData },
            { new: true, runValidators: true }
        );

        if (!updatedBranch) {
            return ErrorHandler(res, 200, "Branch not found");
        }

        const user_details = await Users.findById(req.auth.id);
        if (user_details) {
            await ActivityLog.create({
                user_id: req.auth?.id || null,
                user_name: user_details.name,
                action: 'UPDATE_BRANCH',
                type: 'Update',
                description: `${user_details.name} has updated branch ${updatedBranch.name}.`,
                title: 'Branch Updated',
            });
        }

        return ResponseOk(res, 200, "Branch updated successfully", updatedBranch);
    } catch (error) {
        console.error("[UpdateBranch]", error);
        return ErrorHandler(res, 500, "Server error while updating branch");
    }
};

const DeleteBranch = async (req, res) => {
    try {
        const { id } = req.params;

        const deletedBranch = await Branch.findByIdAndDelete(id);

        if (!deletedBranch) {
            return ErrorHandler(res, 200, "Branch not found");
        }

        const user_details = await Users.findById(req.auth.id);
        if (user_details) {
            await ActivityLog.create({
                user_id: req.auth?.id || null,
                user_name: user_details.name,
                action: 'DELETE_BRANCH',
                type: 'Delete',
                description: `${user_details.name} has deleted branch ${deletedBranch.name}.`,
                title: 'Branch Deleted',
            });
        }

        return ResponseOk(res, 200, "Branch deleted successfully", deletedBranch);
    } catch (error) {
        console.error("[DeleteBranch]", error);
        return ErrorHandler(res, 500, "Server error while deleting branch");
    }
};

module.exports = {
    CreateBranch,
    GetAllBranches,
    GetBranchById,
    UpdateBranch,
    DeleteBranch,
};
