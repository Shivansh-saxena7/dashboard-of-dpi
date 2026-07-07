"use client";

export default function PostSuccessModal({
open,
setOpen
}:any){

if(!open) return null;

return(

<div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center">

<div className="
bg-white
rounded-[30px]
p-8
w-[90%]
max-w-md
shadow-2xl
text-center
">

<div className="
w-20
h-20
mx-auto
rounded-full
bg-gradient-to-r
from-cyan-500
to-blue-600
flex
items-center
justify-center
text-white
text-4xl
">

✓

</div>

<h2 className="
text-2xl
font-bold
mt-5
">

Post Created

</h2>

<p className="
text-slate-500
mt-2
">

Post assigned successfully to all employees

</p>

<button
onClick={()=>setOpen(false)}
className="
mt-6
w-full
h-12
rounded-xl
text-white
font-bold
bg-gradient-to-r
from-blue-600
to-cyan-500
"
>

Done

</button>

</div>

</div>

)

}