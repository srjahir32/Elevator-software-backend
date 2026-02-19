const { QCEntry } = require("../../Models/QC.model");
const { ResponseOk, ErrorHandler } = require("../../Utils/ResponseHandler");
const path = require("path");
const fs = require("fs");
const { ActivityLog } = require("../../Models/Activitylog.model");
const { Project } = require("../../Models/Project.model");
const { Users } = require("../../Models/User.model");

const CreateQCEntry = async (req, res) => {
  try {
    const {
      areaName,
      qc_name,
      date,
      siteName,
      jobNumber,
      wingOrLiftNo,
      type,
      sideSupervisor,
      wiremanName,
      project_id,
      inspection_data,
      notes
    } = req.body;

    if (!areaName || !date || !siteName || !jobNumber || !project_id) {
      return ErrorHandler(res, 400, "Required fields missing: areaName, date, siteName, jobNumber, project_id");
    }

    const uploadedFiles = req.files || [];

    const files = uploadedFiles.map(file => ({
      fileType: file.mimetype.startsWith('video') ? 'video' : 'image',
      fileUrl: `/public/uploads/${file.mimetype.startsWith('video') ? 'videos' : 'images'}/${file.filename}`
    }));


    const newQCEntry = await QCEntry.create({
      areaName,
      qc_name,
      date,
      siteName,
      jobNumber,
      wingOrLiftNo,
      type,
      sideSupervisor,
      wiremanName,
      project_id,
      files,
      inspection_data,
      notes
    });

    const user_details = await Users.findById(req.auth.id);
    const projectDetails = await Project.findOne({ _id: newQCEntry.project_id }).select('site_name');
    await ActivityLog.create({
      user_id: req.auth?.id || null,
      user_name: user_details.name,
      action: 'ADD_ELECTRICAL_QC',
      type: 'Create',
      description: `${user_details.name} has added electrical qc named ${qc_name} inside project ${projectDetails.site_name}.`,
      title: 'Create Electrical QC',
      project_id: newQCEntry.project_id,
    });

    return ResponseOk(res, 201, "QC Entry created successfully", newQCEntry);

  } catch (error) {
    console.error("Error creating QC Entry:", error);
    return ErrorHandler(res, 500, "Failed to create QC Entry", error.message || error);
  }
};

const UpdateQCEntry = async (req, res) => {
  try {
    const { id } = req.query;

    if (!id) {
      return ErrorHandler(res, 400, "Missing required query parameter: id");
    }

    const {
      areaName,
      qc_name,
      date,
      siteName,
      jobNumber,
      wingOrLiftNo,
      type,
      sideSupervisor,
      wiremanName,
      project_id,
      inspection_data,
      deletedImg,
      notes
    } = req.body;

    if (!project_id) {
      return ErrorHandler(res, 400, "Missing required field: project_id");
    }

    const updateFields = {};
    if (areaName !== undefined) updateFields.areaName = areaName;
    if (qc_name !== undefined) updateFields.qc_name = qc_name;
    if (date !== undefined) updateFields.date = date;
    if (siteName !== undefined) updateFields.siteName = siteName;
    if (jobNumber !== undefined) updateFields.jobNumber = jobNumber;
    if (wingOrLiftNo !== undefined) updateFields.wingOrLiftNo = wingOrLiftNo;
    if (type !== undefined) updateFields.type = type;
    if (sideSupervisor !== undefined) updateFields.sideSupervisor = sideSupervisor;
    if (wiremanName !== undefined) updateFields.wiremanName = wiremanName;
    if (notes !== undefined) updateFields.notes = notes;

    if (inspection_data !== undefined) {
      const cleanedInspectionData = Array.isArray(inspection_data)
        ? inspection_data.map(section => ({
          ...section,
          data: Array.isArray(section.data)
            ? section.data.map(item => ({
              point: item.point?.trim(),
              action: item.action?.trim() || "N/A",
              details: item.details?.trim() || "N/A"
            }))
            : []
        }))
        : [];
      updateFields.inspection_data = cleanedInspectionData;
    }

    const uploadedFiles = req.files || [];
    const newFiles = uploadedFiles.map(file => ({
      fileType: file.mimetype.startsWith("video") ? "video" : "image",
      fileUrl: `/public/uploads/${file.mimetype.startsWith("video") ? "videos" : "images"}/${file.filename}`,
    }));

    const currentEntry = await QCEntry.findById(id);
    if (!currentEntry) {
      return ErrorHandler(res, 404, "QC Entry not found");
    }



    let updatedFiles = currentEntry.files || [];
    let UpdateddeletedImgIds = JSON.parse(deletedImg || "[]");

    if (UpdateddeletedImgIds.length > 0) {
      const deletedSet = new Set(UpdateddeletedImgIds);

      const filesToDelete = updatedFiles.filter(file => deletedSet.has(file._id?.toString()));

      for (const file of filesToDelete) {
        const filePath = path.resolve(file.fileUrl);
        fs.unlink(filePath, err => {
          if (err) {
            console.warn(`Failed to delete file: ${filePath}`, err.message);
          }
        });
      }

      updatedFiles = updatedFiles.filter(file => !deletedSet.has(file._id?.toString()));
    }

    if (newFiles.length > 0) {
      updatedFiles.push(...newFiles);
    }

    updateFields.files = updatedFiles;


    const updatedQCEntry = await QCEntry.findByIdAndUpdate(
      id,
      { $set: updateFields },
      { new: true }
    );

    const user_details = await Users.findById(req.auth.id);
    const projectDetails = await Project.findOne({ _id: updatedQCEntry.project_id }).select('site_name');
    await ActivityLog.create({
      user_id: req.auth?.id || null,
      user_name: user_details.name,
      action: 'UPDATE_ELECTRICAL_QC',
      type: 'Update',
      description: `${user_details.name} has update electrical qc named ${updatedQCEntry.qc_name} inside project ${projectDetails.site_name}.`,
      title: 'Update Electrical QC',
      project_id: updatedQCEntry.project_id,
    });

    return ResponseOk(res, 200, "QC Entry updated successfully", {
      entry: updatedQCEntry,
    });

  } catch (error) {
    console.error("Error updating QC Entry:", error);
    return ErrorHandler(res, 500, "Server error while updating QC Entry", error.message || error);
  }
};

