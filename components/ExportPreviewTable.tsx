"use client";

import { useMemo, useState } from "react";
import { AdminExportLead, buildExportRows, EXPORT_COLUMNS } from "@/lib/exportLeadsReport";

const PAGE_SIZE = 50;

// All 15 export columns render in the DOM at every screen size — no
// JS measurement, no ResizeObserver, no viewport-dependent column
// *set* to keep in sync with. Each column instead carries a static
// Tailwind visibility class (`hidden` below its breakpoint, then
// `table-cell` from there up), the same "responsive table columns"
// pattern used for e.g. hiding table cells on mobile. Classes are
// written out in full per key (not built via string interpolation)
// because Tailwind's content scanner needs the complete class token
// present literally in source to generate it — an interpolated
// `` `hidden ${bp}:table-cell` `` would silently produce nothing.
//
// Name/Mobile/Status/Employee are the only ones with no `hidden` —
// they're what "which lead, who's on it, where does it stand" needs,
// so they stay visible down to the smallest phone width. Everything
// else reveals progressively as the viewport widens, roughly in
// order of how often it's the reason someone opens the preview.
const COLUMN_VISIBILITY: Record<(typeof EXPORT_COLUMNS)[number]["key"], string> = {
  leadName: "table-cell",
  mobile: "table-cell",
  status: "table-cell",
  assignedEmployee: "table-cell",
  type: "hidden sm:table-cell",
  project: "hidden sm:table-cell",
  assignedDate: "hidden sm:table-cell",
  source: "hidden md:table-cell",
  priority: "hidden md:table-cell",
  boardStage: "hidden lg:table-cell",
  assignedBy: "hidden lg:table-cell",
  firstCallTime: "hidden xl:table-cell",
  responseTime: "hidden xl:table-cell",
  firstWhatsAppTime: "hidden 2xl:table-cell",
  recycleCount: "hidden 2xl:table-cell"
};

// Reuses buildExportRows directly rather than re-deriving labels a
// second time, so this can never drift from what the actual export
// contains — it just renders the same columns that function already
// computes, with a visibility class layered on top. Client-side
// "Load More" only (no server round-trip) — the caller has already
// filtered `leads` down to what's on screen, this just reveals more
// of that same in-memory array.
//
// No w-full on the <table> — forcing the table to compress into the
// container's width defeats the whole point of the scrolling
// container below (overflow-x-auto), which needs the table to be
// ALLOWED to grow wider than it and then scroll. That scroll is now
// mostly a safety net rather than the main mechanism — at any given
// breakpoint only the columns meant for it are showing — but it's
// kept in case a device sits right at a breakpoint edge with a
// narrow window (e.g. a resized browser, not just a phone).
export default function ExportPreviewTable({ leads }: { leads: AdminExportLead[] }) {

  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const rows = useMemo(() => buildExportRows(leads), [leads]);
  const shown = rows.slice(0, visibleCount);

  if (leads.length === 0) {
    return (
      <div className="rounded-xl border border-slate-100 bg-slate-50 p-6 text-center text-sm text-slate-400">
        No leads match these filters.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-xl border border-slate-100">
        <table className="text-xs">
          <thead className="bg-slate-50 sticky top-0">
            <tr>
              {EXPORT_COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className={`whitespace-nowrap px-2.5 py-1.5 font-semibold text-slate-500 ${
                    COLUMN_VISIBILITY[col.key]
                  } ${col.align === "center" ? "text-center" : "text-left"}`}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, i) => (
              <tr key={i} className="border-t border-slate-100">
                {EXPORT_COLUMNS.map((col) => (
                  <td
                    key={col.key}
                    className={`whitespace-nowrap px-2.5 py-1.5 text-slate-700 ${
                      COLUMN_VISIBILITY[col.key]
                    } ${col.align === "center" ? "text-center" : "text-left"}`}
                  >
                    {row[col.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-slate-400">
        More columns appear as your screen gets wider — download for the full {EXPORT_COLUMNS.length}-column report (First Call/WhatsApp Time, Response Time, Assigned By, Recycle Count, ...) on any device.
      </p>

      {visibleCount < rows.length && (
        <button
          onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
          className="w-full h-9 rounded-lg text-xs font-bold text-slate-500 hover:text-slate-700 bg-slate-50 hover:bg-slate-100 transition"
        >
          Load More ({rows.length - visibleCount} more)
        </button>
      )}
    </div>
  );
}
