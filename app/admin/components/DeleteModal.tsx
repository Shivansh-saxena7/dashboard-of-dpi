"use client";

import { motion } from "framer-motion";

export default function DeleteModal({

open,
setOpen,
onDelete,
title = "Delete Employee",
message = "Are you sure you want to delete this employee?"

}:any){

if(!open) return null;

return(

<div className="
fixed
inset-0
bg-black/50
backdrop-blur-md
z-50
flex
justify-center
items-center
p-5
">

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
bg-white
rounded-[35px]
overflow-hidden
shadow-[0_30px_80px_rgba(0,0,0,.2)]
"

>

<div className="
bg-gradient-to-r
from-red-500
to-pink-500
p-8
text-white
">

<h1 className="
text-2xl
font-bold
">

{title}

</h1>

<p className="
mt-2
text-white/80
">

This action cannot be undone

</p>

</div>

<div className="p-6">

<p className="
text-slate-600
mb-8
">

{message}

</p>

<div className="
flex
gap-4
">

<button

onClick={()=>
setOpen(false)
}

className="
flex-1
h-12
rounded-xl
bg-slate-100
"

>

Cancel

</button>

<button

onClick={onDelete}

className="
flex-1
h-12
rounded-xl
bg-red-500
text-white
font-medium
"

>

Delete

</button>

</div>

</div>

</motion.div>

</div>

)

}