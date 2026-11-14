// A delete refused by a foreign key (Postgres 23503) in plain English (2026-11-14): which table still points at the
// row, e.g. "This employee still has records in company sim assignments." Pure, known-answer tested in
// scripts/check-result-save.js.

export function fkBlockingTable(message: string | null | undefined): string | null {
  const all = [...(message || "").matchAll(/on table "([a-z0-9_]+)"/gi)].map((m) => m[1]);
  // "update or delete on table "employees" violates foreign key constraint "..." on table "company_sim_assignments""
  return all.length >= 2 ? all[all.length - 1] : null;
}

export function deleteBlockedMessage(
  entity: "employee" | "candidate",
  error: { code?: string | null; message?: string | null } | null | undefined
): string | null {
  if (!error || error.code !== "23503") return null;
  const table = fkBlockingTable(error.message);
  const where = table ? table.replace(/_/g, " ") : "other parts of the system";
  return entity === "employee"
    ? `This employee still has records in ${where}. Deactivate the employee instead of deleting.`
    : `This candidate still has records in ${where}. Remove those first, then delete.`;
}
