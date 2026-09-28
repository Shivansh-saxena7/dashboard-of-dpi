import { exportTableToPDF, ExportReportMeta, ExportRow } from "@/lib/exportTable";

// One thin wrapper around the same generic exportTable.ts engine every
// other report in this app uses (exportAttendanceReport.ts is the
// reference pattern) -- no new PDF logic here at all. A single shared
// column set serves both shapes: exportExpenseBillToPDF is just this
// same engine called with a one-row array (an individual expense's
// bill), exportExpenseConsolidatedToPDF calls it with many rows plus a
// synthetic TOTAL row appended -- same watermark, same branding either
// way, only the row count differs.

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  PAID: "Paid"
};

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  CASH: "Cash",
  UPI: "UPI",
  BANK_TRANSFER: "Bank Transfer",
  OTHER: "Other"
};

export interface ExpenseExportRow {
  source: "EMPLOYEE_SUBMITTED" | "OFFICE_DIRECT";
  employeeName: string | null;
  amount: number;
  expenseDate: string;
  description: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "PAID";
  paymentMethod: string | null;
  paymentReference: string | null;
}

export const EXPENSE_COLUMNS = [
  { key: "date", header: "Date", align: "left", width: 14 },
  { key: "who", header: "Employee / Office", align: "left", width: 20 },
  { key: "description", header: "Description", align: "left", width: 30 },
  { key: "amount", header: "Amount", align: "right", width: 14 },
  { key: "status", header: "Status", align: "center", width: 12 },
  { key: "paidVia", header: "Paid Via", align: "left", width: 22 }
] as const;

function buildExpenseRows(rows: ExpenseExportRow[]): ExportRow[] {
  return rows.map((r) => ({
    date: new Date(r.expenseDate).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" }),
    who: r.source === "OFFICE_DIRECT" ? "Office" : r.employeeName || "Unknown",
    description: r.description,
    amount: r.amount,
    status: STATUS_LABEL[r.status] || r.status,
    paidVia: r.paymentMethod
      ? `${PAYMENT_METHOD_LABEL[r.paymentMethod] || r.paymentMethod}${r.paymentReference ? ` (${r.paymentReference})` : ""}`
      : "—"
  }));
}

export async function exportExpenseBillToPDF(row: ExpenseExportRow, meta: ExportReportMeta) {
  await exportTableToPDF({
    reportTitle: "DPI Expense Bill",
    sheetName: "Expense",
    filenamePrefix: "payroll-expense-bill",
    columns: EXPENSE_COLUMNS,
    rows: buildExpenseRows([row]),
    meta
  });
}

export async function exportExpenseConsolidatedToPDF(rows: ExpenseExportRow[], meta: ExportReportMeta) {
  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  const exportRows = buildExpenseRows(rows);
  exportRows.push({ date: "", who: "", description: "TOTAL", amount: total, status: "", paidVia: "" });

  await exportTableToPDF({
    reportTitle: "DPI Expense Report",
    sheetName: "Expenses",
    filenamePrefix: "payroll-expense-consolidated",
    columns: EXPENSE_COLUMNS,
    rows: exportRows,
    meta
  });
}
