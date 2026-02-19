const { ErrorHandler, ResponseOk } = require("../../Utils/ResponseHandler");
const mongoose = require("mongoose");
const { MaterialSet } = require("../../Models/Project.model");
const { Vendor } = require("../../Models/Project.model");
const { ActivityLog } = require("../../Models/Activitylog.model");
const { Project } = require("../../Models/Project.model");
const { Users } = require("../../Models/User.model");
const fs = require("fs");
const path = require("path");

// const CreateMaterialSet = async (req, res) => {
//   try {
//     const uploadedFiles = req.files || [];

// const files = uploadedFiles.map(file => ({
//   fileType: file.mimetype.startsWith('video') ? 'video' : 'image',
//   fileUrl: `/public/uploads/${file.mimetype.startsWith('video') ? 'videos' : 'images'}/${file.filename}`
// }));
// console.log("filess",files);

//     const {
//       project_id,
//       materialSetTitle,
//       vendorOrderList
//     } = req.body;

//     if (!project_id || !materialSetTitle || !Array.isArray(vendorOrderList)) {
//       return ErrorHandler(res, 400, "All required fields must be provided");
//     }

//     const missingFields = vendorOrderList.some(item =>
//       !item.partName || !item.brandName || !item.orderDetailsWithQty
//     );
//     // if (missingFields) {
//     //   return ErrorHandler(res, 400, "Each vendor item must have partName, brandName, and orderDetailsWithQty");
//     // }

//     const materialSet = await MaterialSet.create({
//       project_id,
//       materialSetTitle,
//       vendorOrderList,
//       files
//     });

//     const user_details = await Users.findById(req.auth.id);
//     const projectDetails = await Project.findOne({ _id: project_id }).select('site_name');
//     await ActivityLog.create({
//       user_id: req.auth?.id || null,
//       user_name: user_details.name,
//       action: 'CREATE_VENDER_ORDER',
//       type: 'Create',
//       description: `${user_details.name} has added vender order named ${materialSetTitle} for project "${projectDetails.site_name}".`,
//       title: 'Create Vender Order',
//       project_id: project_id,
//     });

//     return ResponseOk(res, 200, "Vender Order created successfully", materialSet);
//   } catch (error) {
//     console.error("[CreateMaterialSet]", error);
//     return ErrorHandler(res, 500, "Server error while creating Vender Order");
//   }
// };


const CreateMaterialSet = async (req, res) => {
  try {
    let { project_id, materialSetTitle, vendorOrderList } = req.body;

    if (!vendorOrderList || (!Array.isArray(vendorOrderList) && typeof vendorOrderList !== "string")) {
      const itemsByIndex = {};
      const fieldRegex = /^vendorOrderList\[(\d+)\]\[(.+)\]$/;

      for (const [key, rawValue] of Object.entries(req.body)) {
        const m = key.match(fieldRegex);
        if (!m) continue;
        const idx = m[1];
        const field = m[2];

        if (!itemsByIndex[idx]) itemsByIndex[idx] = {};
        itemsByIndex[idx][field] = typeof rawValue === "string" ? rawValue.trim() : rawValue;
      }

      const built = Object.keys(itemsByIndex)
        .sort((a, b) => Number(a) - Number(b))
        .map(i => {
          const it = itemsByIndex[i];

          if (it.received !== undefined) {
            const b = String(it.received).trim().toLowerCase();
            it.received = ["true", "1", "yes", "on"].includes(b);
          }
          ["receivedDate","requireDate","orderDate"].forEach(f => {
            if (it[f]) {
              const d = new Date(it[f]);
              if (!isNaN(d)) it[f] = d;
            }
          });
          return it;
        });

      vendorOrderList = built;
    } else if (typeof vendorOrderList === "string") {
      try {
        vendorOrderList = JSON.parse(vendorOrderList);
      } catch (err) {
        return ErrorHandler(res, 400, "Invalid vendorOrderList JSON");
      }
    }

    if (!project_id || !materialSetTitle || !Array.isArray(vendorOrderList)) {
      return ErrorHandler(res, 400, "All required fields must be provided");
    }


    const files = req.files || [];
    const fileFieldRegex = /^vendorOrderList\[(\d+)\]\[files\]\[(\d+)\]$/;

    files.forEach(file => {
      const match = String(file.fieldname).match(fileFieldRegex);
      if (!match) return; 

      const itemIndex = Number(match[1]);
      if (isNaN(itemIndex)) return;

      while (vendorOrderList.length <= itemIndex) {
        vendorOrderList.push({
          partName: "",
          brandName: "",
          files: []
        });
      }

      if (!Array.isArray(vendorOrderList[itemIndex].files)) {
        vendorOrderList[itemIndex].files = [];
      }

      const fileType = file.mimetype && file.mimetype.startsWith("image/") ? "image" : "pdf";
      const folder = fileType === "image" ? "images" : "pdfs";
      const fileUrl = `/public/uploads/${folder}/${file.filename}`;

      vendorOrderList[itemIndex].files.push({ fileType, fileUrl });
    });

    const missingFields = vendorOrderList.some(item =>
      !item.partName || !item.brandName
    );
    if (missingFields) {
      return ErrorHandler(
        res,
        400,
        "Each vendor item must have partName and brandName"
      );
    }

    const materialSet = await MaterialSet.create({
      project_id,
      materialSetTitle,
      vendorOrderList
    });

    const user_details = await Users.findById(req.auth.id);
    const projectDetails = await Project.findOne({ _id: project_id }).select("site_name");
    await ActivityLog.create({
      user_id: req.auth?.id || null,
      user_name: user_details?.name || "",
      action: "CREATE_VENDER_ORDER",
      type: "Create",
      description: `${user_details?.name || "Someone"} has added vender order named ${materialSetTitle} for project "${projectDetails?.site_name || ''}".`,
      title: "Create Vender Order",
      project_id: project_id,
    });

    return ResponseOk(res, 200, "Vender Order created successfully", materialSet);
  } catch (error) {
    console.error("[CreateMaterialSet]", error);
    return ErrorHandler(res, 500, "Server error while creating Vender Order");
  }
};


