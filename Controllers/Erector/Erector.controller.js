const { Erector } = require('../../Models/Erector.model');
const { MiniErector } = require('../../Models/Erector.model');
const { InstallationTerms, PaymentRecord } = require('../../Models/Erector.model');
const { ResponseOk, ErrorHandler } = require('../../Utils/ResponseHandler');
const { ActivityLog } = require('../../Models/Activitylog.model');
const { Project } = require('../../Models/Project.model');
const { Users } = require('../../Models/User.model');
const { NotificationSchema } = require('../../Models/Notification.model');
const { User_Associate_With_Role } = require('../../Models/User.model')
const { Roles } = require('../../Models/User.model');

const CreateErector = async (req, res) => {
  try {
    const { erectorData, installation_data, payment_record } = req.body;

    if (!erectorData || !erectorData.project_id ) {
      return ErrorHandler(res, 400, "Missing required fields");
    }

   
    const newErector = new Erector(erectorData);
    const savedErector = await newErector.save();
    const erector_id = savedErector._id;

    let savedInstallationTerms = null;
    if (installation_data) {
      const newInstallation = new InstallationTerms({ ...installation_data, erector_id });
      savedInstallationTerms = await newInstallation.save();
    }

    let savedPaymentRecords = [];
    if (Array.isArray(payment_record) && payment_record.length > 0) {
      const paymentPayloads = payment_record.map(record => ({ ...record, erector_id }));
      savedPaymentRecords = await PaymentRecord.insertMany(paymentPayloads);
    }

    const user_details = await Users.findById(req.auth.id);
    const projectDetails = await Project.findById(erectorData.project_id).select('site_name');

    await ActivityLog.create({
      user_id: req.auth?.id || null,
      user_name: user_details?.name || 'Unknown User',
      action: 'CREATE_ERECTOR',
      type: 'Create',
      description: `${user_details?.name || 'Unknown'} has created erector inside project ${projectDetails?.site_name || 'Unknown Project'}.`,
      title: 'Create Erector',
      project_id: erectorData.project_id
    });

    return ResponseOk(res, 201, "Erector created successfully", {
      erector: savedErector,
      installation_terms: savedInstallationTerms,
      payment_records: savedPaymentRecords
    });

  } catch (error) {
    console.error("[CreateErector Error]", error);

    return ErrorHandler(res, 500, "Failed to create erector", error.message);
  }
};

