const { Router } = require("express");
const {
  ListQuotations,
  GetQuotationById,
  CreateQuotation,
  UpdateQuotation,
  DeleteQuotation,
  DuplicateQuotation,
  UpdateQuotationStatus,
  CreateInvoiceFromQuotation,
  MarkConvertedAmc,
} = require("../../Controllers/Quotation/Quotation.controller");

const QuotationRouter = Router();

QuotationRouter.get("/list", ListQuotations);
QuotationRouter.get("/:id", GetQuotationById);
QuotationRouter.post("/", CreateQuotation);
QuotationRouter.put("/:id", UpdateQuotation);
QuotationRouter.delete("/:id", DeleteQuotation);
QuotationRouter.post("/:id/duplicate", DuplicateQuotation);
QuotationRouter.patch("/:id/status", UpdateQuotationStatus);
QuotationRouter.post("/:id/create_invoice", CreateInvoiceFromQuotation);
QuotationRouter.post("/:id/link_amc", MarkConvertedAmc);

module.exports = QuotationRouter;
