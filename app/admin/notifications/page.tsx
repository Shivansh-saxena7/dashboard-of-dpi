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

export default function NotificationsPage() {

  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    loadNotifications();
  }, []);

  async function loadNotifications() {

    setLoading(true);

    const { data, error } = await supabase
      .from("notification")
      .select("*")
      .order("created_at", {
        ascending: false,
      });

    if (!error) {
      setNotifications(data || []);
    }

    setLoading(false);

  }

  const filteredNotifications =
    notifications.filter((item) =>

      item.employee_name
        ?.toLowerCase()
        .includes(search.toLowerCase())

      ||

      item.title
        ?.toLowerCase()
        .includes(search.toLowerCase())

      ||

      item.message
        ?.toLowerCase()
        .includes(search.toLowerCase())

    );

  const total = notifications.length;

  const read =
    notifications.filter(
      (n) => n.is_read
    ).length;

  const unread =
    notifications.filter(
      (n) => !n.is_read
    ).length;

  return (

    <div className="space-y-6 pb-10">
        {/* HEADER */}

      <motion.div
        initial={{
          opacity: 0,
          y: -20,
        }}
        animate={{
          opacity: 1,
          y: 0,
        }}
        className="
        relative
        overflow-hidden
        rounded-[30px]
        bg-gradient-to-r
        from-slate-900
        via-blue-900
        to-cyan-700
        p-7
        shadow-xl
        "
      >

        <div
          className="
          absolute
          -top-20
          -right-20
          h-64
          w-64
          rounded-full
          bg-white/10
          blur-3xl
          "
        />

        <div className="relative z-10">

          <h1 className="text-4xl font-bold text-white">

            Notification History

          </h1>

          <p className="mt-2 text-blue-100">

            View all notifications sent to employees.

          </p>

        </div>

      </motion.div>
      {/* SEARCH + STATS */}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">

        <div
          className="
          lg:col-span-2
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
              p-6
              "
            >

              <div className="flex justify-between items-start gap-5">

                <div className="flex gap-4 flex-1">

                  <div
                    className="
                    h-14
                    w-14
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

                  <div className="flex-1">

                    <h2 className="font-bold text-lg">

                      {item.title}

                    </h2>

                    <p className="text-slate-500 text-sm mt-1">

                      {item.employee_name}

                    </p>

                    <p className="mt-3 leading-7 text-slate-700">

                      {item.message}

                    </p>

                  </div>

                </div>
                <div className="flex flex-col items-end gap-3">

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

        </div>

      )}

    </div>

  );

}