import { redirect } from "next/navigation";

// /payroll itself has no content of its own (same as /hr, which also
// has no bare index page) -- this exists only as a safety net for a
// bookmarked/typed/linked bare "/payroll" URL, which otherwise 404s
// even for a real payroll-role user (confirmed live, 2026-09-28,
// logging in as an actual 'payroll'-role employee). Salary is the
// first thing Payroll actually works from, so that's where this sends
// people -- same choice app/login/page.tsx's own role redirect makes.
export default function PayrollIndexPage() {
  redirect("/payroll/salary");
}
