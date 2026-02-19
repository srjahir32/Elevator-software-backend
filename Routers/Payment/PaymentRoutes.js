const { Router } = require("express");

const { HandOverForm } = require('../../Models/HandOverForm.model')
const { CreatePaymentEntry, ListPaymentEntries, UpdatePaymentEntry, DeletePaymentEntry, GetPaymentEntryById } = require("../../Controllers/Payment/Payment.Controller");
const { GetPaymentDataReport, GetYearlyPaymentReport } = require("../../Controllers/Reports/Reports.Controller");


const PaymentRouter = Router();

PaymentRouter.post('/payment-entry', CreatePaymentEntry);
PaymentRouter.get('/list_payment_entries', ListPaymentEntries);
PaymentRouter.post('/update_payment_entry', UpdatePaymentEntry);
PaymentRouter.post('/delete_payment_entry', DeletePaymentEntry);
PaymentRouter.get('/GetPaymentEntryById', GetPaymentEntryById);


PaymentRouter.get('/get_payment_report', GetPaymentDataReport);
PaymentRouter.get('/get_payment_report_yearly', GetYearlyPaymentReport);
module.exports = PaymentRouter;