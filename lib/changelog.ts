// What UpdateAvailableBanner.tsx shows employees under "Update
// available" — plain, employee-facing language, not commit messages
// (those are internal/technical, see this file's own history for
// why that was deliberately rejected). Add ONE new entry here before
// each deploy that has anything employee-visible in it; a purely
// internal/backend change needs no entry. Newest entry LAST — a new
// deploy is just a .push()-shaped addition at the bottom.
//
// /api/version only ever reads the LAST entry's `changes` — this is
// deliberately "what changed most recently," not a full multi-version
// diff. Skipping an entry for a deploy is safe: the banner just falls
// back to a generic "Update available" message with no list.
export interface ChangelogEntry {
  date: string;
  changes: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: "2026-09-24",
    changes: [
      "Fixed: mobile number search wasn't finding leads saved in a different number format",
      "Fixed: Admin lead list date-filter wasn't actually narrowing results",
      "New: Admin can restrict specific employees to only certain projects"
    ]
  }
];
