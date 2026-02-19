const { Router } = require("express");

const { CreateErector, GetAllErectors, DeleteErector, UpdateErector, GetErectorsById, GetErectorsOverview, CopyErector, GetErectorsDropdown, CreateMiniErector, GetAllMiniErectors, GetMiniErectorById, UpdateMiniErector, DeleteMiniErector } = require('../../Controllers/Erector/Erector.controller');


const ErectorRouter = Router();

ErectorRouter.post('/create_erector', CreateErector);
ErectorRouter.post('/update_erector', UpdateErector);
ErectorRouter.get('/get_all_erectors', GetAllErectors);
ErectorRouter.get('/get_erector_by_id', GetErectorsById);
ErectorRouter.get('/get_erector_overview', GetErectorsOverview);
ErectorRouter.get('/get_erector_dropdown', GetErectorsDropdown);
ErectorRouter.delete('/delete_erectors',DeleteErector );
ErectorRouter.post('/copy_erector',CopyErector );


ErectorRouter.post("/create_mini_erector", CreateMiniErector);

ErectorRouter.get("/get_all_mini_erector", GetAllMiniErectors);

ErectorRouter.get("/get_mini_erector_by-id", GetMiniErectorById);

ErectorRouter.put("/update_mini_erector", UpdateMiniErector);

ErectorRouter.delete("/delete_mini_erector", DeleteMiniErector);


module.exports = ErectorRouter;