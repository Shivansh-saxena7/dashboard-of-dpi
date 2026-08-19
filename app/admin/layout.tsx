"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect,useState } from "react";
import { supabase } from "@/lib/supabase";
import { Menu,X } from "lucide-react";
import { useRouter } from "next/navigation";
import SessionGuard from "@/components/SessionGuard";
import Footer from "@/components/Footer";

export default function AdminLayout({
children,
}:{
children:React.ReactNode
}){

const [adminName,setAdminName]=useState("Admin");
const [menuOpen,setMenuOpen]=useState(false);
const router=useRouter();



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

if(data.role !== "admin"){
  router.replace("/");
  return;
}

setAdminName(data.name);

};
const menu=[

{
name:"Dashboard",
href:"/admin",
icon:"📊"
},

{
name:"Employees",
href:"/admin/employees",
icon:"👥"
},

{
name:"Leads",
href:"/admin/leads",
icon:"🎯"
},

{
name:"Coordinator View",
href:"/coordinator",
icon:"🧭"
},

{
name:"Leaderboard",
href:"/admin/leaderboard",
icon:"🏆"
},

{
name:"Work Reports",
href:"/admin/work-reports",
icon:"📋"
},

{
name:"Meta Datasets",
href:"/admin/meta-datasets",
icon:"🔗"
},

{
name:"Tickets",
href:"/admin/tickets",
icon:"🎫"
},

{
name:"Project Assets",
href:"/admin/project-assets",
icon:"🗂️"
},

{
name:"Teams",
href:"/admin/teams",
icon:"🧑‍🤝‍🧑"
},

{
name:"Project Rules",
href:"/admin/project-rules",
icon:"🏢"
},

{
name:"Posts",
href:"/admin/posts",
icon:"📝"
},

{
name:"Analytics",
href:"/admin/analytics",
icon:"📈"
},

{
name:"Notifications",
href:"/admin/notifications",
icon:"🔔"
},
{
  name: "Notification Templates",
  href: "/admin/notification-templates",
  icon: "📝"
},
{
name:"Settings",
href:"/admin/settings",
icon:"⚙️"
}

];
const handleLogout=async()=>{

await supabase.auth.signOut();

router.push("/login");

}

return(
<SessionGuard>
<div className="min-h-screen bg-[#f4f8fc] flex">

{/* Mobile Overlay */}

{
menuOpen &&
<div
onClick={()=>setMenuOpen(false)}
className="
fixed
inset-0
bg-black/40
z-40
lg:hidden
"
/>
}

{/* Sidebar */}

<div
className={`

fixed
top-0
left-0
z-50
h-screen
w-[230px]
bg-white
border-r
border-slate-200
transition-all
duration-300
shadow-xl
flex
flex-col

${menuOpen
? "translate-x-0"
: "-translate-x-full"
}

lg:translate-x-0

`}
>

<div className="p-3 lg:p-5">

<div className="flex items-center gap-4">

<div
className="
relative
w-16
h-16
rounded-2xl
bg-white
shadow-lg
overflow-hidden
"
>

<Image
src="/dpilogo.png"
alt="logo"
fill
className="object-contain scale-150"
/>

</div>

<div>

<h2
className="
font-bold
text-slate-800
"
>

{adminName}

</h2>

<p
className="
text-sm
text-slate-500
"
>

Admin Portal

</p>

</div>

</div>

</div>


<div className="flex-1 overflow-y-auto px-4 space-y-2">

{
menu.map((item)=>(

<Link

key={item.href}
href={item.href}

onClick={()=>setMenuOpen(false)}

className="
flex
items-center
gap-4
px-4
py-4
rounded-2xl
hover:bg-gradient-to-r
hover:from-cyan-500
hover:to-blue-600
hover:text-white
transition-all
font-medium
text-slate-700
"

>

<span>

{item.icon}

</span>

{item.name}

</Link>

))
}
<div className="p-4 border-t border-slate-200">

<button
onClick={handleLogout}
className="
w-full
rounded-xl
bg-red-500
text-white
py-3
font-medium
hover:bg-red-600
transition
"
>

Logout

</button>

</div>

</div>

</div>



{/* Right Side */}

{/* min-w-0: flex items default to min-width:auto, which floors them
    at their content's min-content size — no matter how deeply
    nested, an un-wrapped/wide descendant (e.g. a horizontally-
    scrollable table many levels down) pushes THIS flex item wider
    than its allotted space, which pushes the whole page into
    horizontal overflow. The descendant's own overflow-x-auto only
    contains overflow for itself, not for this ancestor. min-w-0
    breaks that propagation at the one place it actually needs to
    break — confirmed empirically (documentScrollWidth stopped
    exceeding window.innerWidth once this was added). */}
<div
className="
flex-1
lg:ml-[230px]
w-full
min-w-0
"
>

{/* Top */}

<div
className="
sticky
top-0
z-30
bg-white/90
backdrop-blur-xl
border-b
border-slate-200
px-5
h-[60px]
flex
items-center
justify-between
"
>

<div className="flex items-center gap-4">

<button
onClick={()=>setMenuOpen(true)}
className="lg:hidden"
>

<Menu size={30}/>

</button>

<div>

<h1
className="
font-bold
text-xl lg:text-xl
text-slate-800
"
>

Admin Dashboard

</h1>

<p
className="
text-slate-500
text-xs
"
>

Welcome back,
{" "}
{adminName}

</p>

</div>

</div>


<div
className="
h-10
w-10
rounded-full
bg-gradient-to-r
from-cyan-500
to-blue-600
flex
items-center
justify-center
text-white
font-bold
shadow-lg
"
>

{adminName.charAt(0)}

</div>

</div>


{/* Page Content */}

<div
className="
p-3
lg:p-5
"
>

{children}
<Footer />

</div>

</div>

</div>
</SessionGuard>

)

}