const mongoose = require("mongoose");

const AMCRenewalSchema = new mongoose.Schema(
  {
    original_amc_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "amc",
      required: true,
    },
    renewed_amc_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "amc",
      required: true,
    },
    original_contract_number: { type: String, required: true },
    new_contract_number: { type: String, required: true },
    renewed_at: { type: Date, default: Date.now },
    renewed_by: { type: mongoose.Schema.Types.ObjectId, ref: "user", default: null },
  },
  { timestamps: true, versionKey: false }
);

AMCRenewalSchema.index({ original_amc_id: 1 });
AMCRenewalSchema.index({ renewed_amc_id: 1 });

const AMCRenewal = mongoose.model("amc_renewal", AMCRenewalSchema);
module.exports = { AMCRenewal };
