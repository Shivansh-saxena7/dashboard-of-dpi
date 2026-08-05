"use client";

import { motion } from "framer-motion";
import { ChevronRight } from "lucide-react";

export type MemberAttendanceStatus = "NOT_STARTED" | "ACTIVE" | "ENDED";

interface TeamMemberCardProps {
  member: {
    id: string;
    name: string;
    is_active: boolean;
  };
  attendanceStatus: MemberAttendanceStatus;
  leadCount: number;
  dataCount: number;
  points: number;
  onOpen: () => void;
  index?: number;
}

const ATTENDANCE_DISPLAY: Record<MemberAttendanceStatus, { label: string; className: string }> = {
  NOT_STARTED: { label: "Not Started", className: "bg-slate-100 text-slate-500" },
  ACTIVE: { label: "Shift Active", className: "bg-green-50 text-green-700" },
  ENDED: { label: "Shift Ended", className: "bg-slate-100 text-slate-500" }
};

// Read-only roster row — tapping opens TeamMemberDetailModal. Styled
// employee-side (gold), not admin-side (blue-cyan), since /team is
// part of the employee app shell (reached via EmployeeTabBar), even
// though a team_leader is viewing it.
export default function TeamMemberCard({ member, attendanceStatus, leadCount, dataCount, points, onOpen, index = 0 }: TeamMemberCardProps) {

  const attendance = ATTENDANCE_DISPLAY[attendanceStatus];
  const initial = member.name?.charAt(0)?.toUpperCase() || "?";

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: Math.min(index, 10) * 0.04 }}
      whileHover={{ y: -2 }}
      onClick={onOpen}
      className="flex items-center gap-3 rounded-[18px] bg-white border border-slate-100 shadow-[0_4px_16px_rgba(15,23,42,0.06)] hover:shadow-[0_8px_24px_rgba(15,23,42,0.1)] transition-shadow p-4 cursor-pointer"
    >
      <div className="shrink-0 h-11 w-11 rounded-2xl bg-gradient-to-br from-yellow-400 to-amber-500 shadow-[0_4px_12px_rgba(217,119,6,0.3)] flex items-center justify-center text-slate-900 font-bold text-sm">
        {initial}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-bold text-slate-800 truncate">{member.name}</p>
          {!member.is_active && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 shrink-0">
              Inactive
            </span>
          )}
        </div>
        <div className="flex items-center flex-wrap gap-1.5 mt-1.5">
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${attendance.className}`}>
            {attendance.label}
          </span>
          <span className="text-[11px] text-slate-400">{leadCount} leads</span>
          {dataCount > 0 && (
            <span className="text-[11px] font-semibold text-violet-500">· {dataCount} data</span>
          )}
          <span className="text-[11px] text-slate-400">· {points} pts</span>
        </div>
      </div>

      <ChevronRight size={18} className="text-slate-300 shrink-0" />
    </motion.div>
  );
}
