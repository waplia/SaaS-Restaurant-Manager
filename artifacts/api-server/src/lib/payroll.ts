/**
 * Pure payroll calculation engine.
 *
 * Inputs are deliberately plain objects (no DB queries inside) so this is
 * unit-testable. The route layer is responsible for fetching the rows and
 * shaping them into the structures defined here.
 */

export type SalaryType = "fixed_monthly" | "daily_wage" | "hourly_wage" | "commission" | "custom";

export interface CalcSalaryStructure {
  type: SalaryType;
  baseAmount: string | null;
  hourlyRate: string | null;
  dailyRate: string | null;
  commissionRate: string | null;
  commissionBase: string | null;
  currency: string;
  components: Array<{ name: string; amount: string; isRecurring: boolean; isTaxable: boolean }>;
}

export interface CalcAttendanceRow {
  status: string; // present | late | half_day | leave | absent | weekly_off
  workedMinutes: number;
  scheduledMinutes: number;
  lateMinutes: number;
  overtimeMinutes: number;
  leavePaid: boolean | null;
  leavePortion: string | null; // "1.00" | "0.50"
}

export interface CalcAdvance {
  id: number;
  amount: string;
  settledAmount: string;
}

export interface CalcAdjustment {
  kind: "bonus" | "deduction";
  amount: string;
  label: string;
}

export interface CalcInput {
  structure: CalcSalaryStructure | null;
  attendance: CalcAttendanceRow[];
  daysInMonth: number;
  advances: CalcAdvance[];
  adjustments: CalcAdjustment[];
  commissionSales?: string; // pre-computed; rupees
  commissionOrders?: number;
}

export interface CalcOutput {
  baseAmount: string;
  overtimeMinutes: number;
  overtimeAmount: string;
  attendanceDeduction: string;
  lateDeduction: string;
  leaveDeduction: string;
  bonus: string;
  otherDeductions: string;
  grossPay: string;
  advanceSettled: string;
  netPay: string;
  daysWorked: string;
  daysAbsent: string;
  daysPaidLeave: string;
  daysUnpaidLeave: string;
  workedMinutes: number;
  lateMinutes: number;
  earningsBreakdown: Array<{ label: string; amount: string }>;
  deductionsBreakdown: Array<{ label: string; amount: string }>;
}

