const { Router } = require("express");
const {
    CreateInvoice,
    GetInvoices,
    GetInvoiceById,
    MarkInvoiceSent,
    AddPayment
} = require("../../Controllers/Invoice/Invoice.Controller");

const InvoiceRouter = Router();

InvoiceRouter.post("/add_invoice", CreateInvoice);
InvoiceRouter.get("/view_invoices", GetInvoices);
InvoiceRouter.get("/get_invoice/:id", GetInvoiceById);
InvoiceRouter.post("/mark_sent/:id", MarkInvoiceSent);
InvoiceRouter.post("/add_payment", AddPayment);

module.exports = InvoiceRouter;
