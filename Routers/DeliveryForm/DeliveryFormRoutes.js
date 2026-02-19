const { Router } = require("express");

const {CreateDeliveryForm, UpdateDeliveryForm, GetDeliveryFormById, DeleteDeliveryForm, GetDeliveryFormsByProjectId, GetAllDeliveryForms, DeliveryFormOverview, CopyDeliveryForm } = require('../../Controllers/DeliveryItem/DeliveryItem.controller');
const upload = require("../../Utils/ImageUtils");


const DeliveryFormRouter = Router();

DeliveryFormRouter.post('/create_delivery_form',upload.any(), CreateDeliveryForm);
DeliveryFormRouter.post('/update_delivery_form',upload.any(), UpdateDeliveryForm);
DeliveryFormRouter.get('/get_delivery_form', GetDeliveryFormById);
DeliveryFormRouter.get('/get_delivery_form_by_project_id', GetDeliveryFormsByProjectId);
DeliveryFormRouter.get('/get_delivery_form_all', GetAllDeliveryForms);
DeliveryFormRouter.get('/get_delivery_overview', DeliveryFormOverview);
DeliveryFormRouter.post('/delete_delivery_form', DeleteDeliveryForm);
DeliveryFormRouter.post('/copy_delivery_form', CopyDeliveryForm);



module.exports = DeliveryFormRouter;