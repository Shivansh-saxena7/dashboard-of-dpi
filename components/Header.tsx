"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Playfair_Display } from "next/font/google";
import { Bell, Globe, MapPin, Phone, LogOut, X, ChevronRight } from "lucide-react";
import { FaInstagram, FaFacebookF, FaYoutube } from "react-icons/fa";
import NotificationModal from "./NotificationModal";
import BookingCelebrationModal from "./BookingCelebrationModal";
import LeaderboardPopupModal from "./LeaderboardPopupModal";
import { getISTParts, ymd, formatShortDate, getMostRecentCompletedWeek } from "@/lib/leaderboardWeek";

const playfair = Playfair_Display({ subsets: ["latin"], weight: ["600", "700"] });

const POPUP_WINDOWS_MINUTES = [11 * 60, 14 * 60, 17 * 60]; // 11:00, 14:00, 17:00 IST
const POPUP_WINDOW_LENGTH_MINUTES = 10;

function isWithinPopupWindow(hour: number, minute: number): boolean {
  const total = hour * 60 + minute;
  return POPUP_WINDOWS_MINUTES.some((start) => total >= start && total < start + POPUP_WINDOW_LENGTH_MINUTES);
}

interface CelebrationQueueItem {
  id: string;
  message: string;
}

interface LeaderboardPopupState {
  title: string;
  subtitle: string;
  countLabel: string;
  rows: { employeeId: string; employeeName: string; count: number }[];
}

export default function Header() {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);

  // --- Booking Celebration (Feature 3) ---
  const [celebrationQueue, setCelebrationQueue] = useState<CelebrationQueueItem[]>([]);
  const [currentCelebration, setCurrentCelebration] = useState<CelebrationQueueItem | null>(null);

  // --- Weekly/Monthly Leaderboards (Features 1 & 2) ---
  const [leaderboardPopup, setLeaderboardPopup] = useState<LeaderboardPopupState | null>(null);
  const [myEmployeeId, setMyEmployeeId] = useState<string | null>(null);
  const [myDepartment, setMyDepartment] = useState<string | null>(null);

  const router = useRouter();

  useEffect(() => {
    const loadUnreadCount = async () => {
      const {
        data: { user }
      } = await supabase.auth.getUser();

      const { data: employee } = await supabase
        .from("employees")
        .select("id")
        .eq("auth_user_id", user?.id)
        .single();

      if (!employee) return;

      const { count } = await supabase
        .from("notification")
        .select("*", { count: "exact", head: true })
        .eq("employee_id", employee.id)
        .eq("is_read", false);

      setUnreadCount(count || 0);
    };

    loadUnreadCount();
  }, []);
