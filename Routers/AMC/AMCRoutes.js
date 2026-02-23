const { Router } = require("express");
const {
  CreateAMC,
  ViewAMC,
  GetAMCById,
  UpdateAMC,
  UpdateServiceSchedule,
  UpdatePaymentSchedule,
  DeleteAMC,
} = require("../../Controllers/AMC/AMC.Controller");

const AMCRouter = Router();

AMCRouter.post("/add_amc", CreateAMC);
AMCRouter.get("/view_amc", ViewAMC);
AMCRouter.get("/get_amc_by_id", GetAMCById);
AMCRouter.put("/update_amc", UpdateAMC);
AMCRouter.put("/update_service_schedule", UpdateServiceSchedule);
AMCRouter.put("/update_payment_schedule", UpdatePaymentSchedule);
AMCRouter.post("/delete_amc", DeleteAMC);

module.exports = AMCRouter;

