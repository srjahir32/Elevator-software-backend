const { MeachanicalQc, MeachanicalQcForm } = require("../../Models/QC.model");
const { ResponseOk, ErrorHandler } = require("../../Utils/ResponseHandler");
const path = require("path");
const fs = require("fs");
const mongoose = require('mongoose');
const { ActivityLog } = require("../../Models/Activitylog.model");
const { Project } = require("../../Models/Project.model");
const { Users } = require("../../Models/User.model");


const CreateMechanicalQC = async (req, res) => {
  try {
    const {
      site_name,
      project_id,
      date,
      mobile_number,
      supervisor_name,
      elevator,
      block,
      machine_make,
      machine_hp,
      machine_sr_no,
      drive_make,
      drive_hp,
      drive_sr_no,
      lift_floor,
      lift_capacity,
      lift_type,
      subform = []
    } = req.body;

    const newMechanicalQC = new MeachanicalQc({
      site_name,
      project_id,
      date,
      mobile_number,
      supervisor_name,
      elevator,
      block,
      machine_make,
      machine_hp,
      machine_sr_no,
      drive_make,
      drive_hp,
      drive_sr_no,
      lift_floor,
      lift_capacity,
      lift_type
    });

    await newMechanicalQC.save();
    const uploadedFiles = req.files || [];
    const fileMap = {};

    uploadedFiles.forEach((file) => {
      const match = file.fieldname.match(/^subform\[(\d+)]\[files]$/);
      if (match) {
        const formIndex = parseInt(match[1], 10);
        fileMap[formIndex] = fileMap[formIndex] || [];

        const fileType = file.mimetype.startsWith("video") ? "video" : "image";
        const folder = fileType === "video" ? "video" : "images";
        const fileUrl = `/public/uploads/${folder}/${file.filename}`;

        fileMap[formIndex].push({ fileType, fileUrl });
      }
    });


    const savedSubForms = await Promise.all(
      subform.map(async (form, index) => {
        if (!form.form_type || !form.form_no) {
          return null;
        }
        const newSubForm = new MeachanicalQcForm({
          parent_form_id: newMechanicalQC._id,
          form_type: form.form_type,
          form_no: form.form_no,
          sub_form_no: form.sub_form_no,
          form_data: {
            point_no: form.point_no,
            sub_point_no: form.sub_point_no,
            type: form.form_type,
            data: form.data || []
          },
          files: fileMap[index] || []
        });

        return await newSubForm.save();
      })
    );

    const user_details = await Users.findById(req.auth.id);
    const projectDetails = await Project.findOne({ _id: newMechanicalQC.project_id }).select('site_name');
    await ActivityLog.create({
      user_id: req.auth?.id || null,
      user_name: user_details.name,
      action: 'ADD_MECHANICAL_QC',
      type: 'Create',
      description: `${user_details.name} has added mechanical qc form inside project ${projectDetails.site_name}.`,
      title: 'Add Mechanical QC',
      project_id: newMechanicalQC.project_id,
    });

    return res.status(201).json({
      message: "Mechanical QC created successfully",
      mechanicalForm: newMechanicalQC,
      subForms: savedSubForms.filter(Boolean)
    });

  } catch (error) {
    console.error("Error creating mechanical_qc with sub-forms:", error);
    return res.status(500).json({
      message: "Failed to create mechanical_qc with sub-forms",
      error: error.message
    });
  }
};

