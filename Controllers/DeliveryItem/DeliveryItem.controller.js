const express = require('express');
const router = express.Router();
const { DeliveryListForm, DeliveryListSubForm } = require('../../Models/DeliveryItem.model');
const { ResponseOk, ErrorHandler } = require('../../Utils/ResponseHandler');
const { ActivityLog } = require('../../Models/Activitylog.model');
const { Project } = require('../../Models/Project.model');
const { Users } = require('../../Models/User.model');


const CreateDeliveryForm = async (req, res) => {
  try {
    const {
      form_name,
      date,
      project_id,
      project_name,
      erector_name,
      panel_name,
      lop_cop,
      floor_count,
      wireman_date,
      sub_forms = []
    } = req.body;

    const newDeliveryList = new DeliveryListForm({
      project_id,
      project_name,
      erector_name,
      panel_name,
      lop_cop,
      floor_count,
      form_name,
      wireman_date,
      date,
    });
    await newDeliveryList.save();

    const uploadedFiles = req.files || [];
    const fileMap = {};

    uploadedFiles.forEach((file) => {
      const match = file.fieldname.match(/^sub_forms\[(\d+)]\[files]\[(\d+)]$/);
      if (match) {
        const formIndex = parseInt(match[1]);
        fileMap[formIndex] = fileMap[formIndex] || [];
        const fileType = file.mimetype.startsWith("video") ? "video" : "image";
        const folder = fileType === "video" ? "video" : "images";
        const fileUrl = `/public/uploads/${folder}/${file.filename}`;
        fileMap[formIndex].push({ fileType, fileUrl });
      }
    });

    const savedSubForms = await Promise.all(
      sub_forms.map(async (form, index) => {
        if (!form.form_type) {
          return null;
        }

        const newSubForm = new DeliveryListSubForm({
          type: form.form_type,
          parent_form_id: newDeliveryList._id,
          metadata: {
            items: form.form_items || []
          },
          files: fileMap[index] || []
        });

        return await newSubForm.save();
      })
    );
    const user_details = await Users.findById(req.auth.id);
    const projectDetails = await Project.findOne({ _id: newDeliveryList.project_id }).select('site_name');
    await ActivityLog.create({
      user_id: req.auth?.id || null,
      user_name: user_details.name,
      action: 'CREATE_DELIVERY_FORM',
      type: 'Create',
      description: `${user_details.name} has added delivery list form inside project ${projectDetails.site_name}.`,
      title: 'Create Delivery Form',
      project_id: newDeliveryList.project_id,
    });

    return ResponseOk(res, 201, "Delivery List Form and sub-forms created successfully", {
      deliveryForm: newDeliveryList,
      subForms: savedSubForms.filter(Boolean)
    });

  } catch (error) {
    console.error("Error creating delivery list with sub-forms:", error);
    return ErrorHandler(res, 500, "Failed to create delivery list with sub-forms", error);
  }
};

const GetAllDeliveryForms = async (req, res) => {
  try {
    const forms = await DeliveryListForm.find().sort({ createdAt: -1 });
    return ResponseOk(res, 200, "All delivery list forms fetched", forms);
  } catch (error) {
    return ErrorHandler(res, 500, "Failed to fetch delivery list forms", error);
  }
};

const GetDeliveryFormById = async (req, res) => {
  try {
    const { id } = req.query;
    const form = await DeliveryListForm.findById(id).lean();
    if (!form) return ErrorHandler(res, 404, "Form not found");

    const subForms = await DeliveryListSubForm.find({ parent_form_id: id });

      const project_details = await Project.findById(form.project_id)
              .select('_id site_name aggrement_no site_address')
              .lean();
        


    return ResponseOk(res, 200, "Form and sub-forms fetched", { form, subForms,project_details });
  } catch (error) {
    return ErrorHandler(res, 500, "Failed to fetch form", error);
  }
};

