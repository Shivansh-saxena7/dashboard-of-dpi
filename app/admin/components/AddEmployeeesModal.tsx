"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { supabase } from "@/lib/supabase";

export default function AddEmployeeModal({
open,
setOpen,
refreshEmployees
}:any){

const [name,setName]=useState("");
const [email,setEmail]=useState("");
const [password,setPassword]=useState("");
const [role,setRole]=useState("employee");

const [loading,setLoading]=useState(false);

const createEmployee=async()=>{

try{

setLoading(true);

const res = await fetch("/api/create-employee", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name, email, password, role }),
});

const result = await res.json();

if(!result.success){

alert(result.message);
return;

}

refreshEmployees();

setOpen(false);

setName("");
setEmail("");
setPassword("");
setRole("");

}catch(err){

console.log(err);
alert("Something went wrong");

}finally{

setLoading(false);

}

};
if(!open) return null;

return(

<div
className="
fixed
inset-0
bg-black/50
backdrop-blur-md
z-50
flex
justify-center
items-center
p-5
"
>

<motion.div

initial={{
opacity:0,
scale:.8
}}

animate={{
opacity:1,
scale:1
}}

className="
w-full
max-w-md
rounded-[35px]
bg-white
shadow-[0_20px_80px_rgba(0,0,0,.15)]
overflow-hidden
"

>

<div className="
bg-gradient-to-r
from-[#0F172A]
via-[#2563EB]
to-[#06B6D4]
p-8
text-white
">

<h1 className="
text-2xl
font-bold
">

Add Employee

</h1>

<p className="
text-white/70
mt-2
">

Create new employee account

</p>

</div>


<div className="
p-6
space-y-5
">

<input
placeholder="Employee Name"
value={name}
onChange={(e)=>setName(e.target.value)}
className="
w-full
h-14
px-5
rounded-2xl
bg-slate-100
outline-none
focus:ring-4
focus:ring-cyan-200
"
/>

<input
placeholder="Email"
value={email}
onChange={(e)=>setEmail(e.target.value)}
className="
w-full
h-14
px-5
rounded-2xl
bg-slate-100
outline-none
focus:ring-4
focus:ring-cyan-200
"
/>

<input
type="password"
placeholder="Password"
value={password}
onChange={(e)=>setPassword(e.target.value)}
className="
w-full
h-14
px-5
rounded-2xl
bg-slate-100
outline-none
focus:ring-4
focus:ring-cyan-200
"
/>

<select

value={role}
onChange={(e)=>setRole(e.target.value)}

className="
w-full
h-14
px-5
rounded-2xl
bg-slate-100
outline-none
"

>

<option value="employee">
Employee
</option>

<option value="admin">
Admin
</option>

<option value="sales_coordinator">
Sales Coordinator
</option>

</select>


<div className="
flex
gap-3
pt-4
">

<button

onClick={()=>
setOpen(false)
}

className="
flex-1
h-12
rounded-xl
bg-slate-200
"

>

Cancel

</button>


<button

onClick={createEmployee}

className="
flex-1
h-12
rounded-xl
text-white
font-medium
bg-gradient-to-r
from-blue-600
to-cyan-500
"

>

{

loading
?
"Creating..."
:
"Create"

}

</button>

</div>

</div>

</motion.div>

</div>

)

}