const { Router } = require("express");
const {
    CreateChallan,
    GetChallans,
    GetChallanStats,
    GetChallansByAMC,
    GetChallanById,
    UpdateChallan,
    UpdateChallanStatus,
    MarkDelivered,
    DeleteChallan,
} = require("../../Controllers/DeliveryChallan/DeliveryChallan.controller.js");

const DeliveryChallanRouter = Router();

DeliveryChallanRouter.post("/add_challan", CreateChallan);
DeliveryChallanRouter.get("/stats", GetChallanStats);
DeliveryChallanRouter.get("/view_challans", GetChallans);
DeliveryChallanRouter.get("/project/:amcId", GetChallansByAMC);
DeliveryChallanRouter.get("/get_challan/:id", GetChallanById);
DeliveryChallanRouter.put("/update_challan/:id", UpdateChallan);
DeliveryChallanRouter.put("/update_status/:id", UpdateChallanStatus);
DeliveryChallanRouter.post("/mark_delivered/:id", MarkDelivered);
DeliveryChallanRouter.delete("/delete_challan/:id", DeleteChallan);

module.exports = DeliveryChallanRouter;