const GetDeliveryFormsByProjectId = async (req, res) => {
  try {
    const { project_id } = req.query;

    const forms = await DeliveryListForm.find({ project_id }).sort({ createdAt: -1 });

    const formsWithSubForms = await Promise.all(
      forms.map(async (form) => {
        const subForms = await DeliveryListSubForm.find({ parent_form_id: form._id });
        return {
          ...form.toObject(),
          sub_forms: subForms
        };
      })
    );

    return ResponseOk(res, 200, "Forms with sub-forms fetched by project ID", formsWithSubForms);
  } catch (error) {
    return ErrorHandler(res, 500, "Failed to fetch forms by project", error);
  }
};

const UpdateDeliveryForm = async (req, res) => {
  try {
    const { id } = req.query;
    const {
      project_id,
      form_name,
      date,
      project_name,
      erector_name,
      panel_name,
      lop_cop,
      floor_count,
      wireman_date,
      sub_forms = [],
      deletedImgIds = []
    } = req.body;

    const updatedForm = await DeliveryListForm.findByIdAndUpdate(
      id,
      {
        project_id,
        project_name,
        erector_name,
        panel_name,
        lop_cop,
        floor_count,
        form_name,
        date,
        wireman_date
      },
      { new: true }
    );

    if (!updatedForm) return ErrorHandler(res, 404, "Form not found");



    if (deletedImgIds.length > 0) {

      let UpdateddeletedImgIds = JSON.parse(deletedImgIds);

      const result = await DeliveryListSubForm.updateMany(
        { parent_form_id: id },
        { $pull: { files: { _id: { $in: UpdateddeletedImgIds } } } }
      );

    }

    const uploadedFiles = req.files || [];
    const fileMap = {};
    uploadedFiles.forEach((file) => {
      const match = file.fieldname.match(/^sub_forms\[(\d+)]\[files]\[(\d+)]$/);
      if (match) {
        const formIndex = parseInt(match[1]);
        fileMap[formIndex] = fileMap[formIndex] || [];
        const fileType = file.mimetype.startsWith("video") ? "video" : "image";
        const folder = fileType === "video" ? "video" : "images";
        const fileUrl = `/public/uploads/${folder}/${file.filename}`;
        fileMap[formIndex].push({ fileType, fileUrl });
      }
    });

    const savedSubForms = await Promise.all(
      sub_forms.map(async (form, index) => {
        if (!form.form_type) return null;

        const files = fileMap[index] || [];
        if (form._id) {
          return await DeliveryListSubForm.findByIdAndUpdate(
            form._id,
            {
              $set: {
                type: form.form_type,
                metadata: {
                  items: form.form_items || []
                }
              },
              $push: {
                files: { $each: files }
              }
            },
            { new: true }
          );

        } else {
          const newSubForm = new DeliveryListSubForm({
            type: form.form_type,
            parent_form_id: id,
            metadata: {
              items: form.form_items || []
            },
            files
          });

          return await newSubForm.save();
        }
      })
    );

    const user_details = await Users.findById(req.auth.id);
    const projectDetails = await Project.findOne({ _id: updatedForm.project_id }).select('site_name');
    await ActivityLog.create({
      user_id: req.auth?.id || null,
      user_name: user_details.name,
      action: 'UPDATE_DELIVERY_FORM',
      type: 'Update',
      description: `${user_details.name} has updated delivery list form inside project ${projectDetails.site_name}.`,
      title: 'Update Delivery Form',
      project_id: updatedForm.project_id,
    });
    return ResponseOk(res, 200, "Delivery form updated", {
      form: updatedForm,
      subForms: savedSubForms.filter(Boolean)
    });

  } catch (error) {
    console.log('error', error);
    return ErrorHandler(res, 500, "Failed to update delivery form", error);
  }
};

