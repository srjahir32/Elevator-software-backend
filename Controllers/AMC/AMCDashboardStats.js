const { AMC } = require("../../Models/AMC.model");
const { Complaint } = require("../../Models/Complaint.model");
const { Licensee } = require("../../Models/Licensee.model");
const { ymdInIST, monthRangeStringsFromYmd, TZ } = require("../../Utils/dashboardTime");

function parseISTStartOfDay(ymd) {
  return new Date(`${ymd}T00:00:00+05:30`);
}

function parseISTEndOfDay(ymd) {
  return new Date(`${ymd}T23:59:59.999+05:30`);
}

async function mongoDateKeys() {
  const rows = await AMC.aggregate([
    {
      $project: {
        _id: 0,
        todayKey: {
          $dateToString: { format: "%Y-%m-%d", date: "$$NOW", timezone: TZ },
        },
        tomorrowKey: {
          $dateToString: {
            format: "%Y-%m-%d",
            date: { $add: ["$$NOW", 86400000] },
            timezone: TZ,
          },
        },
        due30Key: {
          $dateToString: {
            format: "%Y-%m-%d",
            date: { $add: ["$$NOW", 2592000000] },
            timezone: TZ,
          },
        },
      },
    },
    { $limit: 1 },
  ]);
  const row = rows[0] || {};
  const fallbackToday = ymdInIST(new Date());
  return {
    todayKey: row.todayKey || fallbackToday,
    tomorrowKey: row.tomorrowKey || ymdInIST(new Date(Date.now() + 86400000)),
    due30Key: row.due30Key || ymdInIST(new Date(Date.now() + 30 * 86400000)),
  };
}

function serviceScheduledOnDayPipeline(amcMatch, dayKey) {
  return [
    { $match: amcMatch },
    { $unwind: { path: "$service_schedule", preserveNullAndEmptyArrays: false } },
    {
      $match: {
        "service_schedule.service_status": {
          $in: ["Pending", "In Progress", "Overdue"],
        },
        $expr: {
          $eq: [
            {
              $dateToString: {
                format: "%Y-%m-%d",
                date: "$service_schedule.scheduled_date",
                timezone: TZ,
              },
            },
            dayKey,
          ],
        },
      },
    },
    { $count: "n" },
  ];
}

/** Count service_schedule rows with scheduled_date in [monthStartStr, monthEndStr] (YYYY-MM-DD, IST). */
function serviceScheduledInMonthPipeline(amcMatch, monthStartStr, monthEndStr) {
  return [
    { $match: amcMatch },
    { $unwind: { path: "$service_schedule", preserveNullAndEmptyArrays: false } },
    {
      $match: {
        $expr: {
          $and: [
            {
              $gte: [
                {
                  $dateToString: {
                    format: "%Y-%m-%d",
                    date: "$service_schedule.scheduled_date",
                    timezone: TZ,
                  },
                },
                monthStartStr,
              ],
            },
            {
              $lte: [
                {
                  $dateToString: {
                    format: "%Y-%m-%d",
                    date: "$service_schedule.scheduled_date",
                    timezone: TZ,
                  },
                },
                monthEndStr,
              ],
            },
          ],
        },
      },
    },
    { $count: "n" },
  ];
}

/**
 * @param {Record<string, unknown>} amcMatch - branch filter
 * @param {unknown} complaintBranchFilter - branch_id for complaints (ObjectId, $in, or undefined = all)
 */
async function getLicenseeDashboardCounts(branchMatch, todayKey, monthStartStr, monthEndStr) {
  const todayStart = parseISTStartOfDay(todayKey);
  /** Only the current chain head per lift (not superseded by a renewal) */
  const currentOnly = { superseded_by_license_id: null };
  const [expiringToday, expiringThisMonth, overdue] = await Promise.all([
    Licensee.countDocuments({
      ...branchMatch,
      ...currentOnly,
      license_end_date: { $exists: true, $ne: null },
      $expr: {
        $eq: [
          { $dateToString: { format: "%Y-%m-%d", date: "$license_end_date", timezone: TZ } },
          todayKey,
        ],
      },
    }),
    Licensee.countDocuments({
      ...branchMatch,
      ...currentOnly,
      license_end_date: { $exists: true, $ne: null },
      $expr: {
        $and: [
          {
            $gte: [
              { $dateToString: { format: "%Y-%m-%d", date: "$license_end_date", timezone: TZ } },
              monthStartStr,
            ],
          },
          {
            $lte: [
              { $dateToString: { format: "%Y-%m-%d", date: "$license_end_date", timezone: TZ } },
              monthEndStr,
            ],
          },
        ],
      },
    }),
    Licensee.countDocuments({
      ...branchMatch,
      ...currentOnly,
      license_end_date: { $exists: true, $ne: null, $lt: todayStart },
    }),
  ]);
  return {
    licenseeExpiringToday: expiringToday,
    licenseeExpiringThisMonth: expiringThisMonth,
    licenseeOverdue: overdue,
  };
}