// const UpdateMaterialSet = async (req, res) => {
//   try {
//     const {
//       materialSetId,
//       project_id,
//       materialSetTitle,
//       vendorOrderList
//     } = req.body;

//     if (!materialSetId || !project_id || !materialSetTitle || !Array.isArray(vendorOrderList)) {
//       return ErrorHandler(res, 400, "All required fields must be provided");
//     }

//     const missingFields = vendorOrderList.some(item =>
//       !item.partName || !item.brandName || !item.orderDetailsWithQty
//     );
//     if (missingFields) {
//       return ErrorHandler(res, 400, "Each vendor item must have partName, brandName, and orderDetailsWithQty");
//     }

//     const updatedMaterialSet = await MaterialSet.findByIdAndUpdate(
//       materialSetId,
//       {
//         project_id,
//         materialSetTitle,
//         vendorOrderList
//       },
//       { new: true }
//     );

//     if (!updatedMaterialSet) {
//       return ErrorHandler(res, 404, "Vender Order not found");
//     }

//     const user_details = await Users.findById(req.auth.id);
//     const projectDetails = await Project.findOne({ _id: project_id }).select('site_name');
//     await ActivityLog.create({
//       user_id: req.auth?.id || null,
//       user_name: user_details.name,
//       action: 'UPDATE_VENDER_ORDER',
//       type: 'Update',
//       description: `${user_details.name} has update vender order named ${materialSetTitle} for project "${projectDetails.site_name}".`,
//       title: 'Update Vender Order',
//       project_id: project_id,
//     });

//     return ResponseOk(res, 200, "Vender Order updated successfully", updatedMaterialSet);
//   } catch (error) {
//     console.error("[UpdateMaterialSet]", error);
//     return ErrorHandler(res, 500, "Server error while updating Vender Order");
//   }
// };




