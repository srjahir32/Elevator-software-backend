const { Router } = require("express");
const {
    CreateTechnician,
    GetAllTechnicians,
    GetTechnicianById,
    UpdateTechnician,
    DeleteTechnician,
} = require("../../Controllers/Technician/Technician.Controller");

const TechnicianRouter = Router();

TechnicianRouter.post("/", CreateTechnician);
TechnicianRouter.get("/", GetAllTechnicians);
TechnicianRouter.get("/:id", GetTechnicianById);
TechnicianRouter.put("/:id", UpdateTechnician);
TechnicianRouter.delete("/:id", DeleteTechnician);

module.exports = TechnicianRouter;
