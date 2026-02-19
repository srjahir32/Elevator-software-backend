const { Router } = require("express");
const upload  = require('../../Utils/ImageUtils'); 

const { HandOverForm } = require('../../Models/HandOverForm.model')
const {CreateHandOverForm, UpdateHandOverForm, GetHandOverForm, DeleteHandOverForm, GetHandOverFormById, GetHandOverFormOverview, CopyHandOverForm} = require('../../Controllers/HandOverForm/HandOverForm.controller');


const FormRouter = Router();

FormRouter.post('/handover_form', upload.array('files'), CreateHandOverForm);
FormRouter.put('/Update_handover_form', upload.array('files'), UpdateHandOverForm);
FormRouter.get('/get_handover_form', GetHandOverForm);
FormRouter.get('/get_handover_form_overview', GetHandOverFormOverview);
FormRouter.get('/get_handover_form_by_id', GetHandOverFormById);
FormRouter.delete('/delete_handover_form', DeleteHandOverForm);
FormRouter.post('/copy_handover_form', CopyHandOverForm);

module.exports = FormRouter;