const UpdateMaterialSet = async (req, res) => {
  try {
    // -------------- basic validations --------------
    const { materialSetId } = req.body;
    if (!materialSetId) return ErrorHandler(res, 400, "materialSetId is required to update material_set");
    if (!mongoose.Types.ObjectId.isValid(materialSetId)) return ErrorHandler(res, 400, "Invalid materialSetId");

    const existingSet = await MaterialSet.findById(materialSetId);
    if (!existingSet) return ErrorHandler(res, 404, "MaterialSet not found");

    // -------------- parse incoming fields --------------
    let { materialSetTitle, project_id, vendorOrderList = [], deleteImgIds = [] } = req.body;

    // If vendorOrderList sent exploded as form-data keys vendorOrderList[0][partName]...
    if (!vendorOrderList || (typeof vendorOrderList !== "object" && typeof vendorOrderList !== "string")) {
      // build from req.body keys
      const itemsByIndex = {};
      const fieldRegex = /^vendorOrderList\[(\d+)\]\[(.+)\]$/;

      for (const [key, rawValue] of Object.entries(req.body)) {
        const m = key.match(fieldRegex);
        if (!m) continue;
        const idx = m[1];
        const field = m[2];

        if (!itemsByIndex[idx]) itemsByIndex[idx] = {};
        itemsByIndex[idx][field] = rawValue;
      }

      if (Object.keys(itemsByIndex).length > 0) {
        vendorOrderList = Object.keys(itemsByIndex)
          .sort((a, b) => Number(a) - Number(b))
          .map(i => {
            const it = itemsByIndex[i];

            // convert booleans/dates if necessary
            if (it.received !== undefined) {
              const b = String(it.received).trim().toLowerCase();
              it.received = ["true", "1", "yes", "on"].includes(b);
            }
            ["receivedDate", "requireDate", "orderDate"].forEach(f => {
              if (it[f]) {
                const d = new Date(it[f]);
                if (!isNaN(d)) it[f] = d;
              }
            });
            return it;
          });
      }
    } else if (typeof vendorOrderList === "string" && vendorOrderList.trim()) {
      // vendorOrderList is JSON string in multipart form-data
      try {
        vendorOrderList = JSON.parse(vendorOrderList);
      } catch (e) {
        // keep as string (we won't crash; just ignore replacement)
      }
    }
    // now vendorOrderList either array or left as whatever — only proceed if array present when updating items

    // -------------- normalize deleteImgIds (flat array or index->ids map) --------------
    let idsToDeleteFlat = [];
    let idsToDeleteMap = {}; // { index: [id,...] }

    if (deleteImgIds) {
      if (typeof deleteImgIds === "string") {
        const s = deleteImgIds.trim();
        try {
          const parsed = JSON.parse(s);
          deleteImgIds = parsed;
        } catch (e) {
          deleteImgIds = s.includes(",") ? s.split(",").map(x => x.trim()) : [s];
        }
      }

      if (Array.isArray(deleteImgIds)) {
        idsToDeleteFlat = deleteImgIds.map(x => String(x).trim()).filter(x => mongoose.Types.ObjectId.isValid(x));
      } else if (typeof deleteImgIds === "object" && deleteImgIds !== null) {
        // map provided
        for (const [k, v] of Object.entries(deleteImgIds)) {
          const idx = Number(k);
          if (isNaN(idx)) continue;
          const arr = Array.isArray(v) ? v : (typeof v === "string" ? (v.includes(",") ? v.split(",") : [v]) : []);
          const cleaned = arr.map(x => String(x).trim()).filter(x => mongoose.Types.ObjectId.isValid(x));
          if (cleaned.length) idsToDeleteMap[idx] = cleaned;
          idsToDeleteFlat.push(...cleaned);
        }
        idsToDeleteFlat = [...new Set(idsToDeleteFlat)];
      }
    }

    // -------------- update vendorOrderList items by index if provided --------------
    if (Array.isArray(vendorOrderList) && vendorOrderList.length > 0) {
      for (let i = 0; i < vendorOrderList.length; i++) {
        const incoming = vendorOrderList[i] || {};
        if (incoming.received !== undefined) {
          const b = String(incoming.received).trim().toLowerCase();
          incoming.received = ["true", "1", "yes", "on"].includes(b);
        }

        if (existingSet.vendorOrderList[i]) {
          const existingItem = existingSet.vendorOrderList[i];
          existingItem.partName = incoming.partName !== undefined ? incoming.partName : existingItem.partName;
          existingItem.brandName = incoming.brandName !== undefined ? incoming.brandName : existingItem.brandName;
          existingItem.billDetails = incoming.billDetails !== undefined ? incoming.billDetails : existingItem.billDetails;
          existingItem.orderDetailsWithQty = incoming.orderDetailsWithQty !== undefined ? incoming.orderDetailsWithQty : existingItem.orderDetailsWithQty;
          existingItem.qty = incoming.qty !== undefined ? incoming.qty : existingItem.qty;
          existingItem.received = incoming.received !== undefined ? incoming.received : existingItem.received;
          existingItem.receivedDate = incoming.receivedDate !== undefined ? incoming.receivedDate : existingItem.receivedDate;
          existingItem.requireDate = incoming.requireDate !== undefined ? incoming.requireDate : existingItem.requireDate;
          existingItem.orderDate = incoming.orderDate !== undefined ? incoming.orderDate : existingItem.orderDate;
          existingItem.remarks = incoming.remarks !== undefined ? incoming.remarks : existingItem.remarks;
          existingItem.color = incoming.color !== undefined ? incoming.color : existingItem.color;
          existingItem.height = incoming.height !== undefined ? incoming.height : existingItem.height;
          existingItem.vision = incoming.vision !== undefined ? incoming.vision : existingItem.vision;
          existingItem.overload = incoming.overload !== undefined ? incoming.overload : existingItem.overload;
          existingItem.meter = incoming.meter !== undefined ? incoming.meter : existingItem.meter;
          if (!Array.isArray(existingItem.files)) existingItem.files = [];
        } else {
          // push new placeholder item (files will be appended below if uploaded)
          existingSet.vendorOrderList.push({
            partName: incoming.partName || "",
            brandName: incoming.brandName || "",
            orderDetailsWithQty: incoming.orderDetailsWithQty || "",
            received: incoming.received || false,
            receivedDate: incoming.receivedDate || null,
            requireDate: incoming.requireDate || null,
            orderDate: incoming.orderDate || null,
            remarks: incoming.remarks || null,
            color: incoming.color || null,
            height: incoming.height || null,
            vision: incoming.vision || null,
            overload: incoming.overload || null,
            meter: incoming.meter || null,
            files: []
          });
        }
      }
    }

    // -------------- handle uploaded files (map by fieldname) --------------
    // Expect: vendorOrderList[<index>][files][<n>]
    const uploadedFiles = req.files || [];
    const fileFieldRegex = /^vendorOrderList\[(\d+)\]\[files\]\[(\d+)\]$/;
    const fileMap = {};   // { index: [ {fileType, fileUrl}, ... ] }
    const fallbackFiles = []; // files without matching index -> go to Cabin

    uploadedFiles.forEach(file => {
      const match = String(file.fieldname).match(fileFieldRegex);
      // determine fileType & fileUrl
      const fileType = file.mimetype && file.mimetype.startsWith("image/") ? "image" : "pdf";
      const folder = fileType === "image" ? "images" : "pdfs";
      const fileUrl = `/public/uploads/${folder}/${file.filename}`;

      if (match) {
        const idx = Number(match[1]);
        fileMap[idx] = fileMap[idx] || [];
        fileMap[idx].push({ fileType, fileUrl });
      } else {
        // fallback -> cabin
        fallbackFiles.push({ fileType, fileUrl });
      }
    });

    // ensure vendorOrderList has items up to max index we need (for fileMap or idsToDeleteMap)
    const maxIndexNeeded = Math.max(
      ...Object.keys(fileMap).map(k => Number(k)),
      ...Object.keys(idsToDeleteMap).map(k => Number(k)),
      -1
    );
    for (let i = 0; i <= maxIndexNeeded; i++) {
      if (!existingSet.vendorOrderList[i]) {
        existingSet.vendorOrderList[i] = {
          partName: "",
          brandName: "",
          orderDetailsWithQty: "",
          received: false,
          files: []
        };
      } else if (!Array.isArray(existingSet.vendorOrderList[i].files)) {
        existingSet.vendorOrderList[i].files = [];
      }
    }

    // append mapped files to corresponding vendor items
    for (const [k, arr] of Object.entries(fileMap)) {
      const idx = Number(k);
      if (!Array.isArray(existingSet.vendorOrderList[idx].files)) existingSet.vendorOrderList[idx].files = [];
      existingSet.vendorOrderList[idx].files.push(...arr);
    }

    // fallback files -> cabin
    if (fallbackFiles.length > 0) {
      let cabinIdx = existingSet.vendorOrderList.findIndex(it => it.partName && String(it.partName).trim().toLowerCase() === "cabin");
      if (cabinIdx === -1) {
        existingSet.vendorOrderList.push({ partName: "Cabin", brandName: "", files: [] });
        cabinIdx = existingSet.vendorOrderList.length - 1;
      }
      if (!Array.isArray(existingSet.vendorOrderList[cabinIdx].files)) existingSet.vendorOrderList[cabinIdx].files = [];
      existingSet.vendorOrderList[cabinIdx].files.push(...fallbackFiles);
    }

    // -------------- perform deletions --------------
    const deletedFileIds = [];
    const notFoundFileIds = [];

    // 1) index->ids (strict)
    for (const [k, arr] of Object.entries(idsToDeleteMap)) {
      const idx = Number(k);
      if (isNaN(idx)) continue;
      const item = existingSet.vendorOrderList[idx];
      if (!item || !Array.isArray(item.files)) {
        notFoundFileIds.push(...arr);
        continue;
      }

      for (const fid of arr) {
        const fi = item.files.findIndex(f => String(f._id) === String(fid));
        if (fi !== -1) {
          const fobj = item.files[fi];
          // delete local file on disk if present
          if (fobj && typeof fobj.fileUrl === "string" && fobj.fileUrl.startsWith("/public")) {
            try {
              const localPath = fobj.fileUrl.replace(/^\/?public/, "public");
              const p = path.join(__dirname, "..", localPath);
              if (fs.existsSync(p)) fs.unlinkSync(p);
            } catch (e) { console.error("unlink error", e); }
          }
          item.files.splice(fi, 1);
          deletedFileIds.push(fid);
        } else {
          notFoundFileIds.push(fid);
        }
      }
    }

    // 2) flat ids -> search all items
    if (Array.isArray(idsToDeleteFlat) && idsToDeleteFlat.length > 0) {
      for (const fid of idsToDeleteFlat) {
        if (deletedFileIds.includes(fid)) continue; // already deleted via map
        let removed = false;
        for (let i = 0; i < existingSet.vendorOrderList.length; i++) {
          const item = existingSet.vendorOrderList[i];
          if (!item.files || item.files.length === 0) continue;
          const fi = item.files.findIndex(f => String(f._id) === String(fid));
          if (fi !== -1) {
            const fobj = item.files[fi];
            if (fobj && typeof fobj.fileUrl === "string" && fobj.fileUrl.startsWith("/public")) {
              try {
                const localPath = fobj.fileUrl.replace(/^\/?public/, "public");
                const p = path.join(__dirname, "..", localPath);
                if (fs.existsSync(p)) fs.unlinkSync(p);
              } catch (e) { console.error("unlink error", e); }
            }
            item.files.splice(fi, 1);
            deletedFileIds.push(fid);
            removed = true;
            break;
          }
        }
        if (!removed) notFoundFileIds.push(fid);
      }
    }

    // // -------------- validate minimal fields --------------
    // const missing = existingSet.vendorOrderList.some(it => !it.partName || !it.brandName);
    // if (missing) return ErrorHandler(res, 400, "Each vendor item must have partName and brandName");

    // -------------- validate minimal fields --------------
// Only validate items that actually contain some data (or files).
const missing = existingSet.vendorOrderList.some(it => {
  const partName = (it.partName || "").trim();
  const brandName = (it.brandName || "").trim();
  const isCabin = partName.toLowerCase() === "cabin";

  // Skip purely empty placeholder rows (no name, no brand, no files, no details)
  const hasAnyData =
    partName ||
    brandName ||
    (it.orderDetailsWithQty && String(it.orderDetailsWithQty).trim()) ||
    (Array.isArray(it.files) && it.files.length > 0) ||
    (it.remarks && String(it.remarks).trim());

  if (!hasAnyData) return false; // ignore empty placeholder rows

  // Cabin: allow missing brandName
  if (isCabin) return false;

  // For normal rows: must have both partName and brandName
  return !partName || !brandName;
});

if (missing) {
  return ErrorHandler(res, 400, "Each vendor item must have partName and brandName");
}


    // -------------- apply top-level updates and save --------------
    if (materialSetTitle !== undefined) existingSet.materialSetTitle = materialSetTitle;
    if (project_id !== undefined) existingSet.project_id = project_id;

    await existingSet.save();

    // -------------- activity log --------------
    const user_details = await Users.findById(req.auth.id);
    const projectDetails = await Project.findById(existingSet.project_id).select('site_name');
    await ActivityLog.create({
      user_id: req.auth?.id || null,
      user_name: user_details?.name || "",
      action: 'UPDATE_VENDER_ORDER',
      type: 'Update',
      description: `${user_details?.name || "Someone"} updated vendor order "${existingSet.materialSetTitle}" for project "${projectDetails?.site_name || ''}".`,
      title: 'Update Vender Order',
      project_id: existingSet.project_id,
    });

    // -------------- response --------------
    return ResponseOk(res, 200, "Vender Order updated successfully", {
      materialSet: existingSet,
      summary: {
        addedFiles: Object.entries(fileMap).flatMap(([idx, arr]) => arr.map(a => ({ index: Number(idx), ...a }))).concat(fallbackFiles.map(a => ({ index: "cabin_fallback", ...a }))),
        deletedFileIds,
        notFoundFileIds
      }
    });
  } catch (error) {
    console.error("Error updating MaterialSet:", error);
    return ErrorHandler(res, 500, "Failed to update MaterialSet", error.message || error);
  }
};
 