async function getComprehensiveAmcDashboard(amcMatch, complaintBranchFilter) {
  const { todayKey, tomorrowKey, due30Key } = await mongoDateKeys();
  const { start: monthStartStr, end: monthEndStr } = monthRangeStringsFromYmd(todayKey);

  const complaintOpenMatch = complaintBranchFilter
    ? { branch_id: complaintBranchFilter, status: { $in: ["Open", "In Progress"] } }
    : { status: { $in: ["Open", "In Progress"] } };

  const complaintAggMatch = complaintBranchFilter ? { branch_id: complaintBranchFilter } : {};

  const [
    svcToday,
    svcTomorrow,
    servicesInMonth,
    renewToday,
    renewMonth,
    renewalOverdue,
    renewalDueSoon,
    activeContracts,
    portfolioCount,
    revenueAgg,
    complaintAgg,
    complaintByStatus,
    complaintsThisMonthBreakdown,
    expiringSoonCount,
    amcsForPayments,
    amcServiceStatsAgg,
    amcComplaintStatsAgg,
    licenseeDash,
  ] = await Promise.all([
    AMC.aggregate(serviceScheduledOnDayPipeline(amcMatch, todayKey)),
    AMC.aggregate(serviceScheduledOnDayPipeline(amcMatch, tomorrowKey)),
    AMC.aggregate(serviceScheduledInMonthPipeline(amcMatch, monthStartStr, monthEndStr)),
    AMC.countDocuments({
      ...amcMatch,
      contract_status: "Active",
      contract_end_date: { $exists: true, $ne: null },
      $expr: {
        $eq: [
          { $dateToString: { format: "%Y-%m-%d", date: "$contract_end_date", timezone: TZ } },
          todayKey,
        ],
      },
    }),
    AMC.countDocuments({
      ...amcMatch,
      contract_status: "Active",
      contract_end_date: { $exists: true, $ne: null },
      $expr: {
        $and: [
          {
            $gte: [
              { $dateToString: { format: "%Y-%m-%d", date: "$contract_end_date", timezone: TZ } },
              monthStartStr,
            ],
          },
          {
            $lte: [
              { $dateToString: { format: "%Y-%m-%d", date: "$contract_end_date", timezone: TZ } },
              monthEndStr,
            ],
          },
        ],
      },
    }),
    AMC.countDocuments({
      ...amcMatch,
      contract_status: "Active",
      contract_end_date: { $exists: true, $ne: null, $lt: parseISTStartOfDay(todayKey) },
    }),
    AMC.countDocuments({
      ...amcMatch,
      contract_status: "Active",
      contract_end_date: { $exists: true, $ne: null },
      $expr: {
        $and: [
          {
            $gte: [
              { $dateToString: { format: "%Y-%m-%d", date: "$contract_end_date", timezone: TZ } },
              todayKey,
            ],
          },
          {
            $lte: [
              { $dateToString: { format: "%Y-%m-%d", date: "$contract_end_date", timezone: TZ } },
              due30Key,
            ],
          },
        ],
      },
    }),
    AMC.countDocuments({
      ...amcMatch,
      contract_status: "Active",
      contract_end_date: { $gte: parseISTStartOfDay(todayKey) },
    }),
    AMC.countDocuments({
      ...amcMatch,
      contract_status: { $nin: ["Cancelled", "Draft"] },
    }),
    AMC.aggregate([
      {
        $match: {
          ...amcMatch,
          contract_status: "Active",
          contract_end_date: { $gte: parseISTStartOfDay(todayKey) },
        },
      },
      { $group: { _id: null, total: { $sum: { $ifNull: ["$total_amount", 0] } } } },
    ]),
    Complaint.countDocuments(complaintOpenMatch),
    Complaint.aggregate([
      { $match: complaintAggMatch },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    (async () => {
      const match = {
        createdAt: {
          $gte: parseISTStartOfDay(monthStartStr),
          $lte: parseISTEndOfDay(monthEndStr),
        },
      };
      if (complaintBranchFilter !== undefined && complaintBranchFilter !== null) {
        match.branch_id = complaintBranchFilter;
      }
      const rows = await Complaint.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            open: {
              $sum: {
                $cond: [{ $in: ["$status", ["Open", "In Progress"]] }, 1, 0],
              },
            },
            closed: {
              $sum: {
                $cond: [{ $in: ["$status", ["Resolved", "Closed"]] }, 1, 0],
              },
            },
          },
        },
      ]);
      const r = rows[0] || {};
      return {
        total: r.total || 0,
        open: r.open || 0,
        closed: r.closed || 0,
      };
    })(),
    (async () => {
      const today = parseISTStartOfDay(todayKey);
      const windowEnd = new Date(today);
      windowEnd.setDate(windowEnd.getDate() + 30);
      return AMC.countDocuments({
        ...amcMatch,
        contract_status: "Active",
        contract_end_date: { $gt: today, $lte: windowEnd },
      });
    })(),
    AMC.find(
      { ...amcMatch, "payment_schedule.paid_date": { $exists: true } },
      { payment_schedule: 1 }
    ).lean(),
    AMC.aggregate([
      { $match: amcMatch },
      { $unwind: { path: "$service_schedule", preserveNullAndEmptyArrays: false } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          completed: {
            $sum: {
              $cond: [{ $eq: ["$service_schedule.service_status", "Completed"] }, 1, 0],
            },
          },
          pending: {
            $sum: {
              $cond: [{ $ne: ["$service_schedule.service_status", "Completed"] }, 1, 0],
            },
          },
        },
      },
    ]),
    (async () => {
      const qAll = complaintBranchFilter ? { branch_id: complaintBranchFilter } : {};
      const qToday = {
        ...qAll,
        createdAt: { $gte: parseISTStartOfDay(todayKey), $lte: parseISTEndOfDay(todayKey) },
      };
      const [total, today, resolved] = await Promise.all([
        Complaint.countDocuments(qAll),
        Complaint.countDocuments(qToday),
        Complaint.countDocuments({ ...qAll, status: { $in: ["Resolved", "Closed"] } }),
      ]);
      return { total, today, resolved };
    })(),
    getLicenseeDashboardCounts(amcMatch, todayKey, monthStartStr, monthEndStr),
  ]);

  const serviceAllCounts = amcServiceStatsAgg[0] || { total: 0, completed: 0, pending: 0 };
  const complaintStats = amcComplaintStatsAgg || { total: 0, today: 0, resolved: 0 };

  const istNow = new Date();
  const startOfMonth = new Date(istNow.toLocaleString("en-US", { timeZone: TZ }));
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const endOfMonth = new Date(startOfMonth);
  endOfMonth.setMonth(endOfMonth.getMonth() + 1);
  endOfMonth.setMilliseconds(-1);

  const startOfYear = new Date(istNow.toLocaleString("en-US", { timeZone: TZ }));
  startOfYear.setMonth(0, 1);
  startOfYear.setHours(0, 0, 0, 0);
  const endOfToday = new Date(istNow.toLocaleString("en-US", { timeZone: TZ }));
  endOfToday.setHours(23, 59, 59, 999);

  let monthlyRevenue = 0;
  let yearlyRevenue = 0;
  for (const amc of amcsForPayments || []) {
    for (const p of amc.payment_schedule || []) {
      if (p.payment_status === "Paid" && p.paid_date) {
        const d = new Date(p.paid_date);
        if (d >= startOfMonth && d <= endOfMonth) {
          monthlyRevenue += p.amount || 0;
        }
        if (d >= startOfYear && d <= endOfToday) {
          yearlyRevenue += p.amount || 0;
        }
      }
    }
  }

  const complaintStatusMap = {};
  (complaintByStatus || []).forEach((r) => {
    complaintStatusMap[r._id] = r.count;
  });

  const cMonth = complaintsThisMonthBreakdown || { total: 0, open: 0, closed: 0 };

  const revenueBooked = revenueAgg[0]?.total || 0;

  const charts = await buildCharts(amcMatch, complaintBranchFilter, todayKey);

  return {
    timezone: TZ,
    dateKeys: { today: todayKey, tomorrow: tomorrowKey, monthStart: monthStartStr, monthEnd: monthEndStr },
    ...licenseeDash,
    servicesDueToday: svcToday[0]?.n || 0,
    servicesDueTomorrow: svcTomorrow[0]?.n || 0,
    servicesScheduledThisMonth: servicesInMonth[0]?.n || 0,
    renewalsToday: renewToday,
    renewalsThisMonth: renewMonth,
    renewalOverdue,
    renewalDueSoon,
    complaintsOpenOrInProgress: complaintAgg,
    complaintsThisMonth: cMonth.total,
    complaintsThisMonthOpen: cMonth.open,
    complaintsThisMonthClosed: cMonth.closed,
    complaintsByStatus: complaintStatusMap,
    activeAMCCount: activeContracts,
    totalAmcProjectsNonCancelled: portfolioCount,
    totalAmcRevenueBooked: revenueBooked,
    monthlyRevenue,
    yearlyRevenue,
    expiringSoonCount,
    allServicesCount: serviceAllCounts.total,
    completedServicesCount: serviceAllCounts.completed,
    pendingServicesCount: serviceAllCounts.pending,
    totalComplaintsCount: complaintStats.total,
    todaysComplaintsCount: complaintStats.today,
    resolvedComplaintsCount: complaintStats.resolved,
    charts,
  };
}

