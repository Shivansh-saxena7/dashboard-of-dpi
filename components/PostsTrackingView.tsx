"use client";

import { useEffect, useState } from "react";
import StatsCard from "./StatsCard";
import EmployeePanel from "./EmployeePanel";
import { reportClientError } from "@/lib/reportClientError";
import { authedFetch } from "@/lib/authedFetch";

// Employee-facing social-media post tracking (open link -> Mark Done)
// factored out of app/page.tsx so HR/Payroll/Other-department views can
// mount the exact same read/complete-only experience without pulling in
// Sales-specific pieces (StartShiftCard, EmployeeTabBar) that live in
// app/page.tsx itself. selectedEmployee is permanently pinned to the
// viewer's own id -- never a dropdown over other employees -- so this
// can never become a "mark done on someone else's behalf" surface, and
// it never touches app/admin/posts/page.tsx (post creation/assignment
// stays Admin/Super Admin only).
export default function PostsTrackingView({
  employeeId,
  employeeName
}: {
  employeeId: string;
  employeeName: string;
}) {
  const [data, setData] = useState<any[]>([]);
  const [selectedDate, setSelectedDate] = useState("");

  useEffect(() => {
    const today = new Date().toISOString().split("T")[0];
    setSelectedDate(today);
  }, []);

  async function loadData(date: string) {
    try {
      const query = new URLSearchParams({
        date: date || "",
        employeeId: employeeId || ""
      });

      const res = await authedFetch(`/api/data?${query}`, { cache: "no-store" });

      if (!res.ok) {
        setData([]);
        return;
      }

      const json = await res.json();
      const records = Array.isArray(json) ? json : json.data || [];
      setData(records);
    } catch (err) {
      console.log(err);
reportClientError("load posts tracking", err);
      setData([]);
    }
  }

  useEffect(() => {
    if (!employeeId || !selectedDate) return;
    loadData(selectedDate);
    // Refresh when the employee comes back to the page, and once a minute while it is open.
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") loadData(selectedDate);
    };
    const interval = setInterval(refreshIfVisible, 60000);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [employeeId, selectedDate]);

  const filteredData = selectedDate
    ? data.filter((d: any) => {
        const date = new Date(d.Date);
        const formatted =
          date.getFullYear() +
          "-" +
          String(date.getMonth() + 1).padStart(2, "0") +
          "-" +
          String(date.getDate()).padStart(2, "0");
        return formatted === selectedDate;
      })
    : data;

  const stats = {
    ig: filteredData.filter((d) => d["IG Like"] === "YES").length,
    fb: filteredData.filter((d) => d["FB Like"] === "YES").length,
    posts: new Set(filteredData.map((d) => d["Post ID"])).size,
    employees: new Set(filteredData.map((d) => d.Employee)).size,
    engagement:
      filteredData.length > 0
        ? Math.round(
            ((filteredData.filter((d) => d["IG Like"] === "YES").length +
              filteredData.filter((d) => d["FB Like"] === "YES").length) /
              (filteredData.length * 2)) *
              100
          )
        : 0
  };

  return (
    <div>
      <div className="px-4 mt-4 space-y-3">
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="w-full max-w-full box-border border px-3 py-2 rounded-md text-[16px] text-gray-800 bg-white shadow appearance-none"
          style={{ minWidth: 0, WebkitAppearance: "none" }}
        />
        <button
          onClick={() => setSelectedDate(new Date().toISOString().split("T")[0])}
          className="w-full text-xs text-gray-700 font-medium py-2 bg-gray-100 rounded-md hover:bg-gray-200 appearance-none"
          style={{ WebkitAppearance: "none" }}
        >
          Today Data
        </button>
      </div>

      <StatsCard stats={stats} employeeName={employeeName || "Employee"} />

      {filteredData.length === 0 ? (
        <div className="flex flex-col items-center justify-center mt-16 text-center px-4">
          <div className="text-5xl mb-3">📭</div>
          <h2 className="text-lg font-semibold text-gray-700">No Data Available</h2>
          <p className="text-sm text-gray-500 mt-1">No records found for selected date</p>
        </div>
      ) : (
        <EmployeePanel
          data={filteredData}
          employee={{ id: employeeId, role: "employee" }}
          selectedEmployee={employeeId}
          setSelectedEmployee={() => {}}
          selectedDate={selectedDate}
        />
      )}
    </div>
  );
}