const GetMaterialSets = async (req, res) => {
  try {
    const materialSets = await MaterialSet.find({ project_id: req.query.project_id });

    if (!materialSets || materialSets.length === 0) {
      return ErrorHandler(res, 200, "No material sets found for this project");
    }

    return ResponseOk(res, 200, "Material Sets retrieved successfully", {
      materialSets,
    });
  } catch (error) {
    console.error("[GetMaterialSets]", error);
    return ErrorHandler(res, 500, "Server error while retrieving material sets");
  }
};

const DeleteMaterialSet = async (req, res) => {
  try {
    const { id } = req.query;

    const entry = await MaterialSet.findById(id);
    if (!entry) return ErrorHandler(res, 404, "Entry not found");

    const user_details = await Users.findById(req.auth.id);
    const projectDetails = await Project.findOne({ _id: entry.project_id }).select('site_name');
    await entry.deleteOne();
    await ActivityLog.create({
      user_id: req.auth?.id || null,
      user_name: user_details.name,
      action: 'DELETE_VENDER_ORDER',
      type: 'Delete',
      description: `${user_details.name} has deleted vender named ${entry.materialSetTitle} for project "${projectDetails.site_name}".`,
      title: 'Delete Vender Order',
      project_id: entry.project_id,
    });
    return ResponseOk(res, 200, "Entry deleted successfully");
  } catch (error) {
    console.error("error", error);
    return ErrorHandler(res, 500, "Server error while deleting Vender Order");

  }
}

