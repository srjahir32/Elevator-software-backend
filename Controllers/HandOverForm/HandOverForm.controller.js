const { HandOverForm, ComplaintForm } = require('../../Models/HandOverForm.model');
const { Image } = require('../../Models/Images.model');
const { ResponseOk, ErrorHandler } = require('../../Utils/ResponseHandler');
const path = require('path');
const fs = require("fs");
const { ActivityLog } = require('../../Models/Activitylog.model');
const { Project } = require('../../Models/Project.model');
const { Users } = require('../../Models/User.model');

const CreateHandOverForm = async (req, res) => {
  try {
    const {
      name,
      siteSupervisor,
      date,
      jobNumber,
      aggrement_no,
      sideName,
      wingLiftNumber,
      siteHandler,
      erectorName,
      wireManName,
      project_id,
      complaint_date = [],
      complaint_point = [],
      complaint_remark = [],
    } = req.body;

    if (!siteSupervisor || !date || !project_id) {
      return ErrorHandler(res, 400, "Required fields missing: siteSupervisor, date, jobNumber, project_id");
    }

    const uploadedFiles = req.files || [];

    const files = uploadedFiles.map(file => ({
      fileType: file.mimetype.startsWith('video') ? 'video' : 'image',
      fileUrl: `/public/uploads/${file.mimetype.startsWith('video') ? 'videos' : 'images'}/${file.filename}`
    }));

    const newForm = await HandOverForm.create({
      siteSupervisor,
      date,
      jobNumber,
      aggrement_no,
      sideName,
      wingLiftNumber,
      siteHandler,
      erectorName,
      wireManName,
      project_id,
      files,
      name
    });

    const complaints = [];

    for (let i = 0; i < complaint_date.length; i++) {
      if (complaint_point[i]) {
        complaints.push({
          hand_over_form_id: newForm._id,
          date: complaint_date[i],
          complaint_point: complaint_point[i],
          remark: complaint_remark[i] || "",
        });
      }
    }

    if (complaints.length > 0) {
      await ComplaintForm.insertMany(complaints);
    }
    const user_details = await Users.findById(req.auth.id);
    const projectDetails = await Project.findOne({ _id: newForm.project_id }).select('site_name');
    await ActivityLog.create({
      user_id: req.auth?.id || null,
      user_name: user_details.name,
      action: 'ADD_HANDOVER_FORM',
      type: 'Create',
      description: `${user_details.name} has added handover form inside project ${projectDetails.site_name}.`,
      title: 'Add HandOver Form',
      project_id: newForm.project_id,
    });

    return ResponseOk(res, 201, "HandOver form created successfully", {
      form: newForm,
    });

  } catch (error) {
    console.error("error", error);
    return ErrorHandler(res, 500, "Server error while creating HandOver form");
  }
};

