const { Router } = require("express");

const { MeachanicalQc,MeachanicalQcForm } = require('../../Models/QC.model')
const {CreateMechanicalQC, UpdateMechanicalQC, GetMechanicalQCByID, GetMechanicalQCAll, GetMechanicalQCOveriview, DeleteMechanicalQC, CopyMechanicalQC} = require("../../Controllers/Mechanical_QC/Mechanical.controller");
const upload = require('../../Utils/ImageUtils'); 


const MechanicalQCRouter = Router();

MechanicalQCRouter.post('/create_mechanical_qc', upload.any('files'), CreateMechanicalQC);
MechanicalQCRouter.post('/update_mechanical_qc', upload.any('files'), UpdateMechanicalQC);
MechanicalQCRouter.get('/get_mechanical_qc_by_id', GetMechanicalQCByID);
MechanicalQCRouter.get('/get_all_mechanical_qc', GetMechanicalQCAll);
MechanicalQCRouter.get('/get_mechanical_qc_overview', GetMechanicalQCOveriview);
MechanicalQCRouter.post('/delete_mechanical_qc', DeleteMechanicalQC);
MechanicalQCRouter.post('/copy_mechanical_qc', CopyMechanicalQC);

module.exports = MechanicalQCRouter;