const UpdateMechanicalQC = async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) {
      return ErrorHandler(res, 400, "ID is required to update mechanical_qc");
    }
    const {
      site_name,
      project_id,
      date,
      mobile_number,
      supervisor_name,
      elevator,
      block,
      machine_make,
      machine_hp,
      machine_sr_no,
      drive_make,
      drive_hp,
      drive_sr_no,
      lift_floor,
      lift_capacity,
      lift_type,
      subform = [],
      deleteImgIds = []
    } = req.body;

    const mechanicalQC = await MeachanicalQc.findById(id);
    if (!mechanicalQC) {
      return res.status(404).json({ message: "Mechanical QC not found" });
    }

    Object.assign(mechanicalQC, {
      // contract_name,
      site_name,
      project_id,
      date,
      mobile_number,
      supervisor_name,
      elevator,
      block,
      machine_make,
      machine_hp,
      machine_sr_no,
      drive_make,
      drive_hp,
      drive_sr_no,
      lift_floor,
      lift_capacity,
      lift_type
    });

    await mechanicalQC.save();

    const uploadedFiles = req.files || [];
    const fileMap = {};

    uploadedFiles.forEach((file) => {
      const match = file.fieldname.match(/^subform\[(\d+)]\[files]$/);
      if (match) {
        const formIndex = parseInt(match[1], 10);
        fileMap[formIndex] = fileMap[formIndex] || [];

        const fileType = file.mimetype.startsWith("video") ? "video" : "image";
        const folder = fileType === "video" ? "video" : "images";
        const fileUrl = `/public/uploads/${folder}/${file.filename}`;

        fileMap[formIndex].push({ fileType, fileUrl });
      }
    });

    if (deleteImgIds.length > 0) {

      let deleteImgIdss = JSON.parse(deleteImgIds);
      await MeachanicalQcForm.updateMany(
        { parent_form_id: id },
        { $pull: { files: { _id: { $in: deleteImgIdss } } } }
      );
    }

    const savedSubForms = await Promise.all(
      subform.map(async (form, index) => {
        if (!form.form_type || !form.form_no) {
          return null;
        }

        if (form._id) {
          const existingForm = await MeachanicalQcForm.findById(form._id);
          if (existingForm) {
            existingForm.form_type = form.form_type;
            existingForm.form_no = form.form_no;
            existingForm.sub_form_no = form.sub_form_no;
            existingForm.form_data = {
              point_no: form.point_no,
              sub_point_no: form.sub_point_no,
              type: form.form_type,
              data: form.data || []
            };
            if (fileMap[index]) {
              existingForm.files.push(...fileMap[index]);
            }
            return await existingForm.save();
          }
        } else {
          const newSubForm = new MeachanicalQcForm({
            parent_form_id: mechanicalQC._id,
            form_type: form.form_type,
            form_no: form.form_no,
            sub_form_no: form.sub_form_no,
            form_data: {
              point_no: form.point_no,
              sub_point_no: form.sub_point_no,
              type: form.form_type,
              data: form.data || []
            },
            files: fileMap[index] || []
          });
          return await newSubForm.save();
        }
      })
    );

    const user_details = await Users.findById(req.auth.id);
    const projectDetails = await Project.findOne({ _id: mechanicalQC.project_id }).select('site_name');
    await ActivityLog.create({
      user_id: req.auth?.id || null,
      user_name: user_details.name,
      action: 'UPDATE_MECHANICAL_QC',
      type: 'Update',
      description: `${user_details.name} has update mechanical qc form inside project ${projectDetails.site_name}.`,
      title: 'Update Mechanical QC',
      project_id: mechanicalQC.project_id,
    });

    return res.status(200).json({
      message: "Mechanical QC updated successfully",
      mechanicalForm: mechanicalQC,
      subForms: savedSubForms.filter(Boolean)
    });

  } catch (error) {
    console.error("Error updating mechanical_qc:", error);
    return res.status(500).json({
      message: "Failed to update mechanical_qc",
      error: error.message
    });
  }
};

const GetMechanicalQCByID = async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) {
      return ErrorHandler(res, 400, "ID is required to fetch mechanical_qc");
    }
    const mechanical_qc = await MeachanicalQc.aggregate([
      {
        $match: {
          _id: new mongoose.Types.ObjectId(id)
        }
      },
      {
        $lookup: {
          from: "meachanical_qc_forms",
          localField: "_id",
          foreignField: "parent_form_id",
          as: "sub_forms"
        }
      },
    ])
 const mechanical_qcs = mechanical_qc[0]; 

      const project_details = await Project.findById(mechanical_qcs.project_id)
              .select('_id site_name aggrement_no site_address')
              .lean();
        
            const responseData = {
              ...mechanical_qc[0],
              project: project_details
            };


    return ResponseOk(res, 200, "Mechanical QC fetched successfully", responseData);
  } catch (error) {
    console.error("Error fetching mechanical_qc:", error);
    return ErrorHandler(res, 500, "Failed to fetch mechanical_qc", error.message);

  }
}

const GetMechanicalQCAll = async (req, res) => {
  try {
    const mechanical_qc = await MeachanicalQc.find().select("_id site_name project_id date mobile_number supervisor_name elevator block machine_make").sort({ createdAt: -1 });
    return ResponseOk(res, 200, "All Mechanical QCs fetched successfully", mechanical_qc);
  } catch (error) {
    console.error("Error fetching all mechanical_qc:", error);
    return ErrorHandler(res, 500, "Failed to fetch all mechanical_qc", error.message);

  }
}

