const { Router } = require("express");
const {
    CreateBranch,
    GetAllBranches,
    GetBranchById,
    UpdateBranch,
    DeleteBranch
} = require("../../Controllers/Branch/Branch.Controller");

const BranchRouter = Router();

BranchRouter.post('/', CreateBranch);
BranchRouter.get('/', GetAllBranches);
BranchRouter.get('/:id', GetBranchById);
BranchRouter.put('/:id', UpdateBranch);
BranchRouter.delete('/:id', DeleteBranch);

module.exports = BranchRouter;