const DeleteDeliveryForm = async (req, res) => {
  try {
    const { id } = req.query;

    const form = await DeliveryListForm.findByIdAndDelete(id);
    if (!form) return ErrorHandler(res, 404, "Form not found");

    await DeliveryListSubForm.deleteMany({ parent_form_id: id });
    const user_details = await Users.findById(req.auth.id);
    const projectDetails = await Project.findOne({ _id: form.project_id }).select('site_name');
    await ActivityLog.create({
      user_id: req.auth?.id || null,
      user_name: user_details.name,
      action: 'DELETE_DELIVERY_FORM',
      type: 'Delete',
      description: `${user_details.name} has deleted delivery list form inside project ${projectDetails.site_name}.`,
      title: 'Delete Delivery Form',
      project_id: form.project_id,
    });
    return ResponseOk(res, 200, "Form and sub-forms deleted successfully");
  } catch (error) {
    return ErrorHandler(res, 500, "Failed to delete form", error);
  }
};

const DeliveryFormOverview = async (req, res) => {
  try {
    const project_id = req.query.project_id;

    const ProjectDetails = await Project.findById(project_id).select('site_name');

    const forms = await DeliveryListForm.find({ project_id }).select('_id form_name date') .sort({ createdAt: -1 });

    return ResponseOk(res, 200, "All delivery list forms fetched", {  forms, site_name: ProjectDetails?.site_name || '' });

  } catch (error) {
    return ErrorHandler(res, 500, "Failed to fetch delivery form overview", error);

  }
}

const CopyDeliveryForm = async (req, res) => {
  try {
    const { id } = req.query;

    const existingForm = await DeliveryListForm.findById(id);
    if (!existingForm) {
      return ErrorHandler(res, 404, "Delivery form not found");
    }

    const existingSubForms = await DeliveryListSubForm.find({ parent_form_id: id });

    const formData = existingForm.toObject();
    delete formData._id;
    delete formData.createdAt;
    delete formData.updatedAt;

    const baseName = existingForm.form_name;

    const similarForms = await DeliveryListForm.find({
      project_id: existingForm.project_id,
      form_name: { $regex: `^${baseName}( Copy-\\d+)?$`, $options: 'i' }
    });

    let maxCopyNumber = 0;
    similarForms.forEach(f => {
      const m = f.form_name.match(/ Copy-(\d+)$/i);
      if (m) {
        const num = parseInt(m[1]);
        if (num > maxCopyNumber) maxCopyNumber = num;
      }
    });

    const newCopyNumber = maxCopyNumber + 1;
    const newName = `${baseName} Copy-${String(newCopyNumber).padStart(2, '0')}`;
    formData.form_name = newName;

    const newForm = await DeliveryListForm.create(formData);
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
      newSubForms = await DeliveryListSubForm.insertMany(subFormData);
    }

    const user_details = await Users.findById(req.auth.id);
    const projectDetails = await Project.findById(newForm.project_id).select('site_name');

    await ActivityLog.create({
      user_id: req.auth?.id || null,
      user_name: user_details.name,
      action: 'COPY_DELIVERY_FORM',
      type: 'Create',
      description: `${user_details.name} copied delivery form "${existingForm.form_name}" to a new form "${newForm.form_name}" in project "${projectDetails.site_name}".`,
      title: 'Delivery Form Copied',
      project_id: newForm.project_id,
    });

    return ResponseOk(res, 201, "Delivery form copied successfully", {
      deliveryForm: newForm,
      subForms: newSubForms
    });

  } catch (error) {
    console.error("[CopyDeliveryForm]", error);
    return ErrorHandler(res, 500, "Failed to copy delivery form", error);
  }
};


module.exports = {
  CreateDeliveryForm,
  DeleteDeliveryForm,
  UpdateDeliveryForm,
  GetAllDeliveryForms,
  GetDeliveryFormById,
  GetDeliveryFormsByProjectId,
  DeliveryFormOverview,
  CopyDeliveryForm
}