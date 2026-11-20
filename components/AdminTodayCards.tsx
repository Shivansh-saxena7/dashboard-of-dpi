"use client";
// Admin Home A2 (2026-11-19): "Today so far" (4 numbers, each vs yesterday at this time; zero = grey) and "Team today"
// (field employees, the ones needing a look first; phone = list, desktop = table; call quality band; workload only when
// asked). Status = icon + word + colour. Display only.
import Link from "next/link";
import { BODY, CARD, DELTA, FadeIn, FOCUS, LINK, NUM, PILL, PILL_BASE, PRESS, Retry, Skeleton, TITLE } from "@/components/AdminHomeUi";
import { deltaText, istTime, TEAM_STATE_VIEW, type TeamMember } from "@/lib/adminHome";
import type { Band } from "@/lib/callQuality";
import type { useAdminToday } from "@/lib/useAdminToday";

function Tile({ testId, value, total, label, today, yesterday, href }: { testId: string; value: number; total?: number; label: string; today: number; yesterday: number; href: string }) {
  const d = deltaText(today, yesterday);
  const zero = value === 0;
  return (
    <Link
      href={href}
      data-testid={testId}
      data-tone={zero ? "zero" : "normal"}
      aria-label={`${value}${total !== undefined ? ` of ${total}` : ""} ${label}, ${d.text}`}
      className={`flex min-h-[92px] flex-col justify-between rounded-2xl border border-slate-200 p-3 hover:bg-slate-50 ${PRESS} ${FOCUS} ${zero ? "bg-slate-50" : "bg-white"}`}
    >
      <span className={`${NUM} ${zero ? "text-slate-600" : "text-slate-900"}`}>
        {value}
        {total !== undefined && <span className="text-base font-semibold text-slate-600">/{total}</span>}
      </span>
      <span className="text-[13px] font-semibold text-slate-700">{label}</span>
      <span data-testid={`${testId}-delta`} className={DELTA}>
        {d.text}
      </span>
    </Link>
  );
}

export function TodaySoFar({ today, teamTotal }: { today: ReturnType<typeof useAdminToday>; teamTotal: number | null }) {
  const t = today.tiles;
  return (
    <section aria-labelledby="admin-today" data-testid="admin-today" className={CARD}>
      <div className="mb-3 flex min-h-11 items-center justify-between">
        <h2 id="admin-today" className={TITLE}>Today so far</h2>
        <span className="text-[13px] text-slate-600">vs yesterday at this time</span>
      </div>
      {t.loading && !t.data ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[92px]" />)}
        </div>
      ) : t.error || !t.data ? (
        <Retry what="today's numbers" onRetry={today.retry.tiles} testId="admin-retry-today" />
      ) : (
        <FadeIn>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile testId="admin-tile-shift" value={t.data.onShift[0]} total={teamTotal ?? undefined} label="On shift" today={t.data.onShift[0]} yesterday={t.data.onShift[1]} href="/hr/attendance" />
            <Tile testId="admin-tile-calls" value={t.data.calls[0]} label="Calls" today={t.data.calls[0]} yesterday={t.data.calls[1]} href="/admin/work-reports" />
            <Tile testId="admin-tile-results" value={t.data.results[0]} label="Results saved" today={t.data.results[0]} yesterday={t.data.results[1]} href="/admin/work-reports" />
            <Tile testId="admin-tile-bookings" value={t.data.bookings[0]} label="Bookings" today={t.data.bookings[0]} yesterday={t.data.bookings[1]} href="/admin/leaderboard" />
          </div>
        </FadeIn>
      )}
    </section>
  );
}

function StatePill({ m }: { m: TeamMember }) {
  const v = TEAM_STATE_VIEW[m.state];
  const time = m.startedAt && (m.state === "ON_SHIFT" || m.state === "LATE" || m.state === "SHIFT_ENDED") ? ` ${istTime(Date.parse(m.startedAt))}` : "";
  return (
    <span data-testid={`admin-team-state-${m.id}`} data-state={m.state} className={`${PILL_BASE} ${PILL[v.severity]}`}>
      <span aria-hidden>{v.icon}</span>
      {v.word}
      {time}
    </span>
  );
}

const BAND: Record<Band, { icon: string; cls: string }> = {
  Green: { icon: "●", cls: PILL.ok },
  Amber: { icon: "▲", cls: PILL.warning },
  Red: { icon: "■", cls: PILL.critical }
};
function BandPill({ band, loaded }: { band: Band | null; loaded: boolean }) {
  if (!loaded) return <span className="text-[13px] text-slate-600">–</span>;
  if (!band) return <span className={`${PILL_BASE} ${PILL.mute}`}>– Not enough data</span>;
  return (
    <span data-band={band} className={`${PILL_BASE} ${BAND[band].cls}`}>
      <span aria-hidden>{BAND[band].icon}</span>
      {band}
    </span>
  );
}

