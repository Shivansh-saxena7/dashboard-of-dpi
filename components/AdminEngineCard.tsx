"use client";
// Admin Home A3 (2026-11-19): "Lead engine today". Is recycling / junk guarding / restore protection working as it should?
// Each number with yesterday at this time; rows link to the page with the details. Positive-history junk is counted only
// on "Check" (the full list is heavy). Status = icon + word + colour. Display only.
import Link from "next/link";
import { type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { deltaText, istTime, POSITIVE_JUNK_REFUSED } from "@/lib/adminHome";
import type { useAdminEngine } from "@/lib/useAdminEngine";

const CARD = "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm";
const TITLE = "text-base font-semibold text-slate-900";
const LINK = "inline-flex min-h-11 items-center px-2 text-[13px] font-semibold text-blue-700";

function FadeIn({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div initial={{ opacity: reduce ? 1 : 0 }} animate={{ opacity: 1 }} transition={{ duration: reduce ? 0 : 0.15 }}>
      {children}
    </motion.div>
  );
}
const Skeleton = ({ className }: { className: string }) => <div aria-hidden className={`animate-pulse rounded-xl bg-slate-200/70 motion-reduce:animate-none ${className}`} />;

function Delta({ today, yesterday, testId }: { today: number; yesterday: number; testId: string }) {
  const d = deltaText(today, yesterday);
  return (
    <span data-testid={testId} className={`text-xs font-bold ${d.dir === "up" ? "text-slate-700" : d.dir === "down" ? "text-slate-700" : "text-slate-600"}`}>
      {d.text}
    </span>
  );
}

function Stat({ testId, value, label, today, yesterday, href, sub }: { testId: string; value: number; label: string; today: number; yesterday: number; href: string; sub?: string }) {
  const zero = value === 0;
  return (
    <Link href={href} data-testid={testId} data-tone={zero ? "zero" : "normal"} className={`flex min-h-[92px] flex-col justify-between rounded-xl p-3 ${zero ? "bg-slate-50" : "bg-slate-50"}`}>
      <span className={`text-[22px] font-bold leading-none tabular-nums ${zero ? "text-slate-600" : "text-slate-900"}`}>{value}</span>
      <span className="text-[13px] font-medium text-slate-700">{label}</span>
      {sub ? <span className="text-xs text-slate-600">{sub}</span> : <Delta today={today} yesterday={yesterday} testId={`${testId}-delta`} />}
    </Link>
  );
}

export function AdminEngineCard({ engine }: { engine: ReturnType<typeof useAdminEngine> }) {
  const e = engine.engine;
  const pj = engine.pj;
  const refused = e.data?.groups.find((g) => g.key === POSITIVE_JUNK_REFUSED);
  const otherGroups = (e.data?.groups ?? []).filter((g) => g.key !== POSITIVE_JUNK_REFUSED);
  return (
    <section aria-labelledby="admin-engine" data-testid="admin-engine" className={CARD}>
      <div className="mb-2 flex items-center justify-between">
        <h2 id="admin-engine" className={TITLE}>Lead engine today</h2>
        <Link href="/admin/system-health" className={LINK}>Details ›</Link>
      </div>
      {e.loading && !e.data ? (
        <div className="grid grid-cols-2 gap-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[92px]" />)}
        </div>
      ) : e.error || !e.data ? (
        <button type="button" onClick={engine.retry} data-testid="admin-retry-engine" className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-left text-sm font-medium text-slate-700">
          Couldn&apos;t load the lead engine numbers. Tap to try again.
        </button>
      ) : (
        <FadeIn>
          <div className="grid grid-cols-2 gap-2">
            <Stat testId="admin-engine-recycled" value={e.data.recycled[0]} label="Recycled" today={e.data.recycled[0]} yesterday={e.data.recycled[1]} href="/admin/leads" />
            <Stat
              testId="admin-engine-refused"
              value={refused?.today ?? 0}
              label="Junk refused (positive)"
              today={refused?.today ?? 0}
              yesterday={refused?.yesterday ?? 0}
              href="/admin/positive-junk"
            />
            <Stat
              testId="admin-engine-protected"
              value={e.data.protections.now}
              label="Protected (given back)"
              today={e.data.protections.now}
              yesterday={e.data.protections.yesterday}
              href="/admin/positive-junk"
              sub={e.data.protections.earliestEnd ? `first ends ${new Date(e.data.protections.earliestEnd).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })}` : undefined}
            />
            <div className="flex min-h-[92px] flex-col justify-between rounded-xl bg-slate-50 p-3" data-testid="admin-engine-pj">
              {pj.count === null ? (
                <>
                  <span className="text-[13px] font-medium text-slate-700">Positive leads in Junk</span>
                  <button
                    type="button"
                    data-testid="admin-check-positive-junk"
                    onClick={engine.checkPositiveJunk}
                    disabled={pj.loading}
                    className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-semibold text-slate-700 disabled:opacity-60"
                  >
                    {pj.loading ? "Checking…" : pj.error ? "Couldn't check. Try again" : "Check"}
                  </button>
                </>
              ) : (
                <Link href="/admin/positive-junk" className="flex h-full flex-col justify-between" data-testid="admin-engine-pj-count">
                  <span className={`text-[22px] font-bold leading-none tabular-nums ${pj.count === 0 ? "text-slate-600" : "text-amber-800"}`}>{pj.count}</span>
                  <span className="text-[13px] font-medium text-slate-700">Positive leads in Junk</span>
                  <span className="text-xs text-slate-600">checked {pj.at ? istTime(pj.at) : ""}</span>
                </Link>
              )}
            </div>
          </div>
          {otherGroups.length > 0 && (
            <ul className="mt-2 divide-y divide-slate-100 text-sm" data-testid="admin-engine-guards">
              {otherGroups.map((g) => (
                <li key={g.key} className="flex min-h-11 items-center justify-between gap-2" data-testid={`admin-guard-${g.key}`}>
                  <span className="text-slate-800">{g.label}</span>
                  <span className="flex items-center gap-2">
                    <b className="tabular-nums text-slate-900">{g.today}</b>
                    <Delta today={g.today} yesterday={g.yesterday} testId={`admin-guard-delta-${g.key}`} />
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[13px] text-slate-600">Junk today is not shown yet: the database keeps no time for when a lead was junked.</p>
        </FadeIn>
      )}
    </section>
  );
}