const UpdateErector = async (req, res) => {
  try {
    const { id: erector_id } = req.query;
    const { erectorData, installation_data, payment_record } = req.body;

    if(installation_data.rail_door_frame_is_marked == true ||installation_data.machine_roping_door_is_marked == true || installation_data.cabin_lift_startup_is_marked == true  || installation_data.after_handover_lift_party_is_marked == true ){
    
      const findUserWithAccount = await Roles.findOne({
        name:'Accountant'
        // name:'Manager'
      })
      const findProjectname = await Project.findOne({
        _id:erectorData.project_id
      })

      const FindUserWithUSerId = await User_Associate_With_Role.findOne({
        role_id:findUserWithAccount.id
      })
      if(installation_data.rail_door_frame_is_marked == true){
        await NotificationSchema.create({
             user_id: FindUserWithUSerId.user_id || null,
             mark_as_read:false,
             content: `Rail & Door Frame payment has been marked as completed for project ${findProjectname.site_name}. Please verify and proceed with accounting records.`,
             action_type: 'Erector Payment Received',
             action_id: FindUserWithUSerId.user_id,
             action_route: `/projects/${erectorData.project_id}/subcontractors/${req.query.id}/edit`,
           });
      }
      if(installation_data.machine_roping_door_is_marked == true){
        await NotificationSchema.create({
          user_id: FindUserWithUSerId.user_id || null,
          mark_as_read:false,
          content: `Machine Roping & Door payment has been marked as completed for project ${findProjectname.site_name}. Please verify and proceed with accounting records.`,
          action_type: 'Erector Payment Received',
          action_id: FindUserWithUSerId.user_id,
          action_route: `/projects/${erectorData.project_id}/subcontractors/${req.query.id}/edit`,
        });
      }
      if(installation_data.cabin_lift_startup_is_marked == true){
        await NotificationSchema.create({
          user_id: FindUserWithUSerId.user_id || null,
          mark_as_read:false,
          content: `Cabin & Lift Startup payment has been marked as completed for project ${findProjectname.site_name}. Please verify and proceed with accounting records.`,
          action_type: 'Erector Payment Received',
          action_id: FindUserWithUSerId.user_id,
          action_route: `/projects/${erectorData.project_id}/subcontractors/${req.query.id}/edit`,
        });
      }
      if(installation_data.after_handover_lift_party_is_marked == true){
        await NotificationSchema.create({
          user_id: FindUserWithUSerId.user_id || null,
          mark_as_read:false,
          content: `After Handover the Lift to Party payment has been marked as completed for project ${findProjectname.site_name}. Please verify and proceed with accounting records.`,
          action_type: 'Erector Payment Received',
          action_id: FindUserWithUSerId.user_id,
          action_route: `/projects/${erectorData.project_id}/subcontractors/${req.query.id}/edit`,
        });
      }

      const findUserAdmin = await User_Associate_With_Role.findOne({
        role_id: 1
      })
      console.log("findUserAdmin",findUserAdmin.user_id)
      console.log("FindUserWithUSerId.user_id",FindUserWithUSerId.user_id)
      console.log("🔌 Connected socket users:", global.user_array);
      const userSocket = global.user_array.find(
        u => u.user_id == FindUserWithUSerId.user_id
      );
      
      const userSocket1 = global.user_array.find(
        u => u.user_id == findUserAdmin.user_id
      );
      console.log("userSocket",userSocket)
      if (userSocket) {
        console.log("hereee in accountant")
        global.io.to(userSocket.socket_id).emit("notification:new", {
          count: 1,
        });
        console.log("Notification sent to Accountant");
      }
      
      console.log("userSocket1",userSocket1)
      if (userSocket1) {
        console.log("hereee in admin")
        global.io.to(userSocket1.socket_id).emit("notification:new", {
          count: 1,
        });
        console.log("Notification sent to Admin");
      }

    }

    const updatedErector = await Erector.findByIdAndUpdate(
      erector_id,
      erectorData,
      { new: true }
    );

    if (!updatedErector) {
      return ErrorHandler(res, 404, "Erector not found");
    }

    let updatedInstallationTerms = null;
    if (installation_data) {
      updatedInstallationTerms = await InstallationTerms.findOneAndUpdate(
        { erector_id },
        { ...installation_data, erector_id },
        { upsert: true, new: true }
      );
    }

    let updatedPaymentRecords = [];
    if (Array.isArray(payment_record)) {
      await PaymentRecord.deleteMany({ erector_id });

      const newPayments = payment_record.map(record => ({
        ...record,
        erector_id,
      }));
      updatedPaymentRecords = await PaymentRecord.insertMany(newPayments);
    }

    const user_details = await Users.findById(req.auth.id);
    const projectDetails = await Project.findOne({ _id: updatedErector.project_id }).select('site_name');
    await ActivityLog.create({
      user_id: req.auth?.id || null,
      user_name: user_details.name,
      action: 'UPDATE_ERECTOR',
      type: 'Update',
      description: `${user_details.name} has update erector inside project ${projectDetails.site_name}.`,
      title: 'Update Erector',
      project_id: updatedErector.project_id,
    });

    return ResponseOk(res, 200, "Erector updated successfully", {
      erector: updatedErector,
      installation_terms: updatedInstallationTerms,
      payment_records: updatedPaymentRecords,
    });
  } catch (error) {
    console.error("[updateErector]", error);
    return ErrorHandler(res, 500, "Failed to update erector", error);
  }
};
const GetAllErectors = async (req, res) => {
  try {
    const erectors = await Erector.find({ project_id: req.query.project_id }).sort({ createdAt: -1 }).lean();

    const allTerms = await InstallationTerms.find().lean();
    const allPayments = await PaymentRecord.find().lean();

    const enrichedErectors = erectors.map((erector) => {
      const terms = allTerms.filter(term => term.erector_id.toString() === erector._id.toString());
      const payments = allPayments.filter(pay => pay.erector_id.toString() === erector._id.toString());

      const totalAmount = terms.reduce((sum, term) => sum + Number(term.total_charges || 0), 0);
      const amountPaid = payments.reduce((sum, pay) => sum + Number(pay.payment_amount || 0), 0);
      const remaining = totalAmount - amountPaid;
      const progress = totalAmount > 0 ? ((amountPaid / totalAmount) * 100).toFixed(2) : 0;
      let erector_status;

      if(remaining == 0){
        erector_status = "Completed"
      }else{
        erector_status = "Pending"
      }

      return {
        ...erector,
        installation_terms: terms,
        payment_records: payments,
        total_amount: totalAmount,
        amount_paid: amountPaid,
        remaining_amount: remaining,
        progress_percentage: parseFloat(progress),
        erector_status
      };
    });

    return ResponseOk(res, 200, 'All erectors with terms, payments, and progress fetched successfully', enrichedErectors);
  } catch (error) {
    console.log("erector",error)
    return ErrorHandler(res, 500, 'Failed to fetch erector data', error);
  }
};

