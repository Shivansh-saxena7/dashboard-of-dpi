"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { supabase } from "@/lib/supabase";
import {
  Bell,
  Search,
  CheckCircle2,
  XCircle,
} from "lucide-react";

import PageHeader from "@/components/PageHeader";
export default function NotificationsPage() {

  // Server-side (2026-10-03): this used to load the whole notification
  // table into the browser, which PostgREST silently capped at 1000 rows,
  // so the page showed "Total 1000" (real: 8,000+) and an incomplete list
  // and unread count. Counts are now exact head counts; the list is the
  // newest PAGE_SIZE matching rows, searched in the DB, with "Load more".
  const PAGE_SIZE = 100;
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [matchingCount, setMatchingCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    loadCounts();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => loadNotifications(search, limit), 300);
    return () => clearTimeout(timer);
  }, [search, limit]);

  async function loadCounts() {
    const [{ count: totalCount }, { count: unreadCount }] = await Promise.all([
      supabase.from("notification").select("id", { count: "exact", head: true }),
      supabase.from("notification").select("id", { count: "exact", head: true }).eq("is_read", false)
    ]);
    setTotal(totalCount ?? 0);
    setUnread(unreadCount ?? 0);
  }

  async function loadNotifications(searchText: string, rowLimit: number) {
    setLoading(true);

    let query = supabase
      .from("notification")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(0, rowLimit - 1);

    // Commas and parentheses would break the PostgREST or() filter syntax.
    const q = searchText.trim().replace(/[,()]/g, " ");
    if (q) {
      query = query.or(`employee_name.ilike.%${q}%,title.ilike.%${q}%,message.ilike.%${q}%`);
    }

    const { data, error, count } = await query;

    if (!error) {
      setNotifications(data || []);
      setMatchingCount(count ?? 0);
    }

    setLoading(false);
  }

  const filteredNotifications = notifications;

  return (

    <div className="space-y-6 pb-10">
        {/* HEADER */}

      <PageHeader
  eyebrow="Content & Support"
  title="Notification History"
  description="View all notifications sent to employees."
      />
      {/* SEARCH + STATS */}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5">

        <div
          className="
          col-span-2
          bg-white
          rounded-[24px]
          border
          border-slate-100
          shadow-md
          p-4
          "
        >

          <div className="flex items-center gap-3">

            <Search
              size={20}
              className="text-slate-500"
            />

            <input
              value={search}
              onChange={(e) =>
                setSearch(e.target.value)
              }
              placeholder="Search employee, title or message..."
              className="
              w-full
              outline-none
              bg-transparent
              "
            />

          </div>

        </div>

        <div
          className="
          bg-white
          rounded-[24px]
          border
          border-slate-100
          shadow-md
          p-5
          "
        >

          <p className="text-sm text-slate-500">

            Total

          </p>

          <h1 className="mt-2 text-3xl font-bold">

            {total}

          </h1>

        </div>

        <div
          className="
          bg-white
          rounded-[24px]
          border
          border-slate-100
          shadow-md
          p-5
          "
        >

          <p className="text-sm text-slate-500">

            Unread

          </p>

          <h1 className="mt-2 text-3xl font-bold text-red-500">

            {unread}

          </h1>

        </div>

      </div>
      {/* NOTIFICATION LIST */}

      {loading ? (

        <div className="bg-white rounded-[24px] p-10 text-center shadow">

          Loading notifications...

        </div>

      ) : filteredNotifications.length === 0 ? (

        <div className="bg-white rounded-[24px] p-10 text-center shadow">

          <Bell
            size={60}
            className="mx-auto text-blue-500"
          />

          <h2 className="mt-5 text-2xl font-bold">

            No Notifications Found

          </h2>

          <p className="mt-2 text-slate-500">

            Notifications will appear here automatically.

          </p>

        </div>

      ) : (

        <div className="space-y-4">

          {filteredNotifications.map((item) => (

            <motion.div
              key={item.id}
              initial={{
                opacity: 0,
                y: 15,
              }}
              animate={{
                opacity: 1,
                y: 0,
              }}
              className="
              bg-white
              rounded-[24px]
              border
              border-slate-100
              shadow-md
              p-4 sm:p-6
              "
            >

              <div className="flex flex-col sm:flex-row sm:justify-between items-start gap-3 sm:gap-5">

                <div className="flex gap-3 sm:gap-4 flex-1 min-w-0 w-full">

                  <div
                    className="
                    shrink-0 h-11 w-11 sm:h-14 sm:w-14
                    
                    rounded-2xl
                    bg-gradient-to-br
                    from-cyan-500
                    to-blue-600
                    flex
                    items-center
                    justify-center
                    text-white
                    "
                  >

                    <Bell size={24} />

                  </div>

                  <div className="flex-1 min-w-0">

                    <h2 className="font-bold text-base sm:text-lg break-words">

                      {item.title}

                    </h2>

                    <p className="text-slate-500 text-sm mt-1">

                      {item.employee_name}

                    </p>

                    <p className="mt-3 leading-7 text-slate-700 break-words">

                      {item.message}

                    </p>

                  </div>

                </div>
                <div className="flex sm:flex-col items-center sm:items-end gap-3 shrink-0">

                  {item.is_read ? (

                    <div
                      className="
                      flex
                      items-center
                      gap-2

                      rounded-full

                      bg-green-100

                      px-3
                      py-1

                      text-xs
                      font-semibold

                      text-green-700
                      "
                    >

                      <CheckCircle2 size={14} />

                      Read

                    </div>

                  ) : (

                    <div
                      className="
                      flex
                      items-center
                      gap-2

                      rounded-full

                      bg-red-100

                      px-3
                      py-1

                      text-xs
                      font-semibold

                      text-red-700
                      "
                    >

                      <XCircle size={14} />

                      Unread

                    </div>

                  )}

                  <p className="text-xs text-slate-500">

                    {new Date(
                      item.created_at
                    ).toLocaleString("en-IN", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    

                  </p>
                  {item.is_read && item.read_at && (

  <p className="text-xs text-green-600 mt-2 font-medium">

    Read At:{" "}

    {new Date(item.read_at).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })}

  </p>

)}

                </div>

              </div>

            </motion.div>

          ))}

          {notifications.length < matchingCount && (
            <div className="flex justify-center pt-2">
              <button
                onClick={() => setLimit((l) => l + PAGE_SIZE)}
                className="h-10 px-5 rounded-xl bg-white border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
              >
                Load more ({notifications.length} of {matchingCount})
              </button>
            </div>
          )}

        </div>

      )}

    </div>

  );

}