useEffect(() => {
    let channel: any;
    let cancelled = false;

    const setupRealtime = async () => {
      const {
        data: { user }
      } = await supabase.auth.getUser();

      if (!user || cancelled) return;

      const { data: employee } = await supabase
        .from("employees")
        .select("id, department")
        .eq("auth_user_id", user.id)
        .single();

      if (!employee || cancelled) return;

      setMyEmployeeId(employee.id);
      setMyDepartment(employee.department);

      const existing = supabase.getChannels().find((ch) => ch.topic === `realtime:employee-${employee.id}`);

      if (existing) {
        await supabase.removeChannel(existing);
      }

      if (cancelled) return;

      channel = supabase
        .channel(`employee-${employee.id}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notification",
            filter: `employee_id=eq.${employee.id}`
          },
          async (payload) => {
            if (payload.new?.employee_id !== employee.id) return;
            setUnreadCount((prev) => prev + 1);
            await loadNotifications();

            // Booking Celebration — reuses this same subscription
            // rather than opening a second one (this already fires
            // for every notification INSERT of this employee's,
            // filtering to the one type here is enough). Queued, not
            // shown directly — the queue-draining effect below is the
            // single place that marks celebration_shown_at, so a live
            // one and a catch-up one (found on mount) can never race
            // on which "owns" that update.
            if (payload.new?.type === "BOOKING_CELEBRATION") {
              setCelebrationQueue((prev) => [...prev, { id: payload.new.id, message: payload.new.message }]);
            }
          }
        )
        .subscribe();
    };

    setupRealtime();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  // Drains celebrationQueue one at a time — the single place
  // celebration_shown_at gets set, for both the live (realtime) path
  // and the catch-up (missed-while-offline) path below, so there's
  // exactly one owner for "has this celebration's popup been shown"
  // regardless of which path queued it.
  useEffect(() => {
    if (!currentCelebration && celebrationQueue.length > 0) {
      const [next, ...rest] = celebrationQueue;
      setCurrentCelebration(next);
      setCelebrationQueue(rest);

      supabase
        .from("notification")
        .update({ celebration_shown_at: new Date().toISOString() })
        .eq("id", next.id)
        .then(({ error }) => {
          if (error) console.error("mark celebration_shown_at failed:", error.message);
        });
    }
  }, [currentCelebration, celebrationQueue]);

  // Catch-up — an employee who was offline when a booking happened
  // still gets the full celebration popup once they open the app,
  // not just a bell-icon badge (a booking is a genuine team
  // achievement, worth more than a silent unread count). Bounded to
  // the last 48h / 5 most recent so a long absence doesn't turn into
  // a wall of stale popups — anything older just gets silently marked
  // shown (it still stays visible in the bell/notification list
  // forever either way, only the POPUP is skipped).
  //
  // Runs on mount AND every 2 minutes thereafter (not just once) —
  // a tab that was already open before a booking happened only ran
  // this ONE time, before the celebration row existed, so it relied
  // entirely on realtime staying live for the rest of that session.
  // Realtime websockets do go quietly stale (backgrounded tab, sleep/
  // wake, a network blip) without necessarily reconnecting cleanly,
  // and postgres_changes has no "replay what I missed" semantics on
  // reconnect — so a single mount-time check is not a reliable enough
  // safety net on its own. The 2-minute poll is what actually
  // guarantees "everyone eventually sees it," realtime is just the
  // fast path when it's working. shownOrQueuedIdsRef guards against
  // the same row being queued twice if a poll lands in the brief
  // window between a row being queued and celebration_shown_at
  // actually landing in the database.
  useEffect(() => {
    let cancelled = false;
    const shownOrQueuedIds = new Set<string>();

    const checkCelebrationCatchup = async () => {
      const {
        data: { user }
      } = await supabase.auth.getUser();

      if (!user || cancelled) return;

      const { data: employee } = await supabase
        .from("employees")
        .select("id")
        .eq("auth_user_id", user.id)
        .single();

      if (!employee || cancelled) return;

      const cutoffIso = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

      await supabase
        .from("notification")
        .update({ celebration_shown_at: new Date().toISOString() })
        .eq("employee_id", employee.id)
        .eq("type", "BOOKING_CELEBRATION")
        .is("celebration_shown_at", null)
        .lt("created_at", cutoffIso);

      if (cancelled) return;

      const { data } = await supabase
        .from("notification")
        .select("id, message")
        .eq("employee_id", employee.id)
        .eq("type", "BOOKING_CELEBRATION")
        .is("celebration_shown_at", null)
        .gte("created_at", cutoffIso)
        .order("created_at", { ascending: true })
        .limit(5);

      if (cancelled || !data || data.length === 0) return;

      const fresh = data.filter((n) => !shownOrQueuedIds.has(n.id));
      if (fresh.length === 0) return;

      fresh.forEach((n) => shownOrQueuedIds.add(n.id));
      setCelebrationQueue((prev) => [...prev, ...fresh.map((n) => ({ id: n.id, message: n.message }))]);
    };

    checkCelebrationCatchup();
    const interval = setInterval(checkCelebrationCatchup, 2 * 60 * 1000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Weekly Visits / Monthly Bookings leaderboard popups — Tuesday
  // (weekly) and the first working day of the month (monthly), each
  // with 3 daily catch-windows (11/2/5, IST) rather than one instant
  // — an employee who isn't looking at the app at exactly 11:00:00
  // still gets caught by 2 or 5. Each employee sees a given week's/
  // month's popup at most once (leaderboard_popup_views), whichever
  // window catches them first — not three times.
  useEffect(() => {
    // Runs independently of the tab bar — a non-Sales employee never
    // has a Leaderboard tab, but Header mounts on every employee page
    // (including Posts) regardless, so without this check they'd
    // still silently get the popup. Weekly Visits is a Sales-
    // achievement view non-Sales has nothing to do with (same
    // reasoning as removing their access to /leaderboard itself).
    if (!myEmployeeId || myDepartment !== "sales") return;

    let cancelled = false;

    const checkLeaderboardPopups = async () => {
      if (cancelled || leaderboardPopup) return; // one at a time

      const parts = getISTParts();
      if (!isWithinPopupWindow(parts.hour, parts.minute)) return;

      if (parts.dayOfWeek === 2) {
        const week = getMostRecentCompletedWeek(parts);
        const periodKey = week.periodKey;

        const { data: seen } = await supabase
          .from("leaderboard_popup_views")
          .select("id")
          .eq("employee_id", myEmployeeId)
          .eq("popup_type", "WEEKLY_VISITS")
          .eq("period_key", periodKey)
          .maybeSingle();

        if (!cancelled && !seen) {
          const { data: rows } = await supabase.rpc("weekly_visits_leaderboard", { p_week_start: periodKey });

          if (!cancelled && rows && rows.length > 0) {
            const { error: insertError } = await supabase
              .from("leaderboard_popup_views")
              .insert({ employee_id: myEmployeeId, popup_type: "WEEKLY_VISITS", period_key: periodKey });

            if (!insertError && !cancelled) {
              setLeaderboardPopup({
                title: "🏆 Weekly Visits Leaderboard",
                subtitle: `Week of ${formatShortDate(week.startYear, week.startMonth, week.startDay)} – ${formatShortDate(week.endYear, week.endMonth, week.endDay)}`,
                countLabel: "visits",
                rows: rows.map((r: any) => ({ employeeId: r.employee_id, employeeName: r.employee_name, count: r.visit_count }))
              });
              return;
            }
          }
        }
      }

      if (cancelled || leaderboardPopup) return;

      const { data: settings } = await supabase
        .from("lead_engine_settings")
        .select("sla_weekly_off_day")
        .eq("id", 1)
        .single();

      const offDay = settings?.sla_weekly_off_day ?? 1;
      const dowOf1st = new Date(parts.year, parts.month, 1).getDay();
      const firstWorkingDay = dowOf1st === offDay ? 2 : 1;

      if (parts.dayOfMonth !== firstWorkingDay) return;

      const prevMonthDate = new Date(parts.year, parts.month - 1, 1);
      const periodKey = ymd(prevMonthDate.getFullYear(), prevMonthDate.getMonth(), 1);

      const { data: seen } = await supabase
        .from("leaderboard_popup_views")
        .select("id")
        .eq("employee_id", myEmployeeId)
        .eq("popup_type", "MONTHLY_BOOKINGS")
        .eq("period_key", periodKey)
        .maybeSingle();

      if (cancelled || seen) return;

      const { data: rows } = await supabase.rpc("monthly_bookings_leaderboard", { p_month_start: periodKey });

      if (cancelled || !rows || rows.length === 0) return;

      const { error: insertError } = await supabase
        .from("leaderboard_popup_views")
        .insert({ employee_id: myEmployeeId, popup_type: "MONTHLY_BOOKINGS", period_key: periodKey });

      if (!insertError && !cancelled) {
        setLeaderboardPopup({
          title: "🏆 Monthly Bookings Leaderboard",
          subtitle: prevMonthDate.toLocaleDateString([], { month: "long", year: "numeric" }),
          countLabel: "bookings",
          rows: rows.map((r: any) => ({ employeeId: r.employee_id, employeeName: r.employee_name, count: r.booking_count }))
        });
      }
    };

    checkLeaderboardPopups();
    const interval = setInterval(checkLeaderboardPopups, 60000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [myEmployeeId, myDepartment, leaderboardPopup]);

  const loadNotifications = async () => {
    const {
      data: { user }
    } = await supabase.auth.getUser();

    const { data: employee } = await supabase
      .from("employees")
      .select("id")
      .eq("auth_user_id", user?.id)
      .single();

    if (!employee) return;

    const { data } = await supabase
      .from("notification")
      .select("*")
      .eq("employee_id", employee.id)
      .order("created_at", { ascending: false })
      .limit(50);

    setNotifications(data || []);
  };

  async function handleLogout() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  const socialLinks = [
    { name: "Instagram", href: "https://www.instagram.com/divyapadmainfosystemllp__/", icon: FaInstagram, color: "#D6336C", bg: "bg-pink-50" },
    { name: "Facebook", href: "https://www.facebook.com/share/198io8761o/", icon: FaFacebookF, color: "#1877F2", bg: "bg-blue-50" },
    { name: "YouTube", href: "https://youtube.com/@divyapadmainfosystemllp_1?si=QVF8glGIr_4bZrCo", icon: FaYoutube, color: "#FF0000", bg: "bg-red-50" }
  ];

  return (
    <>
      {/* HEADER */}
      <div className="w-full sticky top-0 z-50 backdrop-blur-xl bg-gradient-to-r from-white/70 via-blue-100/60 to-white/70 border-b border-white/30 shadow-lg">
        <div className="w-full px-3 lg:px-5 h-16 flex justify-between items-center">
         <div className="group flex items-center gap-2 sm:gap-3 cursor-pointer min-w-0 flex-1">
  <Image
    src="/dpilogo.png"
    alt="Logo"
    width={78}
    height={78}
    className="object-contain w-10 h-10 sm:w-[78px] sm:h-[78px] shrink-0 transition-transform duration-500 group-hover:scale-110"
  />

  <div className="min-w-0">
    <h1 className="relative inline-block text-[11px] sm:text-[15px] font-black tracking-[-0.01em] sm:tracking-[-0.02em] text-slate-700 transition-all duration-500 group-hover:text-cyan-600 leading-tight">
      DIVYA PADMA INFOSYSTEM LLP
      <span className="absolute left-0 -bottom-1 h-[3px] w-0 rounded-full bg-gradient-to-r from-transparent via-yellow-400 to-transparent transition-all duration-500 group-hover:w-full" />
    </h1>
  </div>
</div>

          <div className="flex items-center gap-3 relative">
            <button
              onClick={async () => {
                await loadNotifications();
                const {
                  data: { user }
                } = await supabase.auth.getUser();

                const { data: employee } = await supabase
                  .from("employees")
                  .select("id")
                  .eq("auth_user_id", user?.id)
                  .single();

                if (employee) {
                  await supabase
                    .from("notification")
                    .update({ is_read: true, read_at: new Date().toISOString() })
                    .eq("employee_id", employee.id)
                    .eq("is_read", false);

                  setUnreadCount(0);
                }

                setShowNotifications(!showNotifications);
              }}
              className="relative p-2 rounded-lg bg-white/70 shadow"
            >
              <Bell size={20} />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center font-bold animate-pulse">
                  {unreadCount}
                </span>
              )}
            </button>

            <button onClick={() => setOpen(true)} className="p-2 rounded-lg bg-white/70 shadow">
              ☰
            </button>
          </div>
        </div>
      </div>

      {showNotifications && (
        <NotificationModal notifications={notifications} onClose={() => setShowNotifications(false)} />
      )}

      {currentCelebration && (
        <BookingCelebrationModal
          message={currentCelebration.message}
          onClose={() => setCurrentCelebration(null)}
        />
      )}

      {leaderboardPopup && (
        <LeaderboardPopupModal
          title={leaderboardPopup.title}
          subtitle={leaderboardPopup.subtitle}
          countLabel={leaderboardPopup.countLabel}
          rows={leaderboardPopup.rows}
          myEmployeeId={myEmployeeId}
          onClose={() => setLeaderboardPopup(null)}
        />
      )}

      {/* DRAWER */}
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.45 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 bg-black z-40"
            />

            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 120, damping: 18 }}
              className="fixed top-0 right-0 h-full w-[88%] max-w-sm z-50 bg-[#FBF9F4] shadow-2xl overflow-y-auto"
            >
              {/* HERO / BRAND BANNER */}
              <div className="relative pt-8 pb-10 px-6 overflow-hidden bg-gradient-to-br from-[#FFFDF8] to-[#F3ECDA]">
                <div
                  className="absolute inset-0 opacity-[0.35] pointer-events-none"
                  style={{
                    backgroundImage:
                      "radial-gradient(circle at 20% 20%, rgba(212,175,55,0.25) 0%, transparent 45%), radial-gradient(circle at 90% 0%, rgba(212,175,55,0.18) 0%, transparent 40%)"
                  }}
                />
                <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-[#B8860B] via-[#E8C766] to-[#B8860B]" />

                <button
                  onClick={() => setOpen(false)}
                  className="absolute top-5 right-5 h-8 w-8 flex items-center justify-center rounded-full border border-[#D4AF37]/40 text-slate-500 hover:text-slate-800 hover:border-[#D4AF37] bg-white/60 transition z-10"
                >
                  <X size={16} />
                </button>

                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.08 }}
                  className="relative flex flex-col items-center text-center mt-2"
                >
                  {/* ROTATING HALO + LOGO (enlarged) */}
                  {/* ROTATING HALO + LOGO */}
                  <div className="relative h-24 w-24 flex items-center justify-center">
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 9, repeat: Infinity, ease: "linear" }}
                      className="absolute inset-0 rounded-full"
                      style={{
                        background:
                          "conic-gradient(from 0deg, #D4AF37 0deg, transparent 100deg, transparent 260deg, #D4AF37 360deg)"
                      }}
                    />
                    <div className="absolute inset-[3px] rounded-full bg-[#FBF9F4]" />
                    <div className="relative h-20 w-20 rounded-full bg-white shadow-[0_4px_20px_rgba(184,134,11,0.2)] flex items-center justify-center p-1">
                      <Image src="/dpilogo.png" alt="Logo" width={68} height={68} className="object-contain" />
                    </div>
                  </div>

                  <h2 className={`${playfair.className} text-[23px] font-bold tracking-tight text-slate-900 mt-4 leading-tight`}>
                    Divya Padma
                  </h2>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="h-px w-4 bg-[#B8860B]/50" />
                    <span className="h-1 w-1 rotate-45 bg-[#B8860B]/60" />
                    <p className="text-[10.5px] text-[#9c7a1f] font-bold tracking-[0.25em] uppercase">
                      Infosystem LLP
                    </p>
                    <span className="h-1 w-1 rotate-45 bg-[#B8860B]/60" />
                    <span className="h-px w-4 bg-[#B8860B]/50" />
                  </div>
                </motion.div>
              </div>

              {/* CONTENT */}
              <div className="px-6 py-6">
                <p className="text-[10.5px] uppercase tracking-[0.25em] text-slate-400 font-bold mb-3 px-1">
                  Connect With Us
                </p>

                <div className="flex flex-col gap-3 mb-6">
                  {socialLinks.map((social, i) => (
                    <motion.a
                      key={social.name}
                      href={social.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.14 + i * 0.06 }}
                      whileHover={{ y: -2 }}
                      whileTap={{ scale: 0.98 }}
                      className="group flex items-center justify-between gap-3 px-4 py-3.5 rounded-2xl bg-white shadow-[0_2px_10px_rgba(15,23,42,0.05)] hover:shadow-[0_6px_20px_rgba(15,23,42,0.1)] border border-slate-100 transition-shadow duration-300"
                    >
                      <div className="flex items-center gap-3.5">
                        <div className={`h-10 w-10 rounded-xl ${social.bg} flex items-center justify-center`}>
                          <social.icon size={17} style={{ color: social.color }} />
                        </div>
                        <span className="text-[14.5px] font-semibold text-slate-800">{social.name}</span>
                      </div>
                      <ChevronRight
                        size={16}
                        className="text-slate-300 group-hover:text-[#B8860B] group-hover:translate-x-0.5 transition-all"
                      />
                    </motion.a>
                  ))}
                </div>

                <motion.button
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.34 }}
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleLogout}
                  className="w-full group flex items-center justify-between gap-3 px-4 py-3.5 rounded-2xl bg-white shadow-[0_2px_10px_rgba(15,23,42,0.05)] hover:shadow-[0_6px_20px_rgba(239,68,68,0.12)] border border-red-100 transition-shadow duration-300"
                >
                  <div className="flex items-center gap-3.5">
                    <div className="h-10 w-10 rounded-xl bg-red-50 flex items-center justify-center">
                      <LogOut size={17} className="text-red-500" />
                    </div>
                    <span className="text-[14.5px] font-semibold text-red-500">Logout</span>
                  </div>
                  <ChevronRight
                    size={16}
                    className="text-red-200 group-hover:text-red-400 group-hover:translate-x-0.5 transition-all"
                  />
                </motion.button>

                {/* FOOTER CARD */}
                <div className="mt-8 rounded-2xl bg-white shadow-[0_2px_10px_rgba(15,23,42,0.05)] border border-slate-100 p-5">
                  <p className="text-[10.5px] uppercase tracking-[0.25em] text-slate-400 font-bold mb-4">
                    Get In Touch
                  </p>

                  <div className="flex flex-col gap-3.5">
                    <a
                      href="https://divyapadma.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 text-[13px] font-medium text-slate-600 hover:text-[#9c7a1f] transition-colors"
                    >
                      <span className="h-8 w-8 rounded-lg bg-[#FBF3DD] flex items-center justify-center shrink-0">
                        <Globe size={14} className="text-[#9c7a1f]" />
                      </span>
                      divyapadma.com
                    </a>

                    <div className="flex items-start gap-3 text-[13px] text-slate-600">
                      <span className="h-8 w-8 rounded-lg bg-[#FBF3DD] flex items-center justify-center shrink-0 mt-[1px]">
                        <MapPin size={14} className="text-[#9c7a1f]" />
                      </span>
                      <span className="pt-1.5">4th Floor, F417, Artha SEZ, Techzone 4, Greater Noida West</span>
                    </div>

                    <div className="flex items-center gap-3 text-[13px] text-slate-600">
                      <span className="h-8 w-8 rounded-lg bg-[#FBF3DD] flex items-center justify-center shrink-0">
                        <Phone size={14} className="text-[#9c7a1f]" />
                      </span>
                      9220907340
                    </div>
                  </div>
                </div>

                <p className="text-center text-[10.5px] text-slate-400 mt-6 tracking-wide">
  Designed &amp; Developed by <span className="text-[#9c7a1f] font-bold">Shivansh Saxena</span>
</p>
<p className="text-center text-[9px] text-slate-500 mt-1 tracking-wide">
  Version 1.0
</p>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}