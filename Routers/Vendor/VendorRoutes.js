const { Router } = require("express");

const MaterialSet = require("../../Models/Project.model");
const { CreateMaterialSet, AddVendor, GetMaterialSets, GetVendor, UpdateVendor, DeleteVendor, UpdateMaterialSet, DeleteMaterialSet, GetMaterialSetsByid, GetMaterialSetsOverview, GetVendorById, CopyMaterialSet, GetVendorOrdersList } = require("../../Controllers/Vendor/Vendor.Controller");
const upload = require("../../Utils/ImageUtils");


const VendorRouter = Router();

VendorRouter.post('/material_set',upload.any('files'), CreateMaterialSet);
VendorRouter.post('/update_material_set',upload.any('files'), UpdateMaterialSet);
VendorRouter.get('/get_material_set', GetMaterialSets);
VendorRouter.post('/delete_material_set', DeleteMaterialSet);
VendorRouter.get('/get_material_set_by_id', GetMaterialSetsByid);
VendorRouter.get('/get_material_set_overview', GetMaterialSetsOverview);
VendorRouter.post('/copy_material_set',upload.any('files'), CopyMaterialSet);

VendorRouter.post('/add_vendor', AddVendor);
VendorRouter.get('/get_vendor', GetVendor);
VendorRouter.put('/update_vendor', UpdateVendor);
VendorRouter.post('/delete_vendor', DeleteVendor);
VendorRouter.get('/get_vendor_by_id', GetVendorById);

VendorRouter.get('/get_vender_order_list', GetVendorOrdersList);
module.exports = VendorRouter;