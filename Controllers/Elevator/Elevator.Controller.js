const express = require("express");
const router = express.Router();
const { Elevators } = require("../../Models/Project.model");
const { ResponseOk, ErrorHandler } = require("../../Utils/ResponseHandler");
const { ActivityLog } = require("../../Models/Activitylog.model");
const { Project } = require("../../Models/Project.model");
const { Users } = require("../../Models/User.model");
const path = require('path');
const fs = require('fs');

const CreateElevator = async (req, res) => {
  try {
    const {
      project_id,
      elevator_name,
      // job_number,
      seal_size,
      rated_load,
      cabin_height,
      type_of_elevator,
      operation_type,
      passenger_capacity,
      speed,
      no_of_floors,
      stops,
      opening_type,
      lift_well_width,
      lift_well_depth,
      car_enclouser_type,
      car_flooring_type,
      car_door_type,
      landing_door_type,
      clear_opening_height,
      clear_opening_width,
      false_ceiling,
      opening_center_telescope_no,
      handrail_box,
      rfid,
      tft_display,
      ms_door_frames,
      ard_system,
      overload_sensor,
      telephone,
      fan_blower,
      lop_cop,
      notes,
    } = req.body;

    const uploadedFiles = req.files || [];

    const files = uploadedFiles.map(file => ({
      fileType: file.mimetype.startsWith('video') ? 'video' : 'image',
      fileUrl: `/public/uploads/${file.mimetype.startsWith('video') ? 'videos' : 'images'}/${file.filename}`
    }));
    const project = await Project.findById(project_id).select("site_name");
    const site_name = project ? project.site_name : "Unknown Project";

    const newElevator = new Elevators({
      project_id,
      // job_number,
      seal_size,
      rated_load,
      cabin_height,
      elevator_name,
      type_of_elevator,
      operation_type,
      passenger_capacity,
      speed,
      no_of_floors,
      stops,
      opening_type,
      lift_well_width,
      lift_well_depth,
      car_enclouser_type,
      car_flooring_type,
      car_door_type,
      landing_door_type,
      clear_opening_height,
      clear_opening_width,
      false_ceiling,
      opening_center_telescope_no,
      handrail_box,
      rfid,
      tft_display,
      ms_door_frames,
      ard_system,
      overload_sensor,
      telephone,
      fan_blower,
      lop_cop,
      notes,
      files
    });

    const savedElevator = await newElevator.save();

    const user_details = await Users.findById(req.auth.id);
    const projectDetails = await Project.findById(project_id).select(
      "site_name"
    );
    await ActivityLog.create({
      user_id: req.auth?.id || null,
      user_name: user_details.name,
      action: "ADD_ELEVATOR",
      type: "Create",
      description: `${user_details.name} has added an elevator named "${elevator_name}" to project "${projectDetails.site_name}".`,
      title: "Elevator Added",
      project_id: project_id,
    });

    return ResponseOk(res, 201, "Elevator created successfully", savedElevator);
  } catch (error) {
    console.error("Error creating elevator:", error);
    return ErrorHandler(res, 500, "Failed to create elevator", error);
  }
};

const UpdateElevator = async (req, res) => {
  try {
    const elevatorId = req.query.id;
    const updateData = req.body;
    console.log("Update Data:", updateData);

    
    const updatedElevator = await Elevators.findByIdAndUpdate(
      elevatorId,
      updateData,
      { new: true }
    );
    if (req.body.deletedFileIds) {

      const idsToDelete = Array.isArray(req.body.deletedFileIds)
        ? req.body.deletedFileIds
        : req.body.deletedFileIds
          ? [req.body.deletedFileIds]
          : [];
      const UpdateddeletedImgIds = JSON.parse(idsToDelete);
      if (UpdateddeletedImgIds.length > 0) {
        for (const fileId of UpdateddeletedImgIds) {
          const fileToRemove = updatedElevator.files.find(
            (file) => file._id.toString() === fileId
          );

          if (fileToRemove) {
            const filePath = path.join(
              __dirname,
              "..",
              fileToRemove.fileUrl.replace("/public", "public")
            );

            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
            }
          }
        }

        updatedElevator.files = updatedElevator.files.filter(
          (file) => !UpdateddeletedImgIds.includes(file._id.toString())
        );
      }
    }
    const uploadedFiles = req.files || [];
    const newFiles = uploadedFiles.map((file) => ({
      fileType: file.mimetype.startsWith("video") ? "video" : "image",
      fileUrl: `/public/uploads/${file.mimetype.startsWith("video") ? "videos" : "images"
        }/${file.filename}`,
    }));
    if (newFiles.length > 0) {
      updatedElevator.files.push(...newFiles);
    }
    await updatedElevator.save();

    if (!updatedElevator) {
      return ErrorHandler(res, 404, "Elevator not found");
    }
    const project_ID = updatedElevator.project_id;
    const user_details = await Users.findById(req.auth.id);
    const projectDetails = await Project.findOne({
      _id: updatedElevator.project_id,
    }).select("site_name");
    await ActivityLog.create({
      user_id: req.auth?.id || null,
      user_name: user_details.name,
      action: "UPDATE_ELEVATOR",
      type: "Update",
      description: `${user_details.name} has updated an elevator named "${updatedElevator.elevator_name}" of project "${projectDetails.site_name}".`,
      title: "Elevator Updated",
      project_id: updatedElevator.project_id,
    });
    return ResponseOk(
      res,
      200,
      "Elevator updated successfully",
      updatedElevator
    );
  } catch (error) {
    console.error("Error updating elevator:", error);
    return ErrorHandler(res, 500, "Failed to update elevator", error);
  }
};

