// Project filter grouping (2026-10-10). The same project is stored under
// several spellings ("La Residentia" / "LA Residentia" / "la Residentia",
// stray spaces). Filters group them case-insensitively with spaces
// trimmed, show one option per project (the most common spelling), and
// match every spelling of the chosen one. Display/filter only — the data
// itself is never changed.

export function projectKey(project: string | null | undefined): string {
  return (project ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export type ProjectGroup = { key: string; label: string; variants: string[] };

// One group per project. `values` may repeat (one entry per lead) so the
// most common spelling wins; a list of distinct values falls back to the
// Title-Case-looking spelling, then alphabetical, so the choice is stable.
export function groupProjects(values: (string | null | undefined)[]): ProjectGroup[] {
  const byKey = new Map<string, Map<string, number>>();
  for (const v of values) {
    if (!v || !v.trim()) continue;
    const key = projectKey(v);
    const spellings = byKey.get(key) ?? new Map<string, number>();
    spellings.set(v, (spellings.get(v) ?? 0) + 1);
    byKey.set(key, spellings);
  }
  const titleScore = (s: string) => s.trim().split(/\s+/).filter((w) => /^[A-Z][a-z0-9]/.test(w)).length;
  const groups: ProjectGroup[] = [];
  for (const [key, spellings] of byKey) {
    const variants = [...spellings.keys()];
    const label = [...variants].sort(
      (a, b) => spellings.get(b)! - spellings.get(a)! || titleScore(b) - titleScore(a) || a.localeCompare(b)
    )[0].trim().replace(/\s+/g, " ");
    groups.push({ key, label, variants });
  }
  return groups.sort((a, b) => a.label.localeCompare(b.label));
}

export function sameProject(a: string | null | undefined, b: string | null | undefined): boolean {
  return projectKey(a) !== "" && projectKey(a) === projectKey(b);
}

// PostgREST .or() value matching any of the given spellings, case-
// insensitively. LIKE wildcards (% _) and the backslash are escaped so they
// match literally; each value is double-quoted so commas and brackets in a
// project name can't break the filter syntax.
export function projectIlikeOr(variants: string[]): string {
  return variants
    .map((v) => {
      const like = v.replace(/[\\%_]/g, (m) => "\\" + m);
      return `project.ilike."${like.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    })
    .join(",");
}
