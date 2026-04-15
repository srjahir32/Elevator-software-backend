/**
 * Dashboard date helpers. Business TZ: Asia/Kolkata (IST).
 */

const TZ = "Asia/Kolkata";

/** @returns {string} YYYY-MM-DD in Asia/Kolkata for a JS Date */
function ymdInIST(date = new Date()) {
  return date.toLocaleDateString("en-CA", { timeZone: TZ });
}

/**
 * First and last calendar day (YYYY-MM-DD) of the month containing `ymd` (YYYY-MM-DD).
 */
function monthRangeStringsFromYmd(ymd) {
  const [yStr, mStr] = ymd.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const start = `${yStr}-${mStr}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${yStr}-${mStr}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

module.exports = {
  TZ,
  ymdInIST,
  monthRangeStringsFromYmd,
};
