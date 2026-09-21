#!/usr/bin/env node

// Guards against the exact bug class that independently broke three
// separate things (app/admin/leads/page.tsx, backup-to-google-sheets,
// import-leads-csv) before being caught: PostgREST silently caps any
// single response at 1000 rows, so a `supabase.from(largeTable).select(...)`
// with no `.range()`/`.limit()`/`.single()`/`.maybeSingle()` — and not
// routed through lib/fetchAllRows.ts — silently truncates once that table
// crosses 1000 rows. See CLAUDE.md's "Unbounded-query rule" for the full
// writeup.
//
// Deliberately a hand-maintained grep, not a real AST-aware lint rule —
// see CLAUDE.md for why a full Supabase-aware ESLint rule was judged
// over-engineering for this team's scale. This will have false positives
// on legitimately-safe queries the window doesn't happen to catch a
// marker near; that's an acceptable tradeoff for something this cheap to
// run and maintain. Add a table to LARGE_TABLES below as soon as it's
// realistically going to cross 1000 rows.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SCAN_DIRS = ["app", "components", "lib", "supabase/functions"];
const BASELINE_PATH = path.join(__dirname, "unbounded-queries-baseline.json");

// Tables that can realistically grow past PostgREST's 1000-row cap.
// Keep this list current — a table that's small today but will
// genuinely accumulate rows (a new audit/log table, a new import
// source) belongs here as soon as that's foreseeable, not once it's
// already been bitten.
const LARGE_TABLES = ["leads", "lead_history", "lead_notes", "site_visits", "tracking", "csv_import_batches"];

// Any of these appearing near a match is treated as "this query is
// bounded/paginated" and clears the flag. `head: true` is included
// because a head request never returns row data at all (only a count
// via the Content-Range header) — it isn't subject to the row cap
// this check exists for.
const SAFETY_MARKERS = [".range(", ".limit(", "fetchAllRows(", ".single(", ".maybeSingle(", "head: true", "head:true"];

const WINDOW_BEFORE = 6;
const WINDOW_AFTER = 25;

const FROM_PATTERN = new RegExp(`\\.from\\(\\s*["'](${LARGE_TABLES.join("|")})["']\\s*\\)`);

// Plain writes (.insert/.update/.delete with no chained .select()) don't
// carry the multi-row-read-truncation risk this check exists for — the
// 1000-row cap is specifically a SELECT-response thing. Only a `.from(...)`
// whose nearby window contains `.select(` is flagged.
function isReadQuery(window) {
  return window.includes(".select(");
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return new Set();
  const raw = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
  return new Set(raw.map((e) => `${e.file}:${e.line}`));
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

function checkFile(filePath) {
  const lines = fs.readFileSync(filePath, "utf8").split("\n");
  const findings = [];

  lines.forEach((line, idx) => {
    const match = line.match(FROM_PATTERN);
    if (!match) return;

    const windowStart = Math.max(0, idx - WINDOW_BEFORE);
    const windowEnd = Math.min(lines.length, idx + WINDOW_AFTER);
    const window = lines.slice(windowStart, windowEnd).join("\n");

    if (!isReadQuery(window)) return;

    const isSafe = SAFETY_MARKERS.some((marker) => window.includes(marker));

    if (!isSafe) {
      findings.push({ line: idx + 1, table: match[1], text: line.trim() });
    }
  });

  return findings;
}

function main() {
  const baseline = loadBaseline();
  const newFindings = [];
  const baselinedCount = { n: 0 };

  for (const dir of SCAN_DIRS) {
    const fullDir = path.join(ROOT, dir);
    if (!fs.existsSync(fullDir)) continue;

    for (const file of walk(fullDir)) {
      const relFile = path.relative(ROOT, file).split(path.sep).join("/");
      const findings = checkFile(file);

      for (const f of findings) {
        if (baseline.has(`${relFile}:${f.line}`)) {
          baselinedCount.n += 1;
        } else {
          newFindings.push({ file: relFile, ...f });
        }
      }
    }
  }

  if (newFindings.length === 0) {
    console.log(
      `check-unbounded-queries: no NEW unbounded large-table queries found` +
        (baselinedCount.n > 0 ? ` (${baselinedCount.n} pre-existing, baselined finding(s) skipped).` : ".")
    );
    return;
  }

  console.error(`check-unbounded-queries: found ${newFindings.length} NEW possibly-unbounded large-table query(ies):\n`);

  for (const f of newFindings) {
    console.error(`  ${f.file}:${f.line}  [${f.table}]  ${f.text}`);
  }

  console.error(
    "\nIf any of these are genuinely unbounded, wrap them with lib/fetchAllRows.ts (see CLAUDE.md's " +
      '"Unbounded-query rule"). If a flagged line is a false positive (already safely scoped, in a way ' +
      "this grep's window didn't catch), add it to scripts/unbounded-queries-baseline.json — but only " +
      "after actually confirming it's bounded, not just to make the build pass."
  );

  process.exitCode = 1;
}

main();
