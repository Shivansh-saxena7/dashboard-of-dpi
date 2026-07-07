"use client";

import { useState } from "react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { motion } from "framer-motion";
import {
Building2,
ShieldCheck,
Sparkles
} from "lucide-react";

import { supabase } from "@/lib/supabase";

export default function LoginPage() {

const [email,setEmail]=useState("");
const [password,setPassword]=useState("");
const [loading,setLoading]=useState(false);
const router = useRouter();

useEffect(() => {
  checkSession();
}, []);

const checkSession = async () => {

const { data:{session } } =
await supabase.auth.getSession();

if(!session) return;

const { data: employee } =
await supabase
.from("employees")
.select("*")
.eq(
 "auth_user_id",
 session.user.id
)
.single();
if (!employee?.is_active) {

  await supabase.auth.signOut();

  return;

}

if(employee?.role==="admin"){
   router.replace("/admin");
}else{
   router.replace("/");
}

};


const handleLogin = async () => {
  try {

    setLoading(true);

    const { data, error } =
    await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if(error){
      alert(error.message);
      return;
    }

    const { data: employee } =
    await supabase
    .from("employees")
    .select("*")
    .eq(
      "auth_user_id",
      data.user.id
    )
    .single();
if (!employee?.is_active) {

  await supabase.auth.signOut();

  alert(
    "Your account has been deactivated. Please contact administrator."
  );

  return;

}
   if(employee?.role==="admin"){
   router.replace("/admin");
}else{
   router.replace("/");
}

  } catch(err){

    console.log(err);
    alert("Something went wrong");

  } finally {

    setLoading(false);

  }
};

return (

<div className="min-h-screen relative overflow-hidden bg-[#080808] flex items-center justify-center px-5 py-8">

{/* Background */}
<div className="absolute inset-0 bg-gradient-to-br from-black via-[#0b0b0b] to-[#111827]" />

{/* Gold glow */}
<motion.div
animate={{
x:[-20,20,-20],
y:[0,-20,0]
}}
transition={{
duration:10,
repeat:Infinity
}}
className="absolute top-[-150px] left-[-150px] w-[450px] h-[450px] rounded-full bg-yellow-500/10 blur-[140px]"
/>

{/* Blue glow */}
<motion.div
animate={{
x:[20,-20,20],
y:[0,20,0]
}}
transition={{
duration:12,
repeat:Infinity
}}
className="absolute bottom-[-150px] right-[-150px] w-[450px] h-[450px] rounded-full bg-cyan-500/10 blur-[140px]"
/>

{/* Grid */}
<div
className="absolute inset-0 opacity-[0.05]
bg-[linear-gradient(to_right,#ffffff_1px,transparent_1px),
linear-gradient(to_bottom,#ffffff_1px,transparent_1px)]
bg-[size:55px_55px]"
/>

{/* floating icons */}

<motion.div
animate={{y:[0,-20,0]}}
transition={{
duration:4,
repeat:Infinity
}}
className="absolute left-[10%] top-[25%] text-yellow-400/10"
>
<Building2 size={100}/>
</motion.div>

<motion.div
animate={{y:[0,20,0]}}
transition={{
duration:5,
repeat:Infinity
}}
className="absolute right-[10%] bottom-[25%] text-cyan-400/10"
>
<ShieldCheck size={90}/>
</motion.div>


{/* Main Card */}

<motion.div
initial={{
opacity:0,
y:40
}}

animate={{
opacity:1,
y:0
}}

transition={{
duration:1
}}

className="relative z-10 w-full max-w-[430px]"
>

<div
className="
bg-white/[0.04]
backdrop-blur-3xl
border
border-white/10
rounded-[38px]
px-8
py-10
shadow-[0_0_70px_rgba(0,255,255,.15)]
"
>

{/* Logo */}

<div className="flex justify-center mb-8">

<div className="
relative
h-[100px]
w-[100px]
rounded-[30px]
bg-white
overflow-hidden
shadow-[0_0_60px_rgba(255,255,255,.35)]
border border-white/80
">

<Image
src="/dpilogo.png"
alt="DPI Logo"
fill
sizes="130px"
className="
object-contain
scale-[1.45]
p-1
"
/>

</div>
</div>


{/* Heading */}

<div className="text-center">

<h1 className="
text-white
font-bold
text-[42px]
leading-none
tracking-tight
">

DPI Dashboard

</h1>

<p className="
text-yellow-300/80
text-sm
mt-4
">

DIVYA PADMA INFOSYSTEM LLP

</p>

</div>


{/* Inputs */}

<div className="mt-10 space-y-5">

<div>

<label className="
text-gray-300
text-sm
mb-2
block
">

Email Address

</label>

<input
type="email"
value={email}
onChange={(e)=>setEmail(e.target.value)}
placeholder="Enter your email"
className="
w-full
h-[58px]
rounded-2xl
bg-white/[0.05]
border
border-white/10
px-5
text-white
placeholder:text-gray-500
outline-none
transition-all
focus:border-yellow-400
focus:ring-4
focus:ring-yellow-400/20
"
/>

</div>


<div>

<label className="
text-gray-300
text-sm
mb-2
block
">

Password

</label>

<input
type="password"
value={password}
onChange={(e)=>setPassword(e.target.value)}
placeholder="Enter password"
className="
w-full
h-[58px]
rounded-2xl
bg-white/[0.05]
border
border-white/10
px-5
text-white
placeholder:text-gray-500
outline-none
transition-all
focus:border-yellow-400
focus:ring-4
focus:ring-yellow-400/20
"
/>

</div>


<button
onClick={handleLogin}
disabled={loading}
className="
w-full
h-[60px]
rounded-2xl
bg-gradient-to-r
from-yellow-500
to-amber-300
text-black
font-bold
shadow-[0_0_40px_rgba(234,179,8,.45)]
hover:scale-[1.02]
active:scale-[0.98]
transition-all
"
>

{loading
? "Signing In..."
: "Access Dashboard"}

</button>

</div>


<div className="mt-8 text-center">

<p className="text-xs text-gray-500">

Protected by DPI Authentication

</p>

</div>

</div>

</motion.div>

</div>

);
}