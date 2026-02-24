const { Router } = require("express");
const {
  CreateAMC,
  ViewAMC,
  GetAMCSummary,
  GetAMCById,
  UpdateAMC,
  UpdateServiceSchedule,
  UpdatePaymentSchedule,
  RenewAMC,
  GetRenewalHistory,
  GetAMCDashboardStats,
  DeleteAMC,
} = require("../../Controllers/AMC/AMC.Controller");

const AMCRouter = Router();

AMCRouter.post("/add_amc", CreateAMC);
AMCRouter.get("/view_amc", ViewAMC);
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

