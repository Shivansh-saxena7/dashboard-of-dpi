"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect,useState } from "react";
import { supabase } from "@/lib/supabase";
import { Menu,X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import SessionGuard from "@/components/SessionGuard";
import Footer from "@/components/Footer";
import AdminAnomalyAlerts from "@/components/AdminAnomalyAlerts";
import SidebarNavLink, { isNavItemActive } from "@/components/SidebarNavLink";

// Grouped (UI/UX Phase 6, 2026-10-03) — 22 flat items were hard to scan,
// especially on a phone. Same items, same hrefs, same icons.
const menuSections=[
  {
    title:"Overview",
    items:[
      { name:"Dashboard", href:"/admin", icon:"📊" },
      { name:"Analytics", href:"/admin/analytics", icon:"📈" },
      { name:"Leaderboard", href:"/admin/leaderboard", icon:"🏆" },
      { name:"Work Reports", href:"/admin/work-reports", icon:"📝" }
    ]
  },
  {
    title:"Leads",
    items:[
      { name:"Leads", href:"/admin/leads", icon:"🎯" },
      { name:"Lead Transfers", href:"/admin/lead-transfers", icon:"🔁" },
      { name:"Coordinator View", href:"/coordinator", icon:"🧭" },
      { name:"Teams", href:"/admin/teams", icon:"👥" },
      { name:"Project Rules", href:"/admin/project-rules", icon:"📐" },
      { name:"Project Assets", href:"/admin/project-assets", icon:"🗂️" },
      { name:"Meta Datasets", href:"/admin/meta-datasets", icon:"📡" },
      { name:"Personal Lead Visits", href:"/admin/personal-visits", icon:"🔖" }
    ]
  },
  {
    title:"People",
    items:[
      { name:"Employees", href:"/admin/employees", icon:"🧑‍💼" },
      { name:"Employee Requests", href:"/admin/employee-requests", icon:"📥" },
      { name:"Leave", href:"/admin/leave", icon:"🌴" },
      { name:"HR", href:"/hr/attendance", icon:"🧾" },
      { name:"Payroll", href:"/payroll/expenses", icon:"💰" }
    ]
  },
  {
    title:"Content & Support",
    items:[
      { name:"Posts", href:"/admin/posts", icon:"📸" },
      { name:"Notifications", href:"/admin/notifications", icon:"🔔" },
      { name:"Tickets", href:"/admin/tickets", icon:"🎫" }
    ]
  },
  {
    title:"System",
    items:[
      { name:"Settings", href:"/admin/settings", icon:"⚙️" },
      { name:"Non-working Days", href:"/admin/non-working-days", icon:"⏸️" },
      { name:"System Health", href:"/admin/system-health", icon:"🩺" },
      { name:"Backup Status", href:"/admin/backup-status", icon:"🛟" }
    ]
  }
];

// Pages reachable only from inside another page, so the top bar can
// still name them.
const EXTRA_PAGE_TITLES:Record<string,string>={
  "/admin/notification-templates":"Notification Templates",
  "/admin/leads/import":"Import Leads"
};

function currentPageTitle(pathname:string):string{
  if(EXTRA_PAGE_TITLES[pathname]) return EXTRA_PAGE_TITLES[pathname];
  const match=menuSections
    .flatMap((s)=>s.items)
    .filter((i)=>isNavItemActive(pathname,i.href,"/admin"))
    .sort((a,b)=>b.href.length-a.href.length)[0];
  return match ? match.name : "Admin";
}


export default function AdminLayout({
children,
}:{
children:React.ReactNode
}){

const [adminName,setAdminName]=useState("Admin");
const [menuOpen,setMenuOpen]=useState(false);
const router=useRouter();
const pathname=usePathname();



useEffect(()=>{
loadAdmin();
},[]);

const loadAdmin=async()=>{

const {data:{session}}
=
await supabase.auth.getSession();

if(!session) {
  router.replace("/login");
  return;
}

const {data}
=
await supabase
.from("employees")
.select("name, role, is_active")
.eq(
"auth_user_id",
session.user.id
)
.single();

if(!data){
  router.replace("/login");
  return;
}

if(!data.is_active){
  await supabase.auth.signOut();
  router.replace("/login");
  return;
}

if(data.role !== "admin" && data.role !== "super_admin"){
  router.replace("/");
  return;
}

setAdminName(data.name);

};
const handleLogout=async()=>{

await supabase.auth.signOut();

router.push("/login");

}

return(
<SessionGuard>
<div className="min-h-screen bg-[#f4f8fc] flex">

{menuOpen && (
  <div onClick={()=>setMenuOpen(false)} className="fixed inset-0 bg-black/40 z-40 lg:hidden" />
)}

{/* Sidebar — same shell as app/hr/layout.tsx (UI/UX Phase 6) */}
<div
  className={`fixed top-0 left-0 z-50 h-screen w-[230px] bg-white border-r border-slate-200 shadow-xl flex flex-col transition-transform duration-300 ${
    menuOpen ? "translate-x-0" : "-translate-x-full"
  } lg:translate-x-0`}
>
  <div className="p-5 flex items-center justify-between gap-3">
    <div className="flex items-center gap-3 min-w-0">
      <div className="relative w-12 h-12 rounded-2xl bg-white shadow-lg overflow-hidden shrink-0">
        <Image src="/dpilogo.png" alt="logo" fill className="object-contain scale-150" />
      </div>
      <div className="min-w-0">
        <h2 className="font-bold text-slate-800 truncate">{adminName}</h2>
        <p className="text-[10px] font-semibold tracking-[0.15em] text-slate-400 uppercase">Admin Panel</p>
      </div>
    </div>
    <button onClick={()=>setMenuOpen(false)} aria-label="Close menu" className="lg:hidden shrink-0 h-10 w-10 -mr-2 flex items-center justify-center text-slate-400">
      <X size={22} />
    </button>
  </div>

  <nav className="flex-1 overflow-y-auto px-3 pb-3">
    {menuSections.map((section)=>(
      <div key={section.title} className="mb-3">
        <p className="px-3 pt-2 pb-1 text-[10px] font-bold tracking-[0.15em] text-slate-400 uppercase">{section.title}</p>
        <div className="space-y-0.5">
          {section.items.map((item)=>(
            <SidebarNavLink
              key={item.href}
              href={item.href}
              icon={item.icon}
              name={item.name}
              active={isNavItemActive(pathname,item.href,"/admin")}
              onNavigate={()=>setMenuOpen(false)}
            />
          ))}
        </div>
      </div>
    ))}
  </nav>

  <div className="p-3 border-t border-slate-100">
    <button
      onClick={handleLogout}
      className="w-full flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-semibold bg-red-50 text-red-600 hover:bg-red-100 transition"
    >
      Log Out
    </button>
  </div>
</div>

{/* min-w-0: flex items default to min-width:auto, so a wide
    descendant (e.g. a horizontally-scrollable table) would otherwise
    push this whole column — and the page — into horizontal overflow. */}
<div className="flex-1 lg:ml-[230px] w-full min-w-0">

  <div className="sticky top-0 z-30 bg-white/90 backdrop-blur-xl border-b border-slate-200 px-4 lg:px-5 h-[60px] flex items-center justify-between gap-3">
    <div className="flex items-center gap-3 min-w-0">
      <button onClick={()=>setMenuOpen(true)} aria-label="Open menu" className="lg:hidden h-10 w-10 -ml-2 flex items-center justify-center text-slate-700 shrink-0">
        <Menu size={24}/>
      </button>
      <div className="min-w-0">
        <h1 className="font-bold text-lg text-slate-800 truncate">{currentPageTitle(pathname)}</h1>
        <p className="text-slate-500 text-xs truncate">Welcome back, {adminName}</p>
      </div>
    </div>
    <div className="flex items-center gap-2 shrink-0">
    <AdminAnomalyAlerts />
    <div className="h-10 w-10 shrink-0 rounded-full bg-gradient-to-r from-cyan-500 to-blue-600 flex items-center justify-center text-white font-bold shadow-lg">
      {adminName.charAt(0)}
    </div>
    </div>
  </div>

  <div className="p-3 lg:p-5">
    {children}
    <Footer />
  </div>
</div>

</div>
</SessionGuard>
)
}
