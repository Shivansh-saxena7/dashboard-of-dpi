"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MapPin, CheckCircle2, CheckCheck, Loader2, Clock } from "lucide-react";
import { supabase } from "@/lib/supabase";
import toast from "react-hot-toast";
import {
  calculateStartShiftWindow,
  StartShiftWindowResult
} from "@/lib/calculateStartShiftWindow";
import {
  calculateEndShiftWindow,
  EndShiftWindowResult
} from "@/lib/calculateEndShiftWindow";

interface StartShiftCardProps {
  employeeId: string;
  // Slim single-row status-strip instead of the full card — same
  // component, same state/RPC-logic, just a different render branch
  // (see the bottom of the function). Used on Leads/Data/Team, where
  // shift-status is relevant (new leads/Data depend on it) but
  // repeating the full card on every tab would be redundant, most of
  // the time showing nothing actionable (shift already started, the
  // common case for most of the day). The full card stays exactly as
  // it was on Posts (app/page.tsx), untouched.
  compact?: boolean;
}

interface ShiftTimingConfig {
  first_half_start_time: string;
  first_half_start_window_end: string;
  half_day_boundary_time: string;
  second_half_start_window_end: string;
  first_half_min_end_time: string;
  second_half_min_end_time: string;
}

const WINDOW_RECHECK_INTERVAL_MS = 30000;