export function TeamToday({ today }: { today: ReturnType<typeof useAdminToday> }) {
  const t = today.team;
  const w = today.workload;
  const showWork = Boolean(w.data);
  const work = (id: string) => w.data?.get(id) ?? { leads: 0, overdue: 0, untouched: 0 };
  return (
    <section aria-labelledby="admin-team" data-testid="admin-team" className={CARD}>
      <div className="mb-3 flex min-h-11 flex-wrap items-center justify-between gap-2">
        <h2 id="admin-team" className={TITLE}>Team today</h2>
        <div className="flex items-center gap-1">
          {t.data && !showWork && (
            <button
              type="button"
              data-testid="admin-show-workload"
              onClick={today.loadWorkload}
              disabled={w.loading}
              className={`min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 ${FOCUS}`}
            >
              {w.loading ? "Loading workload…" : "Show workload"}
            </button>
          )}
          <Link href="/hr/attendance" className={LINK}>HR attendance ›</Link>
        </div>
      </div>
      {t.loading && !t.data ? (
        <div className="space-y-2">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : t.error || !t.data ? (
        <Retry what="the team" onRetry={today.retry.team} testId="admin-retry-team" />
      ) : t.data.members.length === 0 ? (
        <p className={`flex min-h-11 items-center text-slate-700 ${BODY}`}>No field employees.</p>
      ) : (
        <FadeIn>
          {/* Phone: a list */}
          <ul className="divide-y divide-slate-100 md:hidden" data-testid="admin-team-list">
            {t.data.members.map((m) => (
              <li key={m.id} className="flex min-h-14 items-center gap-3 py-2" data-testid={`admin-team-row-${m.id}`}>
                <span aria-hidden className="grid h-8 w-8 flex-none place-items-center rounded-full bg-blue-50 text-[13px] font-bold text-blue-700">
                  {(m.name || "?").charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-slate-900">{m.name}</span>
                  <span className="block text-[13px] text-slate-600">
                    {m.inGrace && m.state !== "IN_GRACE" ? "Back from leave · " : ""}
                    {showWork ? `${work(m.id).overdue} overdue · ${work(m.id).untouched} new · ` : ""}
                    Call quality: {t.data!.bandsLoaded ? (m.band ?? "not enough data") : "–"}
                  </span>
                </span>
                <StatePill m={m} />
              </li>
            ))}
          </ul>
          {/* Desktop: a table */}
          <table className={`hidden w-full border-collapse md:table ${BODY}`} data-testid="admin-team-table">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[13px] font-bold uppercase tracking-wide text-slate-600">
                <th className="py-2 pr-2">Employee</th>
                <th className="py-2 pr-2">Shift</th>
                <th className="py-2 pr-2">Call quality</th>
                {showWork && <th className="py-2 pr-2 text-right">Overdue</th>}
                {showWork && <th className="py-2 pr-2 text-right">New</th>}
                {showWork && <th className="py-2 text-right">Leads</th>}
              </tr>
            </thead>
            <tbody>
              {t.data.members.map((m) => (
                <tr key={m.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="py-2.5 pr-2 font-semibold text-slate-900">
                    {m.name}
                    {m.inGrace && m.state !== "IN_GRACE" && <span className="ml-2 text-[13px] font-normal text-slate-600">back from leave</span>}
                  </td>
                  <td className="py-2.5 pr-2"><StatePill m={m} /></td>
                  <td className="py-2.5 pr-2"><BandPill band={m.band} loaded={t.data!.bandsLoaded} /></td>
                  {showWork && <td className="py-2.5 pr-2 text-right tabular-nums" data-testid={`admin-work-overdue-${m.id}`}>{work(m.id).overdue}</td>}
                  {showWork && <td className="py-2.5 pr-2 text-right tabular-nums">{work(m.id).untouched}</td>}
                  {showWork && <td className="py-2.5 text-right tabular-nums">{work(m.id).leads}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          {t.data.estimated && <p className="mt-2 text-[13px] text-slate-600">Call quality is estimated: some days are from before it started.</p>}
          {!t.data.bandsLoaded && <p className="mt-2 text-[13px] text-slate-600">Call quality couldn&apos;t load.</p>}
          {w.error && <div className="mt-2"><Retry what="the workload" onRetry={today.retry.workload} testId="admin-retry-workload" /></div>}
        </FadeIn>
      )}
    </section>
  );
}
