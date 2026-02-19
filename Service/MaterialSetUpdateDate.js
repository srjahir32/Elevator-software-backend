const { ErrorHandler, ResponseOk } = require("../Utils/ResponseHandler");
const mongoose = require("mongoose");
const { MaterialSet } = require("../Models/Project.model");
const { Vendor } = require("../Models/Project.model");
const { ActivityLog } = require("../Models/Activitylog.model");
const { Project } = require("../Models/Project.model");
const { Users } = require("../Models/User.model");
const fs = require("fs");
const path = require("path");

const checkandUpdateMeterialsetData = async () => {
    try {
      const materialSets = await MaterialSet.find({});
      if (!materialSets || materialSets.length === 0) {
        return {
          message: "No material sets found",
          totalMaterialSetsChecked: 0,
          totalMaterialSetsUpdated: 0,
          totalVendorOrdersUpdated: 0
        };
      }
  
      const isSameDay = (d1, d2) => {
        if (!d1 || !d2) return false;
        const a = new Date(d1);
        const b = new Date(d2);
        return (
          a.getFullYear() === b.getFullYear() &&
          a.getMonth() === b.getMonth() &&
          a.getDate() === b.getDate()
        );
      };
  
      const today = new Date();
      const todayMidnight = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate()
      );
  
      let totalMaterialSetsChecked = 0;
      let totalVendorOrdersUpdated = 0;
      let totalMaterialSetsUpdated = 0;
  
      for (const materialSet of materialSets) {
        totalMaterialSetsChecked++;
        let modified = false;
  
        const vendorOrderList = Array.isArray(materialSet.vendorOrderList)
          ? materialSet.vendorOrderList
          : [];
  
        for (let i = 0; i < vendorOrderList.length; i++) {
          const vendorOrder = vendorOrderList[i];
  
          if (vendorOrder && vendorOrder.received === false) {
            const receivedDate = vendorOrder.receivedDate
              ? new Date(vendorOrder.receivedDate)
              : null;
  
            if (!isSameDay(receivedDate, todayMidnight)) {
              vendorOrder.receivedDate = new Date();
  
              modified = true;
              totalVendorOrdersUpdated++;
            }
          }
        }
  
        if (modified) {
          await materialSet.save();
          totalMaterialSetsUpdated++;
        }
      }
  
      return {
        message: "Material set receivedDate check/update completed",
        totalMaterialSetsChecked,
        totalMaterialSetsUpdated,
        totalVendorOrdersUpdated
      };
    } catch (error) {
      console.error("Error checking and updating material set date:", error);
      throw error;
    }
  };
  
  

module.exports = checkandUpdateMeterialsetData;