async function buildCharts(amcMatch, complaintBranchFilter, todayKey) {
  const months = [];
  const [y0, m0] = todayKey.split("-").map(Number);
  const anchor = new Date(y0, m0 - 1, 1);
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(anchor.getFullYear(), anchor.getMonth() - i, 1);
    months.push({
      label: `${d.toLocaleString("en", { month: "short" })} ${d.getFullYear()}`,
      start: new Date(d.getFullYear(), d.getMonth(), 1),
      end: new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999),
    });
  }

  const revenueByMonth = await Promise.all(
    months.map(async (mo) => {
      const docs = await AMC.find(
        {
          ...amcMatch,
          "payment_schedule.paid_date": { $gte: mo.start, $lte: mo.end },
        },
        { payment_schedule: 1 }
      ).lean();
      let sum = 0;
      for (const amc of docs) {
        for (const p of amc.payment_schedule || []) {
          if (p.payment_status === "Paid" && p.paid_date) {
            const pd = new Date(p.paid_date);
            if (pd >= mo.start && pd <= mo.end) sum += p.amount || 0;
          }
        }
      }
      return { label: mo.label, value: sum };
    })
  );

  const complaintsByMonth = await Promise.all(
    months.map(async (mo) => {
      const q = {
        createdAt: { $gte: mo.start, $lte: mo.end },
      };
      if (complaintBranchFilter) q.branch_id = complaintBranchFilter;
      const n = await Complaint.countDocuments(q);
      return { label: mo.label, value: n };
    })
  );

  const amcGrowthByMonth = await Promise.all(
    months.map(async (mo) => {
      const n = await AMC.countDocuments({
        ...amcMatch,
        createdAt: { $gte: mo.start, $lte: mo.end },
      });
      return { label: mo.label, value: n };
    })
  );

  return { revenueByMonth, complaintsByMonth, amcGrowthByMonth };
}