const GetErectorsById = async (req, res) => {
  try {
    const erectors = await Erector.findById(req.query.id);

    const allTerms = await InstallationTerms.find({ erector_id: erectors._id });
    const allPayments = await PaymentRecord.find({ erector_id: erectors._id });
    const project_details = await Project.findById(erectors.project_id)
      .select('_id site_name aggrement_no site_address')
      .lean();

    const amountPaid = allPayments.reduce((sum, payment) => sum + parseFloat(payment.payment_amount || 0), 0);

    const totalCharges = allTerms.length > 0 ? parseFloat(allTerms[0].total_charges || 0) : 0;

    const amountRemaining = totalCharges - amountPaid;

    const progress = totalCharges > 0 ? ((amountPaid / totalCharges) * 100).toFixed(2) : 0;

    const updatedData = {
      erector: erectors,
      installation_terms: allTerms,
      payment_records: allPayments,
      project_details: project_details,
      amount_summary: {
        amount_paid: amountPaid,
        amount_remaining: amountRemaining,
        progress: `${progress}%`
      }
    };

    return ResponseOk(res, 200, 'Erectors with terms and payments fetched successfully', updatedData);
  } catch (error) {
    console.log('error', error);
    return ErrorHandler(res, 500, 'Failed to fetch erector data', error);
  }
};

const GetErectorsOverview = async (req, res) => {
  try {
    const erectors = await Erector.find({ project_id: req.query.project_id })
      .select('_id erector_name date total_lift types_lift location')
      .lean();

    const allTerms = await InstallationTerms.find().lean();
    const allPayments = await PaymentRecord.find().lean();

    const enrichedErectors = erectors.map((erector) => {
      const terms = allTerms.filter(term => term.erector_id.toString() === erector._id.toString());
      const payments = allPayments.filter(pay => pay.erector_id.toString() === erector._id.toString());

      const totalAmount = terms.reduce((sum, term) => sum + Number(term.total_charges || 0), 0);
      const amountPaid = payments.reduce((sum, pay) => sum + Number(pay.payment_amount || 0), 0);
      const remaining = totalAmount - amountPaid;
      const progress = totalAmount > 0 ? ((amountPaid / totalAmount) * 100).toFixed(2) : 0;

      return {
        ...erector,
        total_amount: totalAmount,
        amount_paid: amountPaid,
        remaining_amount: remaining,
        progress_percentage: parseFloat(progress)
      };
    });

    return ResponseOk(res, 200, 'All erectors overview fetched successfully', enrichedErectors);
  } catch (error) {
    return ErrorHandler(res, 500, 'Failed to fetch erector data', error);
  }
};

