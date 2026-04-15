const { Router } = require("express");
const {
  CreateAMC,
  ViewAMC,
  ListServiceVisits,
  GetAMCSummary,
  GetAMCById,
  UpdateAMC,
  UpdateServiceSchedule,
  UpdatePaymentSchedule,
  RenewAMC,
  GetRenewalHistory,
  GetAMCDashboardStats,
  DeleteAMC,
  UploadAMCDocuments,
} = require("../../Controllers/AMC/AMC.Controller");
const upload = require("../../Utils/ImageUtils");

const AMCRouter = Router();

AMCRouter.post("/add_amc", CreateAMC);
AMCRouter.post("/upload_documents", upload.array("files", 15), UploadAMCDocuments);
AMCRouter.get("/view_amc", ViewAMC);
AMCRouter.get("/service_visits", ListServiceVisits);
AMCRouter.get("/amc_summary", GetAMCSummary);
AMCRouter.get("/get_amc_by_id", GetAMCById);
AMCRouter.put("/update_amc", UpdateAMC);
AMCRouter.put("/update_service_schedule", UpdateServiceSchedule);
AMCRouter.put("/update_payment_schedule", UpdatePaymentSchedule);
AMCRouter.post("/renew_amc", RenewAMC);
AMCRouter.get("/renewal_history", GetRenewalHistory);
AMCRouter.get("/dashboard_stats", GetAMCDashboardStats);
AMCRouter.post("/delete_amc", DeleteAMC);

module.exports = AMCRouter;

