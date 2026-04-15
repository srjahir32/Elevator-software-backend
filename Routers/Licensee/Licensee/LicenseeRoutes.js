const { Router } = require("express");
const {
  ListLicensees,
  GetLicenseeById,
  GetLiftLicenseHistory,
  CreateLicensee,
  RenewLicensee,
  UpdateLicensee,
  DeleteLicensee,
  PERMS,
} = require("../../Controllers/Licensee/Licensee.Controller");
const { requireAnyAppPermission } = require("../../Utils/getUserAppPermissions");

const LicenseeRouter = Router();

LicenseeRouter.get("/view", requireAnyAppPermission([PERMS.VIEW]), ListLicensees);
LicenseeRouter.get("/lift_history", requireAnyAppPermission([PERMS.VIEW]), GetLiftLicenseHistory);
LicenseeRouter.post("/renew", requireAnyAppPermission([PERMS.RENEW]), RenewLicensee);
LicenseeRouter.post("/", requireAnyAppPermission([PERMS.CREATE]), CreateLicensee);
LicenseeRouter.get("/:id", requireAnyAppPermission([PERMS.VIEW, PERMS.EDIT]), GetLicenseeById);
LicenseeRouter.put("/:id", requireAnyAppPermission([PERMS.EDIT]), UpdateLicensee);
LicenseeRouter.delete("/:id", requireAnyAppPermission([PERMS.DELETE]), DeleteLicensee);

module.exports = LicenseeRouter;