// Geo-Fenced Attendance / Shift Gate (V2_MASTER_BLUEPRINT.md 4.1).
// This card only ever unlocks NEW lead assignment for today — it has
// no effect on V1 post/tracking access and no effect on an
// employee's ability to view/update leads they already own. It is a
// purely additive card on the employee dashboard, never a page-level
// gate: everything else on app/page.tsx renders normally regardless
// of shift status.
//
// Three states: not started -> started -> ended. Both Start Shift and
// End Shift are now time-window gated (calculateStartShiftWindow /
// calculateEndShiftWindow — the exact same functions the Edge
// Functions use server-side, imported here purely for instant UI
// feedback). The buttons disable themselves and show why, re-checked
// every 30s so a window opening/closing reflects live without a
// refresh — but this is cosmetic only. The Edge Functions are the
// authoritative gate; a disabled-looking button here doesn't
// guarantee the server would accept it, and vice versa.
//
// End Shift stays styled as a low-emphasis secondary action (no
// geofence check either, unlike Start Shift — see
// supabase/functions/end-shift), since ending a shift is voluntary.
//
// Styled per V2_MASTER_BLUEPRINT.md Section 2 (Design System): gold
// as the primary CTA/accent color, large rounded card, Framer Motion
// entrance + hover lift. The ambient corner glow is static rather
// than looping — Section 2.4 reserves looping ambient motion for
// full-screen hero moments, and this is a dashboard card, not one of
// those. Most usage is expected to be on a phone at the office, so
// touch targets (icon badge, button) are sized generously.
export default function StartShiftCard({ employeeId, compact = false }: StartShiftCardProps) {

  const [checking, setChecking] = useState(true);
  const [starting, setStarting] = useState(false);
  const [ending, setEnding] = useState(false);
  const [shiftStartAt, setShiftStartAt] = useState<string | null>(null);
  const [shiftEndAt, setShiftEndAt] = useState<string | null>(null);
  const [attendanceType, setAttendanceType] = useState<string | null>(null);

  const [config, setConfig] = useState<ShiftTimingConfig | null>(null);
  const [startWindow, setStartWindow] = useState<StartShiftWindowResult | null>(null);
  const [endWindow, setEndWindow] = useState<EndShiftWindowResult | null>(null);

  useEffect(() => {
    checkTodaysShift();
    loadShiftTimingConfig();
  }, [employeeId]);

  async function checkTodaysShift() {
    setChecking(true);

    const today = new Date().toISOString().split("T")[0];

    const { data, error } = await supabase
      .from("attendance")
      .select("shift_start_at, shift_end_at, attendance_type")
      .eq("employee_id", employeeId)
      .eq("date", today)
      .maybeSingle();

    if (!error && data) {
      setShiftStartAt(data.shift_start_at);
      setShiftEndAt(data.shift_end_at);
      setAttendanceType(data.attendance_type);
    }

    setChecking(false);
  }

  async function loadShiftTimingConfig() {
    const { data, error } = await supabase
      .from("lead_engine_settings")
      .select(
        "first_half_start_time, first_half_start_window_end, half_day_boundary_time, second_half_start_window_end, first_half_min_end_time, second_half_min_end_time"
      )
      .eq("id", 1)
      .single();

    if (!error && data) {
      setConfig(data);
    }
  }

  // Live re-check of both windows, purely for UI — see the
  // authoritative-server note in the top comment. Resets whenever the
  // shift state itself changes (e.g. right after Start Shift
  // succeeds) so the very next tick reflects the new state.
  useEffect(() => {
    if (!config) {
      return;
    }

    function recompute() {
      const now = new Date();

      if (!shiftStartAt) {
        setStartWindow(
          calculateStartShiftWindow(now, {
            firstHalfStartTime: config!.first_half_start_time,
            firstHalfStartWindowEnd: config!.first_half_start_window_end,
            secondHalfStartWindowStart: config!.half_day_boundary_time,
            secondHalfStartWindowEnd: config!.second_half_start_window_end
          })
        );
        return;
      }

      if (
        !shiftEndAt &&
        (attendanceType === "FULL_DAY" || attendanceType === "HALF_DAY_SECOND")
      ) {
        setEndWindow(
          calculateEndShiftWindow(
            now,
            attendanceType,
            config!.first_half_min_end_time,
            config!.second_half_min_end_time
          )
        );
      }
    }

    recompute();

    const interval = setInterval(recompute, WINDOW_RECHECK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [config, shiftStartAt, shiftEndAt, attendanceType]);

  // Both Start Shift and End Shift need the current session's access
  // token — Edge Functions require it in the Authorization header,
  // and resolve which employee is calling from that token itself
  // (never from a client-supplied id).
  async function getAccessTokenOrWarn(): Promise<string | null> {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();

    if (sessionError || !session) {
      toast.error("Your session has expired — please log in again.");
      return null;
    }

    return session.access_token;
  }

  function startShift() {
    if (!navigator.geolocation) {
      toast.error("Location isn't available on this device/browser.");
      return;
    }

    setStarting(true);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {

          const accessToken = await getAccessTokenOrWarn();

          if (!accessToken) {
            return;
          }

          // Server-side geofence + time-window checks are
          // authoritative (start-shift Edge Function) — this call
          // only supplies raw coordinates. The Edge Function resolves
          // which employee this is from the Authorization token
          // itself, not from the body.
          const res = await fetch(
            "https://inmxkanrwcjlgajqpcuf.supabase.co/functions/v1/start-shift",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${accessToken}`
              },
              body: JSON.stringify({
                lat: position.coords.latitude,
                lng: position.coords.longitude
              })
            }
          );

          const result = await res.json();

          if (!result.success) {
            toast.error(result.message || "Could not start shift.");
            return;
          }

          setShiftStartAt(result.shiftStartAt || new Date().toISOString());
          setAttendanceType(result.attendanceType || attendanceType);

          toast.success(
            result.alreadyStarted
              ? "Shift already started today."
              : "Shift started — new leads are unlocked for today."
          );

        } catch (err) {
          console.log(err);
          toast.error("Something went wrong starting your shift.");
        } finally {
          setStarting(false);
        }
      },
      (geoError) => {
        console.log(geoError);
        toast.error("Couldn't get your location. Please allow location access and try again.");
        setStarting(false);
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  async function endShift() {
    setEnding(true);

    try {

      const accessToken = await getAccessTokenOrWarn();

      if (!accessToken) {
        return;
      }

      // No geofence check on End Shift, by design — see
      // supabase/functions/end-shift for why. The time-window check
      // is still authoritative there, same as Start Shift. No body
      // fields are required; identity comes entirely from the token.
      const res = await fetch(
        "https://inmxkanrwcjlgajqpcuf.supabase.co/functions/v1/end-shift",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${accessToken}`
          },
          body: JSON.stringify({})
        }
      );

      const result = await res.json();

      if (!result.success) {
        toast.error(result.message || "Could not end shift.");
        return;
      }

      setShiftEndAt(result.shiftEndAt || new Date().toISOString());
      setAttendanceType(result.attendanceType || attendanceType);

      toast.success(
        result.alreadyEnded
          ? "Shift already ended today."
          : "Shift ended for today."
      );

    } catch (err) {
      console.log(err);
      toast.error("Something went wrong ending your shift.");
    } finally {
      setEnding(false);
    }
  }

  if (checking) {
    return null;
  }

  const started = Boolean(shiftStartAt);
  const ended = Boolean(shiftEndAt);

  const canStart = !config || !startWindow ? false : startWindow.allowed;
  const canEnd = !config || !endWindow ? false : endWindow.allowed;

  if (compact) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="mx-4 mt-4 flex items-center justify-between gap-3 rounded-xl bg-white border border-slate-100 shadow-sm px-4 py-2.5"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`h-2 w-2 rounded-full shrink-0 ${
              ended ? "bg-slate-300" : started ? "bg-emerald-500" : "bg-amber-400"
            }`}
          />
          <p className="text-xs font-semibold text-slate-600 truncate">
            {ended
              ? "Shift ended"
              : started
              ? `Shift active since ${new Date(shiftStartAt!).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit"
                })}`
              : "Shift not started — new leads are locked"}
          </p>
        </div>

        {/* Only the Start action is duplicated here — End Shift stays
            exclusively on the full card (Posts): it's a voluntary,
            low-priority action per the top-level comment, no need to
            surface it everywhere shift-status is glanceable. */}
        {!started && !ended && (
          <motion.button
            whileTap={canStart ? { scale: 0.96 } : undefined}
            disabled={starting || !canStart}
            onClick={startShift}
            className={`shrink-0 flex items-center gap-1 h-8 px-3 rounded-lg text-[11px] font-bold disabled:opacity-50 ${
              canStart
                ? "bg-gradient-to-r from-yellow-400 to-amber-500 text-slate-900"
                : "bg-slate-100 text-slate-400"
            }`}
          >
            {starting ? <Loader2 className="animate-spin" size={11} /> : <MapPin size={11} />}
            {starting ? "Starting..." : "Start"}
          </motion.button>
        )}
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.8 }}
      className="relative mx-4 mt-4 overflow-hidden rounded-[24px] bg-white border border-slate-100 shadow-md p-6"
    >
      {/* Premium accent touch — static glow, not a looping hero animation */}
      <div className="pointer-events-none absolute -top-10 -right-10 h-32 w-32 rounded-full bg-gradient-to-br from-amber-300/40 via-yellow-400/20 to-transparent blur-2xl" />

      <p className="relative text-[10px] font-semibold tracking-[0.2em] text-amber-600 uppercase mb-3">
        Today&apos;s Shift
      </p>

      <AnimatePresence mode="wait">
        {ended ? (
          <motion.div
            key="ended"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.4 }}
            className="relative flex items-center gap-4"
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-200">
              <CheckCheck className="text-slate-600" size={22} />
            </div>

            <div>
              <p className="text-base font-bold text-slate-800">
                Shift Ended
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                {new Date(shiftStartAt!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                {" – "}
                {new Date(shiftEndAt!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>
          </motion.div>
        ) : started ? (
          <motion.div
            key="started"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.4 }}
            className="relative flex items-center justify-between gap-4 flex-wrap"
          >
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-green-400 to-emerald-600 shadow-[0_8px_20px_rgba(22,163,74,0.35)]">
                <CheckCircle2 className="text-white" size={24} />
              </div>

              <div>
                <p className="text-base font-bold text-slate-800">
                  Shift Started
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  at{" "}
                  {new Date(shiftStartAt!).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit"
                  })}{" "}
                  — new leads are unlocked for today
                </p>
              </div>
            </div>

            {/* Secondary action — intentionally low-emphasis, since
                ending a shift is voluntary/optional, unlike starting
                one (which unlocks new leads and deserves the primary
                gold CTA treatment above). */}
            <motion.button
              whileHover={canEnd ? { scale: 1.02 } : undefined}
              whileTap={canEnd ? { scale: 0.98 } : undefined}
              disabled={ending || !canEnd}
              onClick={endShift}
              className="flex items-center gap-1.5 h-9 px-4 rounded-lg text-xs font-semibold text-slate-500 border border-slate-200 hover:bg-slate-50 disabled:opacity-60"
            >
              {ending ? <Loader2 className="animate-spin" size={13} /> : null}
              {ending ? "Ending..." : "End Shift"}
            </motion.button>

            {!canEnd && endWindow?.reason && (
              <p className="basis-full text-[11px] text-slate-400 mt-1">
                {endWindow.reason}
              </p>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="not-started"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.4 }}
            className="relative flex items-center justify-between gap-4 flex-wrap"
          >
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-yellow-400 to-amber-500 shadow-[0_8px_20px_rgba(217,119,6,0.35)]">
                <Clock className="text-slate-900" size={22} />
              </div>

              <div>
                <p className="text-base font-bold text-slate-800">
                  Shift Not Started
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Start your shift from the office to unlock new leads
                </p>
              </div>
            </div>

            <motion.button
              whileHover={canStart ? { scale: 1.02 } : undefined}
              whileTap={canStart ? { scale: 0.98 } : undefined}
              disabled={starting || !canStart}
              onClick={startShift}
              className={`flex items-center gap-2 h-11 px-5 rounded-xl font-semibold shadow-[0_8px_20px_rgba(217,119,6,0.3)] disabled:opacity-60 ${
                canStart
                  ? "text-slate-900 bg-gradient-to-r from-yellow-400 to-amber-500"
                  : "text-slate-400 bg-slate-100 shadow-none"
              }`}
            >
              {starting ? (
                <Loader2 className="animate-spin" size={16} />
              ) : (
                <MapPin size={16} />
              )}
              {starting ? "Starting..." : "Start Shift"}
            </motion.button>

            {!canStart && startWindow?.reason && (
              <p className="basis-full text-[11px] text-amber-700 bg-amber-50 rounded-lg px-2.5 py-1.5">
                {startWindow.reason}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
