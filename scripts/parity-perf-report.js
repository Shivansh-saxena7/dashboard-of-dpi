#!/usr/bin/env node
// Admin Performance Report (2026-11-20) live parity, read-only: last full month's recycled count by the report's
// stint rule vs the System Health / Lead engine rule. Counts only; no names, no numbers.
//   npx supabase db query --remote --read-only -f scripts/perf-report-live.sql > <export>
//   node scripts/parity-perf-report.js --live <export>     (delete <export> afterwards)
const fs = require("fs");
const i = process.argv.indexOf("--live");
const file = i >= 0 ? process.argv[i + 1] : null;
if (!file) {
  console.error("usage: node scripts/parity-perf-report.js --live <export of scripts/perf-report-live.sql>");
  process.exit(2);
}
const raw = fs.readFileSync(file, "utf8");
const at = raw.indexOf('"j"');
if (at < 0) {
  console.error("parity-perf-report: no result in the export (the query failed?)");
  process.exit(2);
}
const s = raw.slice(raw.indexOf("{", at));
let d = 0, k = 0;
for (; k < s.length; k++) { if (s[k] === "{") d++; if (s[k] === "}") { d--; if (!d) break; } }
const J = JSON.parse(s.slice(0, k + 1));
const r = J.report;
const problems = [];
if (r.recycled_stints !== J.system_health_recycled) problems.push(`recycled: report rule ${r.recycled_stints} vs System Health rule ${J.system_health_recycled}`);
if (r.leads > r.stints) problems.push(`leads ${r.leads} > assignments ${r.stints}`);
console.log(`Month ${J.month}: ${r.leads} leads in ${r.stints} assignments, ${r.employees} employees`);
console.log(`Given as (leads): fresh ${r.fresh_leads}, recycled ${r.recycled_leads}, given back ${r.restored_leads}, by admin ${r.admin_given_leads}`);
console.log(`Recycled assignments: report rule ${r.recycled_stints}; System Health rule ${J.system_health_recycled}`);
if (problems.length) {
  console.error("parity-perf-report FAILED:\n  " + problems.join("\n  "));
  process.exit(1);
}
console.log("parity-perf-report: OK");
