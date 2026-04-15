const mongoose = require("mongoose");
const { ResponseOk, ErrorHandler } = require("../../Utils/ResponseHandler");
const { Users, User_Associate_With_Role, Roles } = require("../../Models/User.model");
const { getTechnicianUsersForDropdown } = require("../../Utils/technicianUsers");

const STUB_MSG =
  "Technicians are managed as Users with the Technician role. Add or edit users under User Management.";

const CreateTechnician = async (req, res) => {
  return ErrorHandler(res, 400, STUB_MSG);
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
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return ErrorHandler(res, 200, "Technician not found");
    }
    const userId = new mongoose.Types.ObjectId(id);
    const techRole = await Roles.findOne({ name: /^Technician$/i }).lean();
    if (!techRole) {
      return ErrorHandler(res, 200, "Technician not found");
    }
    const link = await User_Associate_With_Role.findOne({
      user_id: userId,
      role_id: techRole.id,
    }).lean();
    if (!link) {
      return ErrorHandler(res, 200, "Technician not found");
    }
    const user = await Users.findById(id).select("name contact_number email").lean();
    if (!user) {
      return ErrorHandler(res, 200, "Technician not found");
    }
    return ResponseOk(res, 200, "Technician retrieved successfully", {
      _id: user._id,
      name: user.name,
      contact_number: user.contact_number,
      email: user.email,
    });
  } catch (error) {
    console.error("[GetTechnicianById]", error);
    return ErrorHandler(res, 500, "Server error while retrieving technician");
  }
};

const UpdateTechnician = async (req, res) => {
  return ErrorHandler(res, 400, STUB_MSG);
};

const DeleteTechnician = async (req, res) => {
  return ErrorHandler(res, 400, STUB_MSG);
};

module.exports = {
  CreateTechnician,
  GetAllTechnicians,
  GetTechnicianById,
  UpdateTechnician,
  DeleteTechnician,
};