// const GetMaterialSetsOverview = async (req, res) => {
//   try {
//     const { project_id } = req.query;

//     if (!mongoose.Types.ObjectId.isValid(project_id)) {
//       return ErrorHandler(res, 400, "Invalid project_id format");
//     }

//     const materialSets = await MaterialSet.find({ project_id })
//       .select("_id materialSetTitle vendorOrderList")
//       .sort({ createdAt: -1 })
//       .lean();

//     if (!materialSets || materialSets.length === 0) {
//       return ErrorHandler(res, 200, "No material sets found for this project");
//     }

//     const result = materialSets.map(set => {
//       const totalItems = set.vendorOrderList.length;
//       const receivedCount = set.vendorOrderList.filter(item => item.received === true).length;
//       const pendingItems = set.vendorOrderList
//         .filter(item => item.received === false)
//         .map(item => item.partName);

//       const completionProgress = totalItems > 0
//         ? Math.round((receivedCount / totalItems) * 100)
//         : 0;

//       return {
//         id: set._id,
//         materialSetTitle: set.materialSetTitle,
//         pendingItems,
//         totalItems,
//         receivedCount,
//         pendingCount: pendingItems.length,
//         completionProgress: `${completionProgress}%`
//       };
//     });

//     return ResponseOk(res, 200, "Material Sets retrieved successfully", { materialSets: result });
//   } catch (error) {
//     console.error("[GetMaterialSets]", error);
//     return ErrorHandler(res, 500, "Server error while retrieving material sets");
//   }
// };