function serviceDueMatchExpr(dayKey) {
  return {
    $gt: [
      {
        $size: {
          $filter: {
            input: { $ifNull: ["$service_schedule", []] },
            as: "s",
            cond: {
              $and: [
                {
                  $in: [
                    "$$s.service_status",
                    ["Pending", "In Progress", "Overdue"],
                  ],
                },
                {
                  $eq: [
                    {
                      $dateToString: {
                        format: "%Y-%m-%d",
                        date: "$$s.scheduled_date",
                        timezone: TZ,
                      },
                    },
                    dayKey,
                  ],
                },
              ],
            },
          },
        },
      },
      0,
    ],
  };
}

function wrapMatchWithServiceDue(matchStage, dayKey) {
  const exprWrap = { $expr: serviceDueMatchExpr(dayKey) };
  if (!matchStage || Object.keys(matchStage).length === 0) {
    return exprWrap;
  }
  if (matchStage.$or) {
    const { $or, ...rest } = matchStage;
    const parts = [{ $or }];
    if (Object.keys(rest).length) parts.push(rest);
    parts.push(exprWrap);
    return { $and: parts };
  }
  return { $and: [matchStage, exprWrap] };
}

module.exports = {
  getComprehensiveAmcDashboard,
  getLicenseeDashboardCounts,
  parseISTStartOfDay,
  parseISTEndOfDay,
  mongoDateKeys,
  wrapMatchWithServiceDue,
};
