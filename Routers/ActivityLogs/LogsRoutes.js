const { Router } = require("express");

const { ActivityLog } = require('../../Models/Activitylog.model')
const {GetAllActivityLogs, GetAllActivityLogsByProjectId, GetAllActivityLogsDashboard } = require("../../Controllers/ActivityLogs/ActivityLogs.Controller");


const ActivityLogsRouter = Router();
ActivityLogsRouter.get('/get_all_logs', GetAllActivityLogs);
ActivityLogsRouter.get('/get_activity_logs_by_project_id', GetAllActivityLogsByProjectId);
ActivityLogsRouter.get('/get_activity_logs_dashboard', GetAllActivityLogsDashboard);


module.exports = ActivityLogsRouter;