const GetMaterialSetsOverview = async (req, res) => {
  try {
    const { project_id } = req.query;
 
    if (!project_id || !mongoose.Types.ObjectId.isValid(project_id)) {
      return ErrorHandler(res, 400, "Invalid or missing project_id format");
    }
 
    const materialSets = await MaterialSet.find({ project_id })
      .select("_id materialSetTitle vendorOrderList")
      .sort({ createdAt: -1 })
      .lean();
 
    if (!materialSets || materialSets.length === 0) {
      return ErrorHandler(res, 200, "No material sets found for this project");
    }
 
    // helper to normalize received values
    const isReceived = (val) => {
      if (val === true) return true;
      if (val === false || val === null || typeof val === "undefined") return false;
      // numbers (1/0)
      if (typeof val === "number") return val === 1;
      const s = String(val).trim().toLowerCase();
      return ["true", "1", "yes", "on"].includes(s);
    };
 
    const result = materialSets.map(set => {
      const rawList = Array.isArray(set.vendorOrderList) ? set.vendorOrderList : [];
 
      // Only consider valid items (those that actually represent a part)
      const validItems = rawList.filter(item => item && item.partName && String(item.partName).trim().length > 0);
 
      const totalItems = validItems.length;
      const receivedCount = validItems.filter(item => isReceived(item.received)).length;
 
      // pending items names (keep unique and non-empty)
      const pendingItems = validItems
        .filter(item => !isReceived(item.received))
        .map(item => item.partName || "")
        .filter(Boolean);
 
      const itemsWithFilesCount = validItems.filter(item => Array.isArray(item.files) && item.files.length > 0).length;
 
      const completionProgress = totalItems > 0
        ? `${Math.round((receivedCount / totalItems) * 100)}%`
        : "0%";
 
      return {
        id: set._id,
        materialSetTitle: set.materialSetTitle,
        pendingItems,
        totalItems,
        receivedCount,
        pendingCount: pendingItems.length,
        itemsWithFilesCount,
        completionProgress
      };
    });
 
    return ResponseOk(res, 200, "Material Sets retrieved successfully", { materialSets: result });
  } catch (error) {
    console.error("[GetMaterialSetsOverview]", error);
    return ErrorHandler(res, 500, "Server error while retrieving material sets");
  }
};
const GetMaterialSetsByid = async (req, res) => {
  try {
    const { id } = req.query;
    const materialSets = await MaterialSet.findById(id).lean()
    // .populate('project_id', 'site_name')
    // .lean();

    // const vendors = await Vendor.find({}, 'company_name').lean();

    // const companyNames = vendors.map(v => v.company_name);
     const project_details = await Project.findById(materialSets.project_id)
              .select('_id site_name aggrement_no site_address')
              .lean();
        
            const responseData = {
              ...materialSets,
              project: project_details
            };

    return ResponseOk(res, 200, "Material Sets retrieved successfully",
      responseData,
    );
  } catch (error) {
    console.error("[GetMaterialSets]", error);
    return ErrorHandler(res, 500, "Server error while retrieving material sets");
  }
};

// const CopyMaterialSet = async (req, res) => {
//   try {
//     const { id } = req.query;

//     const existingMaterialSet = await MaterialSet.findById(id);
//     if (!existingMaterialSet) {
//       return ErrorHandler(res, 404, "Vender Order not found");
//     }

//     // Prepare material set data for new copy
//     const materialSetData = existingMaterialSet.toObject();
//     delete materialSetData._id;
//     delete materialSetData.createdAt;
//     delete materialSetData.updatedAt;

//     const baseName = existingMaterialSet.materialSetTitle;

//     // Find all material sets with similar name in the same project
//     const similarMaterialSets = await MaterialSet.find({
//       project_id: existingMaterialSet.project_id,
//       materialSetTitle: { $regex: `^${baseName}( Copy-\\d+)?$`, $options: 'i' }
//     });

//     let maxCopyNumber = 0;
//     similarMaterialSets.forEach(ms => {
//       const m = ms.materialSetTitle.match(/ Copy-(\d+)$/i);
//       if (m) {
//         const num = parseInt(m[1]);
//         if (num > maxCopyNumber) maxCopyNumber = num;
//       }
//     });

//     const newCopyNumber = maxCopyNumber + 1;
//     const newName = `${baseName} Copy-${String(newCopyNumber).padStart(2, '0')}`;
//     materialSetData.materialSetTitle = newName;

//     const newMaterialSet = await MaterialSet.create(materialSetData);

//     const user_details = await Users.findById(req.auth.id);
//     const projectDetails = await Project.findById(newMaterialSet.project_id).select('site_name');

//     await ActivityLog.create({
//       user_id: req.auth?.id || null,
//       user_name: user_details.name,
//       action: 'COPY_VENDER_ORDER',
//       type: 'Create',
//       description: `${user_details.name} copied vender order "${existingMaterialSet.materialSetTitle}" to a new set "${newMaterialSet.materialSetTitle}" in project "${projectDetails.site_name}".`,
//       title: 'Vender Order Copied',
//       project_id: newMaterialSet.project_id,
//     });

//     return ResponseOk(res, 201, "Vender Order copied successfully", newMaterialSet);

//   } catch (error) {
//     console.error("[CopyMaterialSet]", error);
//     return ErrorHandler(res, 500, "Failed to copy Vender Order");
//   }
// };


