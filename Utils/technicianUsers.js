const mongoose = require("mongoose");
const { Users, User_Associate_With_Role, Roles } = require("../Models/User.model");

/**
 * Users assigned the "Technician" role (Users → role), for AMC / challan / complaint dropdowns.
 * Optional branch_id: include users with no branches (all branches) or whose branches contains branch_id.
 */
async function getTechnicianUsersForDropdown({ branch_id } = {}) {
  const techRole = await Roles.findOne({ name: /^Technician$/i }).lean();
  if (!techRole) return [];

  const links = await User_Associate_With_Role.find({ role_id: techRole.id }).lean();
  const userIds = links.map((l) => l.user_id);
  if (!userIds.length) return [];

  let users = await Users.find({
    _id: { $in: userIds },
    is_active: 1,
  })
    .select("name contact_number email branches")
    .sort({ name: 1 })
    .lean();

  if (branch_id && mongoose.Types.ObjectId.isValid(String(branch_id))) {
    const s = String(branch_id);
    users = users.filter(
      (u) =>
        !u.branches ||
        u.branches.length === 0 ||
        u.branches.some((b) => String(b) === s)
    );
  }

  return users.map((u) => ({
    _id: u._id,
    name: u.name,
    contact_number: u.contact_number,
    email: u.email,
  }));
}

module.exports = { getTechnicianUsersForDropdown };
