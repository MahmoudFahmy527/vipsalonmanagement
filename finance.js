/**
 * Profit & Loss + per-staff profitability.
 *
 * Revenue  = booking revenue (accepted bookings, computed live) + manual income.
 * Labor    = each staff member's pay: optional commission (% of their revenue)
 *            + salary (hourly/daily/monthly, prorated over the range).
 * Expenses = the expenses table (rent, supplies, gov fees like iqama/insurance).
 *            Salary/commission are NOT stored there — they're computed here — so
 *            nothing is double-counted.
 * Net profit = revenue − labor − expenses.
 *
 * Per staff: profit contributed = their revenue − (their pay + their gov/other
 * expenses from the expenses table).
 */

function daysBetween(from, to) {
  if (!from || !to) return 30; // sane default when unbounded
  const a = new Date(from + 'T00:00:00');
  const b = new Date(to + 'T00:00:00');
  const d = Math.round((b - a) / 86400000) + 1; // inclusive
  return d > 0 ? d : 1;
}

function salaryForRange(barber, hours, days) {
  const amt = Number(barber.salary_amount) || 0;
  switch (barber.salary_type) {
    case 'hourly': return amt * hours;
    case 'daily': return amt * days;
    case 'monthly': return amt * (days / 30); // prorated
    default: return 0;
  }
}

function computeSummary(db, { from, to, branchId } = {}) {
  const days = daysBetween(from, to);

  const bookingRev = db.bookingRevenue(from, to, branchId);
  const manualInc = db.sumIncome(from, to, branchId);
  const revenueTotal = bookingRev + manualInc;

  const expensesTable = db.sumExpenses(from, to, branchId);
  const byCategory = db.expensesByCategory(from, to, branchId);

  // Per-barber profitability
  const barbers = db.getActiveBarbers(branchId);
  let laborCost = 0;
  const byBarber = barbers.map((b) => {
    const revenue = db.bookingRevenue(from, to, branchId, b.id);
    const hours = db.barberServiceHours(b.id, from, to);
    const count = db.acceptedBookingCount(b.id, from, to);
    const commission = b.commission_enabled ? revenue * (Number(b.commission_pct) || 0) / 100 : 0;
    const salary = salaryForRange(b, hours, days);
    const pay = commission + salary;
    const govExpenses = db.sumExpensesByBarber(b.id, from, to);
    const cost = pay + govExpenses;
    laborCost += pay;
    return {
      id: b.id, name: b.name,
      revenue: round(revenue), hours: round(hours), count,
      commission_enabled: !!b.commission_enabled, commission_pct: Number(b.commission_pct) || 0,
      salary_type: b.salary_type || 'none',
      commission: round(commission), salary: round(salary), pay: round(pay),
      govExpenses: round(govExpenses), cost: round(cost), profit: round(revenue - cost),
    };
  });

  const totalExpenses = laborCost + expensesTable;
  const netProfit = revenueTotal - totalExpenses;

  return {
    range: { from: from || null, to: to || null, days },
    revenue: { bookings: round(bookingRev), manual: round(manualInc), total: round(revenueTotal) },
    expenses: { labor: round(laborCost), other: round(expensesTable), total: round(totalExpenses), byCategory },
    netProfit: round(netProfit),
    margin: revenueTotal > 0 ? round((netProfit / revenueTotal) * 100) : 0,
    byBarber,
  };
}

// One staff member's own earnings breakdown for a range (used by the staff portal).
function computeBarber(db, barberId, { from, to, branchId } = {}) {
  const b = db.getBarber(Number(barberId));
  if (!b) return null;
  const days = daysBetween(from, to);
  const revenue = db.bookingRevenue(from, to, branchId, b.id);
  const hours = db.barberServiceHours(b.id, from, to);
  const count = db.acceptedBookingCount(b.id, from, to);
  const commission = b.commission_enabled ? revenue * (Number(b.commission_pct) || 0) / 100 : 0;
  const salary = salaryForRange(b, hours, days);
  const pay = commission + salary;
  const govExpenses = db.sumExpensesByBarber(b.id, from, to);
  return {
    id: b.id, name: b.name,
    range: { from: from || null, to: to || null, days },
    revenue: round(revenue), hours: round(hours), count,
    commission_enabled: !!b.commission_enabled, commission_pct: Number(b.commission_pct) || 0,
    salary_type: b.salary_type || 'none', salary_amount: Number(b.salary_amount) || 0,
    commission: round(commission), salary: round(salary),
    earnings: round(pay),           // what the staff member takes home (commission + salary)
    govExpenses: round(govExpenses), // deductions like iqama/insurance recorded against them
  };
}

function round(n) { return Math.round((Number(n) || 0) * 100) / 100; }

module.exports = { computeSummary, computeBarber, salaryForRange, daysBetween };