const CopyMaterialSet = async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) return ErrorHandler(res, 400, "Missing query parameter: id");
    if (!mongoose.Types.ObjectId.isValid(id)) return ErrorHandler(res, 400, "Invalid id");

    const existingMaterialSet = await MaterialSet.findById(id).lean();
    if (!existingMaterialSet) return ErrorHandler(res, 404, "Vender Order not found");

    // Deep-clone the vendorOrderList but strip _id fields from subdocs so mongoose will create new ones
    const clonedVendorOrderList = (existingMaterialSet.vendorOrderList || []).map(item => {
      const cloned = {
        partName: item.partName,
        brandName: item.brandName,
        orderDetailsWithQty: item.orderDetailsWithQty,
        received: item.received,
        receivedDate: item.receivedDate,
        requireDate: item.requireDate,
        orderDate: item.orderDate,
        remarks: item.remarks,
        color: item.color,
        height: item.height,
        vision: item.vision,
        overload: item.overload,
        meter: item.meter,
        // clone files but strip any _id
        files: Array.isArray(item.files)
          ? item.files.map(f => ({ fileType: f.fileType, fileUrl: f.fileUrl }))
          : []
      };
      return cloned;
    });

    // Build new material set object based on existing, but remove top-level _id/timestamps and replace vendorOrderList
    const materialSetData = {
      ...existingMaterialSet,
      vendorOrderList: clonedVendorOrderList
    };
    delete materialSetData._id;
    delete materialSetData.createdAt;
    delete materialSetData.updatedAt;

    // Prepare new title as Copy-XX
    const baseName = existingMaterialSet.materialSetTitle || "Material Set";
    const similarMaterialSets = await MaterialSet.find({
      project_id: existingMaterialSet.project_id,
      materialSetTitle: { $regex: `^${escapeRegex(baseName)}( Copy-\\d+)?$`, $options: 'i' }
    }).select("materialSetTitle").lean();

    let maxCopyNumber = 0;
    similarMaterialSets.forEach(ms => {
      const m = (ms.materialSetTitle || "").match(/ Copy-(\d+)$/i);
      if (m) {
        const num = parseInt(m[1], 10);
        if (!Number.isNaN(num) && num > maxCopyNumber) maxCopyNumber = num;
      }
    });

    const newCopyNumber = maxCopyNumber + 1;
    materialSetData.materialSetTitle = `${baseName} Copy-${String(newCopyNumber).padStart(2, '0')}`;

    // Ensure project_id remains the same; you can override by sending project_id in query/body if you want (optional)
    // If you want to allow overriding, uncomment:
    // if (req.body.project_id) materialSetData.project_id = req.body.project_id;

    // Create the new material set
    const newMaterialSet = await MaterialSet.create(materialSetData);

    // Activity log
    const user_details = await Users.findById(req.auth?.id);
    const projectDetails = await Project.findById(newMaterialSet.project_id).select('site_name');

    await ActivityLog.create({
      user_id: req.auth?.id || null,
      user_name: user_details?.name || "",
      action: 'COPY_VENDER_ORDER',
      type: 'Create',
      description: `${user_details?.name || "Someone"} copied vender order "${existingMaterialSet.materialSetTitle}" to "${newMaterialSet.materialSetTitle}" in project "${projectDetails?.site_name || ''}".`,
      title: 'Vender Order Copied',
      project_id: newMaterialSet.project_id,
    });

    return ResponseOk(res, 201, "Vender Order copied successfully", newMaterialSet);
  } catch (error) {
    console.error("[CopyMaterialSet]", error);
    return ErrorHandler(res, 500, "Failed to copy Vender Order");
  }
};

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const GetVendorOrdersList = async (req, res) => {
  try {
    const { project_id, date } = req.query;
    console.log("Incoming Query:", req.query);

    let filter = {};
    if (project_id) {
      if (!mongoose.Types.ObjectId.isValid(project_id)) {
        return ErrorHandler(res, 400, "Invalid project_id format");
      }
      filter.project_id = new mongoose.Types.ObjectId(project_id);
    }

    let targetDate;
    if (date) {
      targetDate = new Date(`${date}T00:00:00.000Z`);
    } else {
      targetDate = new Date();
      targetDate.setHours(0, 0, 0, 0);
    }

    const nextDay = new Date(targetDate);
    nextDay.setDate(nextDay.getDate() + 1);

    const materialSets = await MaterialSet.find(filter)
      .select(" _id materialSetTitle project_id createdAt vendorOrderList")
      .sort({ createdAt: -1 })
      .lean();

    if (!materialSets || materialSets.length === 0) {
      return ErrorHandler(res, 200, "No vendor orders found");
    }

    const projectIds = materialSets.map(ms => ms.project_id);
    const projects = await Project.find({ _id: { $in: projectIds } })
      .select("_id site_name")
      .lean();

    const projectMap = projects.reduce((acc, p) => {
      acc[p._id.toString()] = p.site_name;
      return acc;
    }, {});

    const projectList = [];

    for (const ms of materialSets) {
      const projectName = projectMap[ms.project_id.toString()] || "Unknown Project";

      const filteredItems = (ms.vendorOrderList || []).filter(item => {
        const reqDate = new Date(item.requireDate);
        return reqDate >= targetDate && reqDate < nextDay;
      });

      if (filteredItems.length > 0) {
        let projectEntry = projectList.find(p => p.projectName === projectName);
       if (!projectEntry) {
          projectEntry = { 
            projectName, 
            projectId: ms.project_id,  
            items: [] 
          };
          projectList.push(projectEntry);
        }


        filteredItems.forEach(item => {
            projectEntry.items.push({
            materialSetId: ms._id,
            itemName: item.partName,
            vendorOrderTitle: ms.materialSetTitle,
            requireDate: item.requireDate,
            orderDate: item.orderDate,
            received: item.received ? "Yes" : "No",
            brandName: item.brandName,
            orderDetailsWithQty: item.orderDetailsWithQty,
            remarks: item.remarks || ""
          });
        });
      }
    }

    if (projectList.length === 0) {
      return ErrorHandler(res, 200, "No items found for given date");
    }

    return ResponseOk(res, 200, "Vendor Orders retrieved successfully", { projects: projectList });
  } catch (error) {
    console.error("[GetVendorOrdersList]", error);
    return ErrorHandler(res, 500, "Server error while retrieving vendor orders");
  }
};

