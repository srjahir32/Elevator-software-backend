const { Router } = require("express");
const {
    CreateInvoice,
    GetInvoices,
    GetInvoiceStats,
    GetInvoiceById,
    MarkInvoiceSent,
    UpdateInvoiceStatus,
    AddPayment
} = require("../../Controllers/Invoice/Invoice.Controller");

const InvoiceRouter = Router();

InvoiceRouter.post("/add_invoice", CreateInvoice);
InvoiceRouter.get("/view_invoices", GetInvoices);
InvoiceRouter.get("/stats", GetInvoiceStats);
InvoiceRouter.get("/get_invoice/:id", GetInvoiceById);
InvoiceRouter.put("/update_status/:id", UpdateInvoiceStatus);
InvoiceRouter.post("/mark_sent/:id", MarkInvoiceSent);
InvoiceRouter.post("/record_payment/:id", AddPayment);
InvoiceRouter.post("/add_payment", AddPayment);

module.exports = InvoiceRouter;