const DeleteErector = async (req, res) => {
  try {
    const id = req.query.id;
    const deletedErector = await Erector.findByIdAndDelete(id);

    if (!deletedErector) {
      return ErrorHandler(res, 404, 'Erector not found');
    }

    await InstallationTerms.deleteMany({ erector_id: id });
    await PaymentRecord.deleteMany({ erector_id: id });

    const user_details = await Users.findById(req.auth.id);
    const projectDetails = await Project.findOne({ _id: deletedErector.project_id }).select('site_name');
    await ActivityLog.create({
      user_id: req.auth?.id || null,
      user_name: user_details.name,
      action: 'DELETE_ERECTOR',
      type: 'Delete',
      description: `${user_details.name} has delete erector inside project ${projectDetails.site_name}.`,
      title: 'Delete Erector',
      project_id: deletedErector.project_id,
    });

    return ResponseOk(res, 200, 'Erector deleted successfully');
  } catch (error) {
    return ErrorHandler(res, 500, 'Failed to delete erector', error);
  }
};

const CopyErector = async (req, res) => {
  try {
    const { id } = req.query;

    const existingErector = await Erector.findById(id);
    if (!existingErector) {
      return ErrorHandler(res, 404, "Erector not found");
    }

    const existingTerms = await InstallationTerms.findOne({ erector_id: id });
    const existingPayments = await PaymentRecord.find({ erector_id: id });

    const erectorData = existingErector.toObject();
    delete erectorData._id;
    delete erectorData.createdAt;
    delete erectorData.updatedAt;

    const baseName = existingErector.erector_name;

    const similarErectors = await Erector.find({
      project_id: existingErector.project_id,
      erector_name: { $regex: `^${baseName}( Copy-\\d+)?$`, $options: 'i' }
    });

    let maxCopyNumber = 0;
    similarErectors.forEach(e => {
      const m = e.erector_name.match(/ Copy-(\d+)$/i);
      if (m) {
        const num = parseInt(m[1]);
        if (num > maxCopyNumber) maxCopyNumber = num;
      }
    });

    const newCopyNumber = maxCopyNumber + 1;
    const newName = `${baseName} Copy-${String(newCopyNumber).padStart(2, '0')}`;

    erectorData.erector_name = newName; 

    const newErector = await Erector.create(erectorData);
    const newErectorId = newErector._id;

    let newTerms = null;
    if (existingTerms) {
      const termsData = existingTerms.toObject();
      delete termsData._id;
      delete termsData.createdAt;
      delete termsData.updatedAt;
      termsData.erector_id = newErectorId;
      newTerms = await InstallationTerms.create(termsData);
    }

    const user_details = await Users.findById(req.auth.id);
    const projectDetails = await Project.findById(newErector.project_id).select('site_name');

    await ActivityLog.create({
      user_id: req.auth?.id || null,
      user_name: user_details.name,
      action: 'COPY_ERECTOR',
      type: 'Create',
      description: `${user_details.name} copied erector "${existingErector.erector_name}" to "${newErector.erector_name}" in project "${projectDetails.site_name}".`,
      title: 'Erector Copied',
      project_id: newErector.project_id,
    });

    return ResponseOk(res, 201, "Erector copied successfully", {
      erector: newErector,
      installation_terms: newTerms
    });

  } catch (error) {
    console.error("[CopyErector]", error);
    return ErrorHandler(res, 500, "Failed to copy erector", error.message || error);
  }
};

const GetErectorsDropdown = async (req, res) => {
  try {

    const erectors = await Erector.find({ project_id: req.query.project_id }) .select('_id erector_name')

    const updatedData = {
      erector: erectors,
    }

    return ResponseOk(res, 200, 'Erectors dropdown fetched successfully', updatedData);
  } catch (error) {
    console.log('error', error);
    return ErrorHandler(res, 500, 'Failed to fetch erector data', error);
  }
};




