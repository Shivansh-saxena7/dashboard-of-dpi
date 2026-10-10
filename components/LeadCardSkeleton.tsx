// Loading placeholder in the shape of the "Pass" lead card (2026-10-09):
// header band, body lines, tear line, action stub. The shimmer only runs
// when the viewer allows motion.
import { leadCardFont } from "@/lib/leadCardFont";

const bar = "rounded-md bg-slate-200/80 motion-safe:animate-pulse";

export default function LeadCardSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div
      className={`${leadCardFont.className} mt-4 mb-6 grid grid-cols-[repeat(auto-fill,minmax(min(100%,19rem),1fr))] items-start gap-4 mx-auto w-[calc(100%-2rem)] max-w-[1400px] rounded-[24px] bg-[linear-gradient(180deg,#f3f6fb_0%,#e9eef6_100%)] p-3 sm:p-4`}
      aria-busy="true"
      aria-label="Loading your leads"
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="w-full overflow-hidden rounded-[18px] border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,.05),0_14px_30px_-14px_rgba(100,116,139,.3)]">
          <div className="h-[3px] bg-slate-200" />
          <div className="h-[36px] bg-slate-100 motion-safe:animate-pulse" />
          <div className="px-3.5 pt-3 pb-2 space-y-2">
            <div className={`${bar} h-4 w-3/5`} />
            <div className={`${bar} h-3.5 w-2/5`} />
            <div className={`${bar} h-3 w-1/2`} />
            {/* last-log strip */}
            <div className={`${bar} h-10 w-full rounded-[12px]`} />
            <div className={`${bar} h-3 w-4/5`} />
          </div>
          <div className="mx-3 my-1 border-t-2 border-dashed border-slate-100" />
          <div className="px-3 pt-1 pb-3 flex gap-2">
            <div className={`${bar} h-11 flex-1 rounded-[13px]`} />
            <div className={`${bar} h-11 w-11 rounded-[13px]`} />
            <div className={`${bar} h-11 w-11 rounded-[13px]`} />
            <div className={`${bar} h-11 w-11 rounded-[13px]`} />
            <div className={`${bar} h-11 w-11 rounded-[13px]`} />
          </div>
        </div>
      ))}
      <span className="sr-only">Loading your leads...</span>
    </div>
  );
}
