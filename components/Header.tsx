"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";
import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import Image from "next/image";
import { useRouter } from "next/navigation"; // ✅ ADD
import { Bell } from "lucide-react";
import NotificationModal from "./NotificationModal";
export default function Header() {
  const [open, setOpen] = useState(false);
  const [unreadCount,setUnreadCount] =useState(0);
  const [notifications, setNotifications] = useState<any[]>([]);
const [showNotifications, setShowNotifications] = useState(false);

  // ✅ ADD
  const router = useRouter();

 
useEffect(() => {

const loadUnreadCount = async () => {

const {
  data: { user }
} = await supabase.auth.getUser();

console.log("AUTH USER ID =", user?.id);

const { data: employee } = await supabase
  .from("employees")
  .select("id")
  .eq("auth_user_id", user?.id)
  .single();

if (!employee) return;

const { count, error } = await supabase
  .from("notification")
  .select("*", {
    count: "exact",
    head: true
  })
  .eq("employee_id", employee.id)
  .eq("is_read", false);

console.log("EMPLOYEE ID =", employee.id);
console.log("COUNT =", count);
console.log("COUNT ERROR =", error);

setUnreadCount(count || 0);
};

loadUnreadCount();

}, []);
useEffect(() => {

let channel: any;

const setupRealtime = async () => {

const {
  data: { user }
} = await supabase.auth.getUser();

if (!user) return;

const { data: employee } = await supabase
  .from("employees")
  .select("id")
  .eq("auth_user_id", user.id)
  .single();

if (!employee) return;

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

  const notificationEmployeeId =
    payload.new?.employee_id;

  if (
    notificationEmployeeId !==
    employee.id
  ) {
    return;
  }

  console.log(
    "REALTIME EVENT",
    payload
  );

  setUnreadCount(
    (prev) => prev + 1
  );

  await loadNotifications();
}
  )
  .subscribe((status) => {

    console.log(
      "REALTIME STATUS",
      status
    );

  });

};

setupRealtime();

return () => {

if (channel) {

supabase.removeChannel(channel);

}

};

}, []);
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
    .order("created_at", {
  ascending: false
})
.limit(50);

  setNotifications(data || []);

};
  // ✅ ADD
  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <>
      {/* HEADER */}
      <div className="w-full sticky top-0 z-50 backdrop-blur-xl bg-gradient-to-r from-white/70 via-blue-100/60 to-white/70 border-b border-white/30 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-3 flex justify-between items-center">

          <div className="flex items-center gap-3">
            
            {/* ✅ LOGO REPLACED */}
            <Image
              src="/dpilogo.png"
              alt="Logo"
              width={52}
              height={52}
              className="rounded-full"
            />

            <h1 className="text-sm font-semibold">DIVYA PADMA INFOSYSTEM LLP</h1>
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

if(employee){

  await supabase
    .from("notification")
    .update({
  is_read: true,
  read_at: new Date().toISOString(),
})
    .eq("employee_id", employee.id)
    .eq("is_read", false);

  setUnreadCount(0);

}

    setShowNotifications(
      !showNotifications
    );

  }}
  className="relative p-2 rounded-lg bg-white/70 shadow"
>
    <Bell size={20} />
{unreadCount > 0 && (
  <span
    className="
    absolute
    -top-1
    -right-1
    h-5
    w-5
    rounded-full
    bg-red-500
    text-white
    text-[10px]
    flex
    items-center
    justify-center
    font-bold
    animate-pulse
    "
  >
    {unreadCount}
  </span>
)}

  </button>


  <button
    onClick={() => setOpen(true)}
    className="p-2 rounded-lg bg-white/70 shadow"
  >
    ☰
  </button>

</div>

        </div>
      </div>
  {showNotifications && (

<NotificationModal
notifications={notifications}
onClose={() => setShowNotifications(false)}
/>

)}
      {/* DRAWER */}
      <AnimatePresence>
        {open && (
          <>
            {/* OVERLAY */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.35 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 bg-black z-40"
            />

            {/* PANEL */}
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 110 }}
              className="fixed top-0 right-0 h-full w-[82%] max-w-sm z-50 p-6 flex flex-col
              
              bg-gradient-to-br from-white via-blue-50 to-blue-100
              
              shadow-2xl border-l border-white/40 backdrop-blur-2xl"
            >

              {/* CLOSE */}
              <button
                onClick={() => setOpen(false)}
                className="self-end text-gray-600 text-xl mb-4"
              >
                ✕
              </button>

              {/* BRAND TOP */}
              <div className="flex items-center gap-3 mb-8">

                {/* ✅ LOGO REPLACED */}
                <Image
                  src="/dpilogo.png"
                  alt="Logo"
                  width={60}
                  height={60}
                  className="rounded-full shadow-md"
                />

                <div>
                  <h2 className="text-base font-semibold text-gray-800 leading-tight">
                    DIVYA PADMA
                  </h2>
                  <p className="text-xs text-gray-500">
                    INFOSYSTEM LLP
                  </p>
                </div>

              </div>

              {/* MENU */}
              <div className="flex flex-col gap-5 text-gray-700 font-medium">

                <a className="flex items-center gap-3 p-3 rounded-xl bg-white/60 backdrop-blur-md shadow-sm hover:shadow-md hover:scale-[1.03] transition">

                  <span className="text-xl">📸</span>
                  Instagram

                </a>

                <a className="flex items-center gap-3 p-3 rounded-xl bg-white/60 backdrop-blur-md shadow-sm hover:shadow-md hover:scale-[1.03] transition">

                  <span className="text-xl">📘</span>
                  Facebook

                </a>

                <a className="flex items-center gap-3 p-3 rounded-xl bg-white/60 backdrop-blur-md shadow-sm hover:shadow-md hover:scale-[1.03] transition">

                  <span className="text-xl">▶️</span>
                  YouTube

                </a>

                {/* ✅ LOGOUT BUTTON ADDED */}
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-3 p-3 rounded-xl bg-red-500 text-white shadow-sm hover:shadow-md hover:scale-[1.03] transition"
                >

                  <span className="text-xl">🚪</span>
                  Logout

                </button>

              </div>

              {/* BOTTOM INFO */}
              <div className="mt-auto pt-6 border-t border-gray-200 text-xs text-gray-600 leading-relaxed">

                <p className="font-medium text-gray-700 mb-1">
                  Contact Info
                </p>

                <p>Techzone 4, Greater Noida West</p>
                <p>📞 9220907340</p>

              </div>

            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}