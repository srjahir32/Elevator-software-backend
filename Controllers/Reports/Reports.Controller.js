const { PaymentEntry, Project } = require('../../Models/Project.model')
const { ErrorHandler, ResponseOk } = require("../../Utils/ResponseHandler");

const GetPaymentDataReport = async (req, res) => {
  try {
    const { year, month } = req.query;

    const startDate = new Date(`${year}-${month}-01`);
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + 1);

    const totalRevenue = await Project.aggregate([
      { $group: { _id: null, revenue: { $sum: "$payment_amount" } } }
    ]);
    const revenueAmount = totalRevenue[0]?.revenue || 0;

    const paymentsByDay = await PaymentEntry.aggregate([
      {
        $match: {
          date: { $gte: startDate, $lt: endDate }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: { $add: ["$date", 1000 * 60 * 60 * 5.5] } } 
          },
          received: { $sum: "$payment_Made" }
        }
      },
      {
        $project: {
          _id: 0,
          date: "$_id",
          received: 1
        }
      }
    ]);

    const monthNum = parseInt(month, 10);
    const daysInMonth = new Date(year, monthNum, 0).getDate();

    let report = [];
    let runningDue = revenueAmount;

    for (let day = 1; day <= daysInMonth; day++) {
      const displayMonth = String(monthNum).padStart(2, '0');
      const dayStr = `${year}-${displayMonth}-${String(day).padStart(2, '0')}`;

      const payment = paymentsByDay.find(p => p.date === dayStr);
      const received = payment?.received || 0;

      report.push({
        date: dayStr,
        revenue: revenueAmount, 
        received,
        due: runningDue - received
      });

      runningDue -= received; 
    }

    return ResponseOk(res, 200, "Payment report retrieved successfully", report);
  } catch (err) {
    console.log("error", err);
    return ErrorHandler(res, 500, "Server error while retrieving payment report");
  }
};

const GetYearlyPaymentReport = async (req, res) => {
  try {
    const { year } = req.query;
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    const totalRevenue = await Project.aggregate([
      { $group: { _id: null, revenue: { $sum: "$payment_amount" } } }
    ]);
    const revenueAmount = totalRevenue[0]?.revenue || 0;

    let report = [];
    let runningDue = revenueAmount;

    for (let monthIndex = 0; monthIndex < 12; monthIndex++) {
      const startDate = new Date(year, monthIndex, 1);
      const endDate = new Date(year, monthIndex + 1, 1);

      const paymentsByMonth = await PaymentEntry.aggregate([
        {
          $match: {
            date: { $gte: startDate, $lt: endDate }
          }
        },
        {
          $group: {
            _id: null,
            received: { $sum: "$payment_Made" }
          }
        }
      ]);

      const receivedAmount = paymentsByMonth[0]?.received || 0;

      report.push({
        month: months[monthIndex],
        revenue: revenueAmount,
        received: receivedAmount,
        due: runningDue - receivedAmount
      });

      runningDue -= receivedAmount;
    }

    return ResponseOk(res, 200, "Yearly payment report retrieved successfully", report);
  } catch (err) {
    console.error("error", err);
    return ErrorHandler(res, 500, "Server error while retrieving yearly payment report");
  }
};



module.exports = { GetPaymentDataReport, GetYearlyPaymentReport };