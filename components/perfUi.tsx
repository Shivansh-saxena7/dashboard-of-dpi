"use client";
// Small UI pieces shared by the Performance Report (components/PerfReport.tsx) and its admin "give leads" controls
// (components/PerfReassign.tsx). English, 44px taps, blue accents, light only.
import type { ReactNode } from "react";
import type { Tone } from "@/lib/perfReport";

export const CARD = "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm";
export const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700";
export const BTN = `min-h-11 rounded-xl border border-slate-200 bg-white px-4 text-[15px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 ${FOCUS}`;
export const PRIMARY = `min-h-11 rounded-xl bg-blue-700 px-4 text-[15px] font-semibold text-white hover:bg-blue-800 disabled:opacity-60 ${FOCUS}`;
export const CHIP = (on: boolean) => `min-h-11 flex-none rounded-full border px-4 text-[13px] font-semibold ${FOCUS} ${on ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-700"}`;
export const INPUT = `min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-[15px] font-normal text-slate-900 ${FOCUS}`;
export const TONE: Record<Tone, string> = {
  red: "bg-red-50 text-red-700", amber: "bg-amber-50 text-amber-800", green: "bg-emerald-50 text-emerald-700",
  blue: "bg-blue-50 text-blue-700", mute: "bg-slate-100 text-slate-700"
};

export function Pill({ tone, icon, children }: { tone: Tone; icon: string; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[13px] font-bold ${TONE[tone]}`}>
      <span aria-hidden>{icon}</span>
      {children}
    </span>
  );
}
export function Banner({ tone, icon, children, testId }: { tone: Tone; icon: string; children: ReactNode; testId: string }) {
  return (
    <p data-testid={testId} role="status" className={`flex items-start gap-2 rounded-xl px-3 py-2.5 text-[15px] font-medium ${TONE[tone]}`}>
      <span aria-hidden>{icon}</span>
      <span>{children}</span>
    </p>
  );
}
export function InfoButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onClick(); }} aria-label={`About ${label}`}
      className={`grid h-11 w-11 flex-none place-items-center rounded-full text-[13px] font-bold text-slate-600 hover:bg-slate-100 ${FOCUS}`}>
      <span aria-hidden className="grid h-6 w-6 place-items-center rounded-full border border-slate-300">i</span>
    </button>
  );
}
export const Skeleton = ({ className }: { className: string }) => <div aria-hidden data-testid="perf-skeleton" className={`animate-pulse rounded-xl bg-slate-200/70 motion-reduce:animate-none ${className}`} />;

export function Sheet({ title, sub, onClose, children, testId, wide }: { title: string; sub?: string; onClose: () => void; children: ReactNode; testId: string; wide?: boolean }) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-900/35" onClick={onClose} aria-hidden />
      <aside role="dialog" aria-modal="true" aria-label={title} data-testid={testId}
        className={`fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl lg:inset-y-0 lg:left-auto lg:right-0 lg:max-h-none lg:rounded-none ${wide ? "lg:w-[560px]" : "lg:w-[460px]"}`}
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900">{title}</h2>
            {sub && <p className="text-[13px] text-slate-600">{sub}</p>}
          </div>
          <button type="button" autoFocus onClick={onClose} className={BTN} data-testid={`${testId}-close`}>Close</button>
        </div>
        <div className="mt-3">{children}</div>
      </aside>
    </>
  );
}

export function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const dayText = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }) : "now";
