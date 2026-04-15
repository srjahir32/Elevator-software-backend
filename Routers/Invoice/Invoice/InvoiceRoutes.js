const { Router } = require("express");
const {
    CreateInvoice,
    GetInvoiceStats,
    GetInvoices,
    GetInvoicesByAMC,
    GetInvoiceById,
    MarkInvoiceSent,
    UpdateInvoiceStatus,
    AddPayment,
    RecordPayment,
    DeleteInvoice,
} = require("../../Controllers/Invoice/Invoice.controller");

const InvoiceRouter = Router();

InvoiceRouter.post("/add_invoice", CreateInvoice);
InvoiceRouter.get("/stats", GetInvoiceStats);
InvoiceRouter.get("/view_invoices", GetInvoices);
InvoiceRouter.get("/project/:amcId", GetInvoicesByAMC);
InvoiceRouter.get("/get_invoice/:id", GetInvoiceById);
InvoiceRouter.post("/mark_sent/:id", MarkInvoiceSent);
InvoiceRouter.put("/update_status/:id", UpdateInvoiceStatus);
InvoiceRouter.post("/add_payment", AddPayment);
InvoiceRouter.post("/record_payment/:id", RecordPayment);
InvoiceRouter.delete("/delete_invoice/:id", DeleteInvoice);

module.exports = InvoiceRouter;
