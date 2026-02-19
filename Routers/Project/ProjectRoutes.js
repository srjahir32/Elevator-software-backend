const { Router } = require("express");

const { Project } = require('../../Models/Project.model')
const { CreateProject, ViewProject, UpdateProject, ViewListOfSupervisors, GetProjectShortDetails, GetProjectDetailsById, ViewProjectOverviewById, DeleteProject } = require("../../Controllers/Project/Project.Controller");


const ProjectRouter = Router();

ProjectRouter.post('/add_project', CreateProject);
ProjectRouter.get('/view_project', ViewProject);
ProjectRouter.put('/update_project', UpdateProject);
ProjectRouter.get('/get_supervisor_list', ViewListOfSupervisors);
ProjectRouter.get('/get_project_short_details', GetProjectShortDetails);
ProjectRouter.get('/get_project_details_by_id', GetProjectDetailsById);
ProjectRouter.get('/get_project_overview_by_id', ViewProjectOverviewById);
ProjectRouter.post('/delete_project', DeleteProject);

module.exports = ProjectRouter;