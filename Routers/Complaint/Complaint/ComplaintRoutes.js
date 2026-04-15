const { Router } = require("express");
const {
  ListComplaints,
  GetComplaintById,
  GetComplaintMeta,
  CreateComplaint,
  UpdateComplaint,
  UpdateComplaintStatus,
  DeleteComplaint,
} = require("../../Controllers/Complaint/Complaint.controller");

const ComplaintRouter = Router();

ComplaintRouter.get("/view_complaints", ListComplaints);
ComplaintRouter.post("/add_complaint", CreateComplaint);
ComplaintRouter.get("/meta/:amcId", GetComplaintMeta);
ComplaintRouter.get("/get_complaint/:id", GetComplaintById);
ComplaintRouter.put("/update_complaint/:id", UpdateComplaint);
ComplaintRouter.put("/update_status/:id", UpdateComplaintStatus);
ComplaintRouter.delete("/delete_complaint/:id", DeleteComplaint);

module.exports = ComplaintRouter;