const AddVendor = async (req, res) => {
  try {
    const { name, company_name, mobile_number } = req.body;

    if (!name || !company_name) {
      return ErrorHandler(res, 400, "All required fields must be provided");
    }

    console.log("name", name);
    console.log("company_name", company_name);

    const existingVendor = await Vendor.findOne({ company_name });
    if (existingVendor) {
      return ErrorHandler(res, 400, "Vendor with this company name already exists");
    }

    const newVendor = await Vendor.create({
      name,
      company_name,
      mobile_number
    });

    const user_details = await Users.findById(req.auth.id);
    await ActivityLog.create({
      user_id: req.auth?.id || null,
      user_name: user_details.name,
      action: 'ADD_VENDOR',
      type: 'Create',
      description: `${user_details.name} has added vendor ${name}.`,
      title: 'Add Vendor',
      project_id: null,
    });
    return ResponseOk(res, 201, "Vendor added successfully", newVendor);
  } catch (error) {
    console.error("Error:", error);
    return ErrorHandler(res, 500, "Server error while adding Vendor");
  }
}

const UpdateVendor = async (req, res) => {
  try {
    const id = req.query.id;
    const { name, company_name, mobile_number } = req.body;
    if (!name || !company_name || !mobile_number) {
      return ErrorHandler(res, 400, "All required fields must be provided");
    }
    const existingVendor = await Vendor.findById(id);
    if (!existingVendor) {
      return ErrorHandler(res, 404, "Vendor not found");
    }
    existingVendor.name = name;
    existingVendor.company_name = company_name;
    existingVendor.mobile_number = mobile_number;
    const updatedVendor = await existingVendor.save();

    const user_details = await Users.findById(req.auth.id);
    await ActivityLog.create({
      user_id: req.auth?.id || null,
      user_name: user_details.name,
      action: 'UPDATE_VENDOR',
      type: 'Update',
      description: `${user_details.name} has update vendor ${name}.`,
      title: 'Update Vendor',
      project_id: null,
    });

    return ResponseOk(res, 200, "Vendor updated successfully", updatedVendor);
  } catch (error) {
    console.error("[UpdateVendor]", error);
    return ErrorHandler(res, 500, "Server error while updating vendor");
  }
};

const GetVendor = async (req, res) => {
  try {
    const vendors = await Vendor.find().lean().sort({ createdAt: -1 });
    return ResponseOk(res, 200, "Vendors retrieved successfully", vendors);
  } catch (error) {

    console.error("[GetVendor]", error);
    return ErrorHandler(res, 500, "Server error while retrieving vendors");
  }
};

const DeleteVendor = async (req, res) => {
  try {
    const { id } = req.query;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return ErrorHandler(res, 400, "Invalid vendor ID");
    }
    const existingVendor = await Vendor.findById(id);
    const deletedVendor = await Vendor.findByIdAndDelete(id);
    if (!deletedVendor) {
      return ErrorHandler(res, 404, "Vendor not found");
    }
    const user_details = await Users.findById(req.auth.id);
    await ActivityLog.create({
      user_id: req.auth?.id || null,
      user_name: user_details.name,
      action: 'DELETE_VENDOR',
      type: 'Delete',
      description: `${user_details.name} has deleted vendor ${existingVendor.name}.`,
      title: 'Delete Vendor',
      project_id: null,
    });

    return ResponseOk(res, 200, "Vendor deleted successfully", deletedVendor);
  } catch (error) {
    console.error("[DeleteVendor]", error);
    return ErrorHandler(res, 500, "Server error while deleting vendor");
  }
};

const GetVendorById = async (req, res) => {
  try {
    const vendors = await Vendor.findById(req.query.id);
    return ResponseOk(res, 200, "Vendors retrieved successfully", vendors);
  } catch (error) {

    console.error("[GetVendor]", error);
    return ErrorHandler(res, 500, "Server error while retrieving vendors");
  }
};

module.exports = {
  CreateMaterialSet,
  UpdateMaterialSet,
  DeleteMaterialSet,
  GetMaterialSets,
  GetMaterialSetsByid,
  GetMaterialSetsOverview,
  AddVendor,
  GetVendor,
  UpdateVendor,
  DeleteVendor,
  GetVendorById,
  CopyMaterialSet,
  GetVendorOrdersList
}