const GetMechanicalQCOveriview = async (req, res) => {
  try {
    const mechanical_qc = await MeachanicalQc.find().select("_id site_name project_id date mobile_number supervisor_name elevator createdAt").sort({ createdAt: -1 });
    return ResponseOk(res, 200, "All Mechanical QCs fetched successfully", mechanical_qc);
  } catch (error) {
    console.error("Error fetching mechanical_qc overview:", error);
    return ErrorHandler(res, 500, "Failed to fetch mechanical_qc overview", error.message);

  }
}

const DeleteMechanicalQC = async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) {
      return ErrorHandler(res, 400, "ID is required to delete mechanical_qc");
    }
    const deletedEntry = await MeachanicalQc.findByIdAndDelete(id);
    if (!deletedEntry) {
      return ErrorHandler(res, 404, "Mechanical QC not found");
    }
    await MeachanicalQcForm.deleteMany({ parent_form_id: id });


    const user_details = await Users.findById(req.auth.id);
    const projectDetails = await Project.findOne({ _id: deletedEntry.project_id }).select('site_name');
    await ActivityLog.create({
      user_id: req.auth?.id || null,
      user_name: user_details.name,
      action: 'DELETE_MECHANICAL_QC',
      type: 'Delete',
      description: `${user_details.name} has delete mechanical qc form inside project ${projectDetails.site_name}.`,
      title: 'Delete Mechanical QC',
      project_id: deletedEntry.project_id,
    });
    return ResponseOk(res, 200, "Mechanical QC deleted successfully", deletedEntry);
  } catch (error) {
    console.error("Error deleting mechanical_qc:", error);
    return ErrorHandler(res, 500, "Failed to delete mechanical_qc", error.message || error);
  }
}

const CopyMechanicalQC = async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) {
      return ErrorHandler(res, 400, "ID is required to copy mechanical_qc");
    }

    const existingForm = await MeachanicalQc.findById(id);
    if (!existingForm) {
      return ErrorHandler(res, 404, "Mechanical QC form not found");
    }

    const existingSubForms = await MeachanicalQcForm.find({ parent_form_id: id });

    const formData = existingForm.toObject();
    delete formData._id;
    delete formData.createdAt;
    delete formData.updatedAt;

    const baseName = existingForm.form_name;

    const similarForms = await MeachanicalQc.find({
      project_id: existingForm.project_id,
      form_name: { $regex: `^${baseName}( Copy-\\d+)?$`, $options: 'i' }
    });

    let maxCopyNumber = 0;
    similarForms.forEach(f => {
      const match = f.form_name.match(/ Copy-(\d+)$/i);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxCopyNumber) maxCopyNumber = num;
      }
    });

    const newCopyNumber = maxCopyNumber + 1;
    const newName = `${baseName} Copy-${String(newCopyNumber).padStart(2, '0')}`;
    formData.form_name = newName;

    const newForm = await MeachanicalQc.create(formData);
    const newFormId = newForm._id;

    let newSubForms = [];
    if (existingSubForms.length > 0) {
      const subFormData = existingSubForms.map(sf => {
        const obj = sf.toObject();
        delete obj._id;
        delete obj.createdAt;
        delete obj.updatedAt;
        obj.parent_form_id = newFormId;
        return obj;
      });
      newSubForms = await MeachanicalQcForm.insertMany(subFormData);
    }

    const user_details = await Users.findById(req.auth.id);
    const projectDetails = await Project.findById(newForm.project_id).select("site_name");

    await ActivityLog.create({
      user_id: req.auth?.id || null,
      user_name: user_details?.name || "Unknown User",
      action: "COPY_MECHANICAL_QC",
      type: "Create",
      description: `${user_details.name} copied a mechanical QC form "${existingForm.form_name}" to "${newForm.form_name}" in project ${projectDetails.site_name}.`,
      title: "Mechanical QC Form Copied",
      project_id: newForm.project_id,
    });

    return ResponseOk(res, 201, "Mechanical QC form copied successfully", {
      form: newForm,
      subForms: newSubForms,
    });

  } catch (error) {
    console.error("Error copying mechanical_qc:", error);
    return ErrorHandler(res, 500, "Failed to copy mechanical_qc", error.message || error);
  }
};


module.exports = {
  CreateMechanicalQC,
  UpdateMechanicalQC,
  GetMechanicalQCByID,
  GetMechanicalQCAll,
  GetMechanicalQCOveriview,
  DeleteMechanicalQC,
  CopyMechanicalQC
}