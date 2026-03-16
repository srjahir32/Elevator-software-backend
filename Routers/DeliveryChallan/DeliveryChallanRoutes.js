const { Router } = require("express");
const {
    CreateChallan,
    GetChallans,
    GetChallanById,
    UpdateChallan,
    MarkDelivered
} = require("../../Controllers/DeliveryChallan/DeliveryChallan.Controller");

const DeliveryChallanRouter = Router();

DeliveryChallanRouter.post("/add_challan", CreateChallan);
DeliveryChallanRouter.get("/view_challans", GetChallans);
DeliveryChallanRouter.get("/get_challan/:id", GetChallanById);
DeliveryChallanRouter.put("/update_challan/:id", UpdateChallan);
DeliveryChallanRouter.post("/mark_delivered/:id", MarkDelivered);

module.exports = DeliveryChallanRouter;
