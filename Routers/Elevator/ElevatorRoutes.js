const { Router } = require("express");

const {CreateElevator, UpdateElevator, GetElevatorById, DeleteElevator, GetElevatorByProjectId, GetElevatorAll, CopyElevator } = require('../../Controllers/Elevator/Elevator.Controller');

const upload  = require('../../Utils/ImageUtils'); 

const ElevatorRouter = Router();

ElevatorRouter.post('/create_elevator', upload.array('files'),CreateElevator);
ElevatorRouter.put('/update_elevator', upload.array('files'), UpdateElevator);
ElevatorRouter.get('/get_elevator', GetElevatorById);
ElevatorRouter.post('/delete_elevator', DeleteElevator);
ElevatorRouter.get('/get_elevator_by_project_id', GetElevatorByProjectId);
ElevatorRouter.get('/get_elevator_all', GetElevatorAll);
ElevatorRouter.post('/copy_elevator', CopyElevator);



module.exports = ElevatorRouter;