const CreateMiniErector = async (req, res) => {
  try {
    const { erector_name, mobile_no, aadhar_no } = req.body;

    if (!erector_name || !mobile_no) {
      return ErrorHandler(res, 400, "Erector name and mobile number are required");
    }

    if (aadhar_no) {
      const existing = await MiniErector.findOne({ aadhar_no });
      if (existing) {
        return ErrorHandler(res, 400, "Duplicate Aadhar number");
      }
    }

    const newErector = await MiniErector.create({
      erector_name,
      mobile_no,
      aadhar_no: aadhar_no || null,
      date: new Date(),
    });


    return ResponseOk(res, 201, "Mini erector created successfully", newErector);

  } catch (error) {
    console.error("[CreateMiniErector]", error);
    return ErrorHandler(res, 500, "Failed to create mini erector", error.message);
  }
};

const UpdateMiniErector = async (req, res) => {
  try {
    const { id } = req.query;
    const { erector_name, mobile_no, aadhar_no } = req.body;

    if (!id) {
      return ErrorHandler(res, 400, "Erector ID is required");
    }

    const existingErector = await MiniErector.findById(id);
    if (!existingErector) {
      return ErrorHandler(res, 404, "Mini erector not found");
    }

    // Aadhar duplicate check (ignore same record)
    if (aadhar_no) {
      const duplicate = await MiniErector.findOne({
        aadhar_no,
        _id: { $ne: id },
      });

      if (duplicate) {
        return ErrorHandler(res, 400, "Duplicate Aadhar number");
      }
    }

    const updatedErector = await MiniErector.findByIdAndUpdate(
      id,
      {
        ...(erector_name && { erector_name }),
        ...(mobile_no && { mobile_no }),
        ...(aadhar_no !== undefined && { aadhar_no }),
      },
      { new: true, runValidators: true }
    );

    return ResponseOk(
      res,
      200,
      "Mini erector updated successfully",
      updatedErector
    );

  } catch (error) {
    console.error("[UpdateMiniErector]", error);
    return ErrorHandler(res, 500, "Failed to update mini erector", error.message);
  }
};


const GetAllMiniErectors = async (req, res) => {
  try {
    const erectors = await MiniErector
      .find()
      .sort({ createdAt: -1 })
      .lean();

    return ResponseOk(
      res,
      200,
      "Mini erectors fetched successfully",
      erectors
    );

  } catch (error) {
    console.error("[GetAllMiniErectors]", error);
    return ErrorHandler(res, 500, "Failed to fetch mini erectors", error);
  }
};


const GetMiniErectorById = async (req, res) => {
  try {
    const { id } = req.query;

    const erector = await MiniErector.findById(id);

    if (!erector) {
      return ErrorHandler(res, 404, "Mini erector not found");
    }

    return ResponseOk(
      res,
      200,
      "Mini erector fetched successfully",
      erector
    );

  } catch (error) {
    console.error("[GetMiniErectorById]", error);
    return ErrorHandler(res, 500, "Failed to fetch mini erector", error);
  }
};



const DeleteMiniErector = async (req, res) => {
  try {
    const { id } = req.query;

    if (!id) {
      return ErrorHandler(res, 400, "Erector ID is required");
    }

    const deletedErector = await MiniErector.findByIdAndDelete(id);

    if (!deletedErector) {
      return ErrorHandler(res, 404, "Mini erector not found");
    }

    return ResponseOk(
      res,
      200,
      "Mini erector deleted successfully",
      deletedErector
    );

  } catch (error) {
    console.error("[DeleteMiniErector]", error);
    return ErrorHandler(res, 500, "Failed to delete mini erector", error.message);
  }
};










module.exports = {
  CreateErector,
  UpdateErector,
  GetAllErectors,
  DeleteErector,
  GetErectorsById,
  GetErectorsOverview,
  CopyErector,
  GetErectorsDropdown,

  CreateMiniErector,
  UpdateMiniErector,
  GetAllMiniErectors,
  GetMiniErectorById,
  DeleteMiniErector
};