const UpdateHandOverForm = async (req, res) => {
  try {
    const { id } = req.query;

    if (!id) {
      return ErrorHandler(res, 400, "Missing query parameter: id");
    }

    const existingForm = await HandOverForm.findById(id);
    if (!existingForm) {
      return ErrorHandler(res, 404, "HandOver form not found");
    }

    const {
      name,
      siteSupervisor,
      date,
      jobNumber,
      sideName,
      wingLiftNumber,
      siteHandler,
      erectorName,
      wireManName,
      aggrement_no,
      project_id,
      deletedFileId,
      complaint_date = [],
      complaint_point = [],
      complaint_remark = [],
    } = req.body;
    if (deletedFileId) {

      const idsToDelete = Array.isArray(deletedFileId)
        ? deletedFileId
        : deletedFileId
          ? [deletedFileId]
          : [];
      const UpdateddeletedImgIds = JSON.parse(idsToDelete);
      if (UpdateddeletedImgIds.length > 0) {
        for (const fileId of UpdateddeletedImgIds) {
          const fileToRemove = existingForm.files.find(
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

        existingForm.files = existingForm.files.filter(
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
      existingForm.files.push(...newFiles);
    }
    if (name !== undefined) existingForm.name = name;
    if (siteSupervisor !== undefined) existingForm.siteSupervisor = siteSupervisor;
    if (date !== undefined) existingForm.date = date;
    if (jobNumber !== undefined) existingForm.jobNumber = jobNumber;
    if (aggrement_no !== undefined) existingForm.aggrement_no = aggrement_no;
    if (sideName !== undefined) existingForm.sideName = sideName;
    if (wingLiftNumber !== undefined) existingForm.wingLiftNumber = wingLiftNumber;
    if (siteHandler !== undefined) existingForm.siteHandler = siteHandler;
    if (erectorName !== undefined) existingForm.erectorName = erectorName;
    if (wireManName !== undefined) existingForm.wireManName = wireManName;
    if (project_id !== undefined) existingForm.project_id = project_id;

    await existingForm.save();


    await ComplaintForm.deleteMany({ hand_over_form_id: existingForm._id });

    const complaints = [];

    for (let i = 0; i < complaint_point.length; i++) {
      if (complaint_point[i]) {
        complaints.push({
          hand_over_form_id: existingForm._id,
          date: complaint_date[i],
          complaint_point: complaint_point[i],
          remark: complaint_remark[i] || "",
        });
      }
    }

    if (complaints.length > 0) {
      await ComplaintForm.insertMany(complaints);
    }
    const user_details = await Users.findById(req.auth.id);
    const projectDetails = await Project.findOne({ _id: existingForm.project_id }).select('site_name');
    await ActivityLog.create({
      user_id: req.auth?.id || null,
      user_name: user_details.name,
      action: 'UPDATE_HANDOVER_FORM',
      type: 'Update',
      description: `${user_details.name} has update handover form inside project ${projectDetails.site_name}.`,
      title: 'Update HandOver Form',
      project_id: existingForm.project_id,
    });

    return ResponseOk(res, 200, "HandOver form updated successfully", existingForm);
  } catch (error) {
    console.error("Error updating HandOver form:", error);
    return ErrorHandler(
      res,
      500,
      "Failed to update HandOver form",
      error.message || error
    );
  }
};

const GetHandOverForm = async (req, res) => {
  try {
    const { project_id } = req.query;
    if (!project_id) {
      return ErrorHandler(res, 400, "Missing required query parameter: project_id");
    }
    const handOverForms = await HandOverForm.find({ project_id }).populate('files').sort({ createdAt: -1 });

    if (!handOverForms || handOverForms.length === 0) {
      return ErrorHandler(res, 200, "No HandOver forms found for this project");
    }
    return ResponseOk(res, 200, "HandOver forms retrieved successfully", {
      forms: handOverForms,
    });
  } catch (error) {
    console.log("error", error);

    return ErrorHandler(res, 500, "Server error while retrieving HandOver forms");
  }
};

const GetHandOverFormById = async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) {
      return ErrorHandler(res, 400, "Missing required query parameter: id");
    }
    const handOverForms = await HandOverForm.findById(id).lean();
    const project_details = await Project.findById(handOverForms.project_id)
              .select('_id site_name aggrement_no site_address')
              .sort({ createdAt: -1 })
              .lean();
        

    const complaintForms = await ComplaintForm.find({ hand_over_form_id: id });
    if (!handOverForms || handOverForms.length === 0) {
      return ErrorHandler(res, 200, "No HandOver forms found for this project");
    }
    return ResponseOk(res, 200, "HandOver forms retrieved successfully", {
      forms: handOverForms,
      complaints: complaintForms,
      project_details:project_details
    });
  } catch (error) {
    console.log("error", error);

    return ErrorHandler(res, 500, "Server error while retrieving HandOver forms");
  }
};

const GetHandOverFormOverview = async (req, res) => {
  try {
    const { project_id } = req.query;
    if (!project_id) {
      return ErrorHandler(res, 400, "Missing required query parameter: project_id");
    }
    const handOverForms = await HandOverForm.find({ project_id }).select('_id siteSupervisor date jobNumber aggrement_no wingLiftNumber siteHandler erectorName');
    if (!handOverForms || handOverForms.length === 0) {
      return ErrorHandler(res, 200, "No HandOver forms found for this project");
    }
    return ResponseOk(res, 200, "HandOver forms retrieved successfully", {
      forms: handOverForms,
    });
  } catch (error) {
    console.log("error", error);

    return ErrorHandler(res, 500, "Server error while retrieving HandOver forms");
  }
};

const DeleteHandOverForm = async (req, res) => {
  try {
    const { id } = req.query;

    if (!id) {
      return ErrorHandler(res, 400, "HandOverForm ID is required");
    }

    const deletedForm = await HandOverForm.findByIdAndDelete(id);

    if (!deletedForm) {
      return ErrorHandler(res, 404, "HandOverForm not found");
    }
    const user_details = await Users.findById(req.auth.id);
    const projectDetails = await Project.findOne({ _id: deletedForm.project_id }).select('site_name');
    await ActivityLog.create({
      user_id: req.auth?.id || null,
      user_name: user_details.name,
      action: 'DELETE_HANDOVER_FORM',
      type: 'Delete',
      description: `${user_details.name} has delete handover form inside project ${projectDetails.site_name}.`,
      title: 'Delete HandOver Form',
      project_id: deletedForm.project_id,
    });


    return ResponseOk(res, 200, "HandOver form deleted successfully");
  } catch (error) {
    console.log("error", error);
    return ErrorHandler(res, 500, "Server error while deleting HandOver form");
  }
}

const CopyHandOverForm = async (req, res) => {
  try {
    const { id } = req.query;

    const existingForm = await HandOverForm.findById(id);
    if (!existingForm) {
      return ErrorHandler(res, 404, "HandOver form not found");
    }

    const existingComplaints = await ComplaintForm.find({ hand_over_form_id: id });

    const formData = existingForm.toObject();
    delete formData._id;
    delete formData.createdAt;
    delete formData.updatedAt;

    const baseName = existingForm.name || existingForm.jobNumber;

    const similarForms = await HandOverForm.find({
      project_id: existingForm.project_id,
      $or: [
        { name: { $regex: `^${baseName}( Copy-\\d+)?$`, $options: 'i' } },
        { jobNumber: { $regex: `^${baseName}( Copy-\\d+)?$`, $options: 'i' } }
      ]
    });

    let maxCopyNumber = 0;
    similarForms.forEach(form => {
      const formName = form.name || form.jobNumber;
      const match = formName.match(/ Copy-(\d+)$/i);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxCopyNumber) maxCopyNumber = num;
      }
    });

    const newCopyNumber = maxCopyNumber + 1;
    const newName = `${baseName} Copy-${String(newCopyNumber).padStart(2, '0')}`;
    if (formData.name) {
      formData.name = newName;
    } else {
      formData.jobNumber = newName;
    }

    const newForm = await HandOverForm.create(formData);
    const newFormId = newForm._id;

    let newComplaints = [];
    if (existingComplaints.length > 0) {
      const complaintData = existingComplaints.map(c => {
        const obj = c.toObject();
        delete obj._id;
        delete obj.createdAt;
        delete obj.updatedAt;
        obj.hand_over_form_id = newFormId;
        return obj;
      });
      newComplaints = await ComplaintForm.insertMany(complaintData);
    }

    const user_details = await Users.findById(req.auth.id);
    const projectDetails = await Project.findById(newForm.project_id).select('site_name');

    await ActivityLog.create({
      user_id: req.auth?.id || null,
      user_name: user_details.name,
      action: 'COPY_HANDOVER_FORM',
      type: 'Create',
      description: `${user_details.name} copied a handover form "${existingForm.name || existingForm.jobNumber}" to "${newName}" in project "${projectDetails.site_name}".`,
      title: 'HandOver Form Copied',
      project_id: newForm.project_id,
    });

    return ResponseOk(res, 201, "HandOver form copied successfully", {
      form: newForm,
      complaints: newComplaints
    });

  } catch (error) {
    console.error("[CopyHandOverForm]", error);
    return ErrorHandler(res, 500, "Failed to copy HandOver form", error.message || error);
  }
};


module.exports = {
  CreateHandOverForm,
  GetHandOverForm,
  UpdateHandOverForm,
  DeleteHandOverForm,
  GetHandOverFormById,
  GetHandOverFormOverview,
  CopyHandOverForm
};
