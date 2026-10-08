"use client";

import toast from "react-hot-toast";
import type { useRouter } from "next/navigation";
import { FocusReminderItem, formatTimeLeft, loadFocusReminderItems, markFocusRemindersRead } from "@/lib/focusReminders";
import { notificationStyle } from "@/lib/notificationSystem";

type Router = ReturnType<typeof useRouter>;

const TOAST_ID = "focus-reminders";
const SESSION_KEY = "focusRemindersShownThisSession";
const MAX_ROWS = 4;

const KIND_LABEL: Record<FocusReminderItem["kind"], string> = {
  RECYCLE: "recycles in",
  VISIT_LOCK: "Visit lock ends in",
  SNOOZE: "Snooze ends in"
};

// Same colours/icons as the notification list (lib/notificationSystem.ts).
const KIND_STYLE = {
  RECYCLE: notificationStyle("RECYCLE_TOMORROW"),
  VISIT_LOCK: notificationStyle("PAUSE_EXPIRY_WARNING"),
  SNOOZE: notificationStyle("PAUSE_EXPIRY_WARNING")
} as const;

// One grouped, persistent toast for focus reminders (2026-10-05), using
// the app's existing react-hot-toast. Re-rendering with the same id updates
// it in place, so new reminders never stack a second toast. Tapping a lead
// opens it (same ?openLead= deep link the bell uses) and marks its reminder
// read; with 2+ recycling leads, a button opens the Recycling Tomorrow filter.
// Closing the toast leaves the reminders unread in the bell.
export async function showFocusReminderToast(employeeId: string, router: Router, options: { oncePerSession?: boolean } = {}) {
  if (options.oncePerSession) {
    try {
      if (sessionStorage.getItem(SESSION_KEY)) return;
    } catch {
      // storage unavailable — just show it
    }
  }

  const items = await loadFocusReminderItems(employeeId);
  if (items.length === 0) return;

  try {
    sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    // ignore
  }

  const recycleCount = items.filter((i) => i.kind === "RECYCLE").length;

  const openLead = (item: FocusReminderItem) => {
    toast.dismiss(TOAST_ID);
    void markFocusRemindersRead(item.notificationIds);
    router.push(`${item.leadType === "DATA" ? "/data" : "/leads"}?openLead=${item.leadId}`);
  };

  toast.custom(
    (t) => (
      <div
        className={`w-[340px] max-w-[calc(100vw-2rem)] rounded-2xl bg-white shadow-2xl border-2 border-amber-300 p-4 transition-opacity ${t.visible ? "opacity-100" : "opacity-0"}`}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <p className="text-sm font-bold text-slate-800">
            ⏳ {items.length} lead{items.length === 1 ? "" : "s"} need{items.length === 1 ? "s" : ""} you today
          </p>
          <button onClick={() => toast.dismiss(TOAST_ID)} aria-label="Close" className="h-7 w-7 -mt-1 -mr-1 shrink-0 rounded-lg text-slate-400 hover:bg-slate-100">
            ✕
          </button>
        </div>

        <div className="space-y-1.5">
          {items.slice(0, MAX_ROWS).map((item) => (
            <button
              key={item.leadId}
              onClick={() => openLead(item)}
              className={`w-full flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left transition hover:brightness-95 ${KIND_STYLE[item.kind].chipClass}`}
            >
              <span className="text-sm font-semibold text-slate-800 truncate">
                <span aria-hidden="true" className="mr-1.5">{KIND_STYLE[item.kind].icon}</span>
                {item.name}
              </span>
              <span className="shrink-0 text-xs font-bold">
                {KIND_LABEL[item.kind]} {formatTimeLeft(item.msLeft)}
              </span>
            </button>
          ))}
          {items.length > MAX_ROWS && (
            <p className="text-xs text-slate-500 px-1">+{items.length - MAX_ROWS} more in your notifications</p>
          )}
        </div>

        {recycleCount >= 2 && (
          <button
            onClick={() => {
              toast.dismiss(TOAST_ID);
              router.push("/leads?filter=recycling-tomorrow");
            }}
            className="mt-3 w-full h-10 rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-sm font-semibold transition"
          >
            Open Recycling Tomorrow ({recycleCount})
          </button>
        )}
      </div>
    ),
    { id: TOAST_ID, duration: Infinity }
  );
}