const GetQCEntries = async (req, res) => {
  try {

    const entries = await QCEntry.find({ project_id: req.query.project_id }).sort({ createdAt: -1 });


    return ResponseOk(res, 200, 'QC Entries with images retrieved successfully', entries);
  } catch (error) {
    console.error("Error retrieving QC Entries:", error);
    return ErrorHandler(res, 500, 'Failed to retrieve QC Entries', error.message || error);
  }
};

const GetQCEntriesById = async (req, res) => {
  try {
    const { id } = req.query;
    const entries = await QCEntry.findById(id).lean()
    if (!entries) {
      return ErrorHandler(res, 404, "QC Entry not found");
    }


      const project_details = await Project.findById(entries.project_id)
              .select('_id site_name aggrement_no site_address')
              .lean();
        
              
    const updatedData = {
     ...entries,
      project_details:project_details
    }

    return ResponseOk(res, 200, 'QC Entries with images retrieved successfully', updatedData);
  } catch (error) {
    console.error("Error retrieving QC Entries:", error);
    return ErrorHandler(res, 500, 'Failed to retrieve QC Entries', error.message || error);
  }
};

const DeleteQcEntry = async (req, res) => {
  try {
    const { id } = req.query;

    if (!id) {
      return ErrorHandler(res, 400, "Missing required query parameter: id");
    }

    const deletedEntry = await QCEntry.findByIdAndDelete(id);

    if (!deletedEntry) {
      return ErrorHandler(res, 404, "QC Entry not found");
    }

    const user_details = await Users.findById(req.auth.id);
    const projectDetails = await Project.findOne({ _id: deletedEntry.project_id }).select('site_name');
    await ActivityLog.create({
      user_id: req.auth?.id || null,
      user_name: user_details.name,
      action: 'DELETE_ELECTRICAL_QC',
      type: 'Delete',
      description: `${user_details.name} has deleted electrical qc named ${deletedEntry.qc_name} inside project ${projectDetails.site_name}.`,
      title: 'Delete Electrical QC',
      project_id: deletedEntry.project_id,
    });
    return ResponseOk(res, 200, "QC Entry deleted successfully");
  } catch (error) {
    console.error("Error deleting QC Entry:", error);
    return ErrorHandler(res, 500, "Server error while deleting QC Entry");
  }
};

const GetQCEntriesOverview = async (req, res) => {
  try {

    const entries = await QCEntry.find({ project_id: req.query.project_id })
      .select('_id qc_name date siteName  sideSupervisor wiremanName wingOrLiftNo notes createdAt')
      .sort({ createdAt: -1 });
    return ResponseOk(res, 200, "QC Entries overview retrieved successfully", entries);
  } catch (error) {
    console.error("Error retrieving QC Entries overview:", error);
    return ErrorHandler(res, 500, "Failed to retrieve QC Entries overview", error);

  }
}

const CopyQCEntry = async (req, res) => {
  try {
    const { id } = req.query;

    const existingQC = await QCEntry.findById(id);
    if (!existingQC) {
      return ErrorHandler(res, 404, "QC Entry not found");
    }

    const qcData = existingQC.toObject();
    delete qcData._id;
    delete qcData.createdAt;
    delete qcData.updatedAt;

    const baseName = existingQC.qc_name;

    const similarEntries = await QCEntry.find({
      project_id: existingQC.project_id,
      qc_name: { $regex: `^${baseName}( Copy-\\d+)?$`, $options: 'i' }
    });

    let maxCopyNumber = 0;
    similarEntries.forEach(entry => {
      const match = entry.qc_name.match(/ Copy-(\d+)$/i);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxCopyNumber) maxCopyNumber = num;
      }
    });

    const newCopyNumber = maxCopyNumber + 1;
    const newName = `${baseName} Copy-${String(newCopyNumber).padStart(2, '0')}`;
    qcData.qc_name = newName;

    const newQC = await QCEntry.create(qcData);

    const user_details = await Users.findById(req.auth.id);
    const projectDetails = await Project.findById(newQC.project_id).select('site_name');

    await ActivityLog.create({
      user_id: req.auth?.id || null,
      user_name: user_details.name,
      action: 'COPY_ELECTRICAL_QC',
      type: 'Create',
      description: `${user_details.name} copied electrical QC "${existingQC.qc_name}" to a new entry "${newQC.qc_name}" in project "${projectDetails.site_name}".`,
      title: 'Electrical QC Copied',
      project_id: newQC.project_id,
    });

    return ResponseOk(res, 201, "QC Entry copied successfully", newQC);

  } catch (error) {
    console.error("[CopyQCEntry]", error);
    return ErrorHandler(res, 500, "Failed to copy QC Entry", error.message || error);
  }
};


module.exports = {
  CreateQCEntry,
  GetQCEntries,
  GetQCEntriesById,
  GetQCEntriesOverview,
  UpdateQCEntry,
  DeleteQcEntry,
  CopyQCEntry
};