const GetElevatorById = async (req, res) => {
  try {
    const elevatorId = req.query.id;
    const elevator = await Elevators.findById(elevatorId).lean();

    if (!elevator) {
      return ErrorHandler(res, 404, "Elevator not found");
    }

    const project_details = await Project.findById(elevator.project_id)
      .select("_id site_name aggrement_no site_address")
      .lean();

    const responseData = {
      ...elevator,
      project: project_details,
    };
    return ResponseOk(
      res,
      200,
      "Elevator retrieved successfully",
      responseData
    );
  } catch (error) {
    console.error("Error retrieving elevator:", error);
    return ErrorHandler(res, 500, "Failed to retrieve elevator", error);
  }
};

const DeleteElevator = async (req, res) => {
  try {
    const elevatorId = req.query.id;

    const elevatorToDelete = await Elevators.findById(elevatorId);

    if (!elevatorToDelete) {
      return ErrorHandler(res, 404, "Elevator not found");
    }

    const projectData = await Project.findById(
      elevatorToDelete.project_id
    ).select("site_name");
    const site_name = projectData ? projectData.site_name : "Unknown Project";

    const deletedElevator = await Elevators.findByIdAndDelete(elevatorId);

    const user_details = await Users.findById(req.auth.id);
    const projectDetails = await Project.findOne({
      _id: elevatorToDelete.project_id,
    }).select("site_name");
    await ActivityLog.create({
      user_id: req.auth?.id || null,
      user_name: user_details.name,
      action: "DELETE_ELEVATOR",
      type: "Delete",
      description: `${user_details.name} has deleted an elevator named "${elevatorToDelete.elevator_name}" of project "${projectDetails.site_name}".`,
      title: "Elevator Deleted",
      project_id: elevatorToDelete.project_id,
    });

    return ResponseOk(
      res,
      200,
      "Elevator deleted successfully",
      deletedElevator
    );
  } catch (error) {
    console.error("Error deleting elevator:", error);
    return ErrorHandler(res, 500, "Failed to delete elevator", error);
  }
};

const GetElevatorByProjectId = async (req, res) => {
  try {
    const projectId = req.query.project_id;
    const elevator = await Elevators.find({ project_id: projectId })
      .select(
        "_id project_id elevator_name type_of_elevator operation_type passenger_capacity no_of_floors stops speed seal_size rated_load cabin_height opening_center_telescope_no handrail_box rfid tft_display"
      )
      .sort({ createdAt: -1 });
    if (!elevator) {
      return ErrorHandler(res, 404, "Elevator not found");
    }

    return ResponseOk(res, 200, "Elevator retrieved successfully", elevator);
  } catch (error) {
    console.error("Error retrieving elevator:", error);
    return ErrorHandler(res, 500, "Failed to retrieve elevator", error);
  }
};

const GetElevatorAll = async (req, res) => {
  try {
    const elevator = await Elevators.find();
    if (!elevator) {
      return ErrorHandler(res, 404, "Elevator not found");
    }

    return ResponseOk(res, 200, "Elevator retrieved successfully", elevator);
  } catch (error) {
    console.error("Error retrieving elevator:", error);
    return ErrorHandler(res, 500, "Failed to retrieve elevator", error);
  }
};

const CopyElevator = async (req, res) => {
  try {
    const { id } = req.query;

    const existingElevator = await Elevators.findById(id);
    if (!existingElevator) {
      return ErrorHandler(res, 404, "Elevator not found");
    }

    const elevatorData = existingElevator.toObject();
    delete elevatorData._id;
    delete elevatorData.createdAt;
    delete elevatorData.updatedAt;

    const baseName = existingElevator.elevator_name;

    const similarElevators = await Elevators.find({
      project_id: existingElevator.project_id,
      elevator_name: { $regex: `^${baseName}( Copy-\\d+)?$`, $options: "i" },
    });

    let maxCopyNumber = 0;
    similarElevators.forEach((e) => {
      const m = e.elevator_name.match(/ Copy-(\d+)$/);
      if (m) {
        const num = parseInt(m[1]);
        if (num > maxCopyNumber) maxCopyNumber = num;
      }
    });

    const newCopyNumber = maxCopyNumber + 1;
    const newName = `${baseName} Copy-${String(newCopyNumber).padStart(
      2,
      "0"
    )}`;
    elevatorData.elevator_name = newName;

    const newElevator = new Elevators(elevatorData);
    const savedElevator = await newElevator.save();

    const user_details = await Users.findById(req.auth.id);
    const projectDetails = await Project.findById(
      savedElevator.project_id
    ).select("site_name");

    await ActivityLog.create({
      user_id: req.auth?.id || null,
      user_name: user_details.name,
      action: "COPY_ELEVATOR",
      type: "Create",
      description: `${user_details.name} copied elevator "${existingElevator.elevator_name}" to a new elevator "${savedElevator.elevator_name}" in project "${projectDetails.site_name}".`,
      title: "Elevator Copied",
      project_id: savedElevator.project_id,
    });

    return ResponseOk(res, 201, "Elevator copied successfully", savedElevator);
  } catch (error) {
    console.error("Error copying elevator:", error);
    return ErrorHandler(res, 500, "Failed to copy elevator", error);
  }
};

module.exports = {
  CreateElevator,
  UpdateElevator,
  GetElevatorById,
  DeleteElevator,
  GetElevatorByProjectId,
  GetElevatorAll,
  CopyElevator,
};