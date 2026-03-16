const { Router } = require("express");
const Routes = Router();
const AuthRouter = require('./Auth/AuthRoutes');
const ErectorRouter = require("./Erector/ErectorRoutes");
const FormRouter = require("./HandOverForm/HandOverFormRoutes");
const PaymentRouter = require("./Payment/PaymentRoutes");
const ProjectRouter = require("./Project/ProjectRoutes");
const QcRouter = require("./QC/QcRoutes");
const AdminRouter = require("./Admin/AdminRoutes");
const VendorRouter = require("./Vendor/VendorRoutes");
const ElevatorRouter = require("./Elevator/ElevatorRoutes");
const PreInstallRouter = require("./PreInstall/PreInstallRoutes");
const DeliveryFormRouter = require("./DeliveryForm/DeliveryFormRoutes");
const MechanicalQCRouter = require("./Mechanical_QC/MechanicalQCRoutes");
const ActivityLogsRouter = require("./ActivityLogs/LogsRoutes");
const BranchRouter = require("./Branch/BranchRoutes");
const AMCRouter = require("./AMC/AMCRoutes");
const DeliveryChallanRouter = require("./DeliveryChallan/DeliveryChallanRoutes");
const InvoiceRouter = require("./Invoice/InvoiceRoutes");
const TechnicianRouter = require("./Technician/TechnicianRoutes");

Routes.use("/auth", AuthRouter);
// ... existing codes
Routes.use('/logs', ActivityLogsRouter);
Routes.use('/branch', BranchRouter);
Routes.use("/erector", ErectorRouter)
Routes.use('/form', FormRouter)
Routes.use('/payment', PaymentRouter)
Routes.use('/project', ProjectRouter)
Routes.use('/qc', QcRouter)
Routes.use('/admin', AdminRouter)
Routes.use('/vendor', VendorRouter)
Routes.use('/elevator', ElevatorRouter);
Routes.use('/pre_install', PreInstallRouter);
Routes.use('/delivery_form', DeliveryFormRouter);
Routes.use('/mechanical_qc', MechanicalQCRouter);
Routes.use('/logs', ActivityLogsRouter);
Routes.use('/amc', AMCRouter);
Routes.use('/challans', DeliveryChallanRouter);
Routes.use('/invoices', InvoiceRouter);
Routes.use('/technicians', TechnicianRouter);

module.exports = Routes;