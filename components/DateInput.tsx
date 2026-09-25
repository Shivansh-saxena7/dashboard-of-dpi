"use client";

import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { Calendar } from "lucide-react";

// Shared HRMS date/month picker (2026-09-25) -- react-datepicker is
// already a dependency, already used once (app/admin/employees/[id]/
// page.tsx) -- this just applies it consistently instead of the plain
// native <input type="date">/<input type="month"> HRMS pages had
// (manual digit-typing, easy to fat-finger a wrong day/month). One
// shared component so every HRMS date input looks and behaves
// identically, instead of 4 separate ad-hoc integrations.
//
// Keeps the exact same plain-string state shape every caller already
// used ("" | "YYYY-MM-DD", or "YYYY-MM" in month mode) -- only this
// component's internals touch react-datepicker's Date-object API, so
// no downstream filtering/query logic needed to change.
//
// Typing is blocked via onKeyDown, NOT the `readOnly` prop -- that's
// a documented react-datepicker footgun (readOnly disables the whole
// popup instead of just blocking edits: github.com/Hacker0x01/
// react-datepicker/issues/1480). onKeyDown keeps click-to-open and
// mouse date-selection fully working while still making "type a date"
// impossible, which is the actual goal.

interface DateInputProps {
  value: string;
  onChange: (value: string) => void;
  mode?: "date" | "month";
  min?: string;
  placeholder?: string;
  className?: string;
}

function parseStringDate(value: string, mode: "date" | "month"): Date | null {
  if (!value) return null;
  if (mode === "month") {
    const [y, m] = value.split("-").map(Number);
    if (!y || !m) return null;
    return new Date(y, m - 1, 1);
  }
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function formatDateToString(date: Date, mode: "date" | "month"): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  if (mode === "month") return `${y}-${m}`;
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const DEFAULT_CLASS =
  "h-10 w-full rounded-xl bg-slate-50 border border-slate-200 pl-3 pr-9 text-xs font-semibold text-slate-600 outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-300 transition cursor-pointer";

export default function DateInput({ value, onChange, mode = "date", min, placeholder, className }: DateInputProps) {
  const selected = parseStringDate(value, mode);
  const minDate = min ? parseStringDate(min, "date") ?? undefined : undefined;

  return (
    <div className="relative">
      <DatePicker
        selected={selected}
        onChange={(date: Date | null) => onChange(date ? formatDateToString(date, mode) : "")}
        dateFormat={mode === "month" ? "MMMM yyyy" : "dd MMM yyyy"}
        showMonthYearPicker={mode === "month"}
        minDate={minDate}
        placeholderText={placeholder}
        onKeyDown={(e) => e.preventDefault()}
        className={className || DEFAULT_CLASS}
      />
      <Calendar size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
    </div>
  );
}