const D2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const N = (s: string | null | undefined): number => {
  if (s == null || s === "") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Effective working-day count from the supplied attendance rows. We count
 * everything except explicit `weekly_off` as a "scheduled" day. If the
 * caller hasn't recorded enough rows, we fall back to ~26 working days/mo
 * (industry norm in India). This keeps a fixed_monthly slip sensible even
 * if attendance was never marked.
 */
function effectiveWorkingDays(rows: CalcAttendanceRow[], daysInMonth: number): number {
  const scheduled = rows.filter((r) => r.status !== "weekly_off").length;
  if (scheduled >= 20) return scheduled;
  return Math.max(20, Math.min(daysInMonth - 4, 26));
}

/**
 * Compute attendance summary in days (with half-day == 0.5).
 *
 * For payroll math we treat:
 *  - present, late => worked
 *  - half_day      => 0.5 worked, 0.5 absent (unless converted to leave)
 *  - leave         => paid or unpaid based on leavePaid
 *  - absent        => unpaid
 *  - weekly_off    => ignored
 */
function summariseAttendance(rows: CalcAttendanceRow[]) {
  let worked = 0;
  let absent = 0;
  let paidLeave = 0;
  let unpaidLeave = 0;
  let workedMinutes = 0;
  let overtimeMinutes = 0;
  let lateMinutes = 0;

  for (const r of rows) {
    workedMinutes += r.workedMinutes || 0;
    overtimeMinutes += r.overtimeMinutes || 0;
    lateMinutes += r.lateMinutes || 0;

    switch (r.status) {
      case "present":
      case "late":
        worked += 1;
        break;
      case "half_day":
        worked += 0.5;
        absent += 0.5;
        break;
      case "leave": {
        const portion = r.leavePortion ? Number(r.leavePortion) : 1;
        if (r.leavePaid) paidLeave += portion;
        else unpaidLeave += portion;
        if (portion < 1) worked += 1 - portion;
        break;
      }
      case "absent":
        absent += 1;
        break;
      case "weekly_off":
      default:
        break;
    }
  }
  return { worked, absent, paidLeave, unpaidLeave, workedMinutes, overtimeMinutes, lateMinutes };
}

/**
 * Compute a single staff member's payroll for one month.
 *
 * The function is pure. It never reads or writes the database.
 */
export function computePayroll(input: CalcInput): CalcOutput {
  const s = input.structure;
  const att = summariseAttendance(input.attendance);
  const workingDays = effectiveWorkingDays(input.attendance, input.daysInMonth);
  const earnings: Array<{ label: string; amount: string }> = [];
  const deductions: Array<{ label: string; amount: string }> = [];

  let baseAmount = 0;
  let attendanceDeduction = 0;
  let leaveDeduction = 0;

  if (s) {
    switch (s.type) {
      case "fixed_monthly": {
        const fullBase = N(s.baseAmount);
        baseAmount = fullBase;
        earnings.push({ label: "Basic (monthly)", amount: D2(fullBase) });
        // Unpaid days reduce gross pro-rata.
        const unpaidDays = att.absent + att.unpaidLeave;
        if (unpaidDays > 0 && workingDays > 0) {
          const perDay = fullBase / workingDays;
          attendanceDeduction = perDay * att.absent;
          leaveDeduction = perDay * att.unpaidLeave;
        }
        break;
      }
      case "daily_wage": {
        const rate = N(s.dailyRate);
        const payDays = att.worked + att.paidLeave;
        baseAmount = rate * payDays;
        earnings.push({ label: `Daily wage × ${D2(payDays)} d`, amount: D2(baseAmount) });
        break;
      }
      case "hourly_wage": {
        const rate = N(s.hourlyRate);
        const hours = att.workedMinutes / 60;
        baseAmount = rate * hours;
        earnings.push({ label: `Hourly × ${hours.toFixed(2)} h`, amount: D2(baseAmount) });
        break;
      }
      case "commission": {
        const rate = N(s.commissionRate); // percent
        const base = s.commissionBase === "orders"
          ? (input.commissionOrders ?? 0)
          : N(input.commissionSales);
        baseAmount = (rate / 100) * base;
        earnings.push({
          label: `Commission ${D2(rate)}% of ${s.commissionBase ?? "sales"}`,
          amount: D2(baseAmount),
        });
        break;
      }
      case "custom":
      default:
        // No base; all pay comes from components / adjustments.
        break;
    }
  }

  // Recurring salary components are added to gross.
  let componentTotal = 0;
  for (const c of s?.components ?? []) {
    if (!c.isRecurring) continue;
    const amt = N(c.amount);
    componentTotal += amt;
    earnings.push({ label: c.name, amount: D2(amt) });
  }

  // Overtime — best effort. Hourly rate preferred; otherwise derived from
  // monthly base assuming 8h × workingDays.
  let overtimeAmount = 0;
  if (att.overtimeMinutes > 0 && s) {
    let rate = N(s.hourlyRate);
    if (rate <= 0 && s.type === "fixed_monthly" && workingDays > 0) {
      rate = N(s.baseAmount) / (workingDays * 8);
    } else if (rate <= 0 && s.type === "daily_wage") {
      rate = N(s.dailyRate) / 8;
    }
    if (rate > 0) {
      overtimeAmount = (att.overtimeMinutes / 60) * rate;
      earnings.push({
        label: `Overtime (${(att.overtimeMinutes / 60).toFixed(2)} h)`,
        amount: D2(overtimeAmount),
      });
    }
  }

  // Bonuses & ad-hoc deductions for this month.
  let bonus = 0;
  let otherDeductions = 0;
  for (const a of input.adjustments) {
    const amt = N(a.amount);
    if (a.kind === "bonus") {
      bonus += amt;
      earnings.push({ label: a.label || "Bonus", amount: D2(amt) });
    } else {
      otherDeductions += amt;
      deductions.push({ label: a.label || "Deduction", amount: D2(amt) });
    }
  }

  if (attendanceDeduction > 0) deductions.push({ label: `Absent (${D2(att.absent)} d)`, amount: D2(attendanceDeduction) });
  if (leaveDeduction > 0) deductions.push({ label: `Unpaid leave (${D2(att.unpaidLeave)} d)`, amount: D2(leaveDeduction) });

  const grossPay = baseAmount + componentTotal + overtimeAmount + bonus
    - attendanceDeduction - leaveDeduction - otherDeductions;

  // Outstanding advances are auto-settled (capped at gross pay so we never
  // owe the staff member negative wages).
  const outstanding = input.advances.reduce(
    (acc, a) => acc + Math.max(0, N(a.amount) - N(a.settledAmount)),
    0,
  );
  const advanceSettled = Math.min(Math.max(0, grossPay), outstanding);
  if (advanceSettled > 0) {
    deductions.push({ label: "Advance recovery", amount: D2(advanceSettled) });
  }

  const netPay = grossPay - advanceSettled;

  return {
    baseAmount: D2(baseAmount + componentTotal),
    overtimeMinutes: att.overtimeMinutes,
    overtimeAmount: D2(overtimeAmount),
    attendanceDeduction: D2(attendanceDeduction),
    lateDeduction: "0.00",
    leaveDeduction: D2(leaveDeduction),
    bonus: D2(bonus),
    otherDeductions: D2(otherDeductions),
    grossPay: D2(grossPay),
    advanceSettled: D2(advanceSettled),
    netPay: D2(netPay),
    daysWorked: D2(att.worked),
    daysAbsent: D2(att.absent),
    daysPaidLeave: D2(att.paidLeave),
    daysUnpaidLeave: D2(att.unpaidLeave),
    workedMinutes: att.workedMinutes,
    lateMinutes: att.lateMinutes,
    earningsBreakdown: earnings,
    deductionsBreakdown: deductions,
  };
}

/**
 * Inclusive month bounds for a given (year, 1-based-month) in *local* server
 * time. Payroll periods are calendar months in restaurant-local timezone,
 * but we don't have per-restaurant TZ yet so server time is acceptable.
 */
export function monthBounds(year: number, month: number): { start: Date; end: Date; daysInMonth: number } {
  const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const end = new Date(year, month, 1, 0, 0, 0, 0);
  const daysInMonth = new Date(year, month, 0).getDate();
  return { start, end, daysInMonth };
}

/**
 * Format a money value (string from decimal column) as INR currency for
 * display in slips. We hardcode ₹ rather than per-restaurant currency to
 * match the rest of the platform — currency is captured on the structure
 * for the future.
 */
export function formatMoney(v: string | number | null | undefined, currency = "INR"): string {
  const n = typeof v === "string" ? Number(v) : (v ?? 0);
  if (!Number.isFinite(n)) return "₹0.00";
  const symbol = currency === "INR" ? "₹" : `${currency} `;
  return `${symbol}${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
