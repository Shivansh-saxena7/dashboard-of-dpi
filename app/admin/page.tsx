"use client";

import { useEffect, useState } from "react";
import TopPerformers from "@/components/TopPerformers";
import LowPerformer from "@/components/LowPerformer";
import Charts from "@/components/Charts";
import { calculateStats } from "@/lib/calculateStats";
import { getUniquePosts } from "@/lib/getUniquePosts";
export default function AdminDashboard() {

const [allData,setAllData]=useState<any[]>([]);

// ✅ DATE FILTER
const [selectedDate,setSelectedDate]=
useState<string>("");


// ✅ DEFAULT TODAY
useEffect(()=>{

const today=

new Date()

.toISOString()

.split("T")[0];

setSelectedDate(today);

},[]);



// ✅ LOAD DATA
useEffect(()=>{

loadTracking();

const interval=setInterval(()=>{

loadTracking();

},5000);

return ()=>clearInterval(interval);

},[]);




async function loadTracking(){

try{

const res=await fetch("/api/data",{

cache:"no-store"

});

const json=await res.json();

const records=

Array.isArray(json)

?

json

:

json.data || [];

setAllData(records);

}catch(err){

console.log(err);

}

}



// ✅ DATE FILTERED DATA
const filteredData =

selectedDate

?

allData.filter((d:any)=>{

const date = new Date(d.Date);

const formatted =

date.getFullYear()

+"-"

+String(date.getMonth()+1)
.padStart(2,"0")

+"-"

+String(date.getDate())
.padStart(2,"0");

return formatted===selectedDate;

})

:

allData;



// ✅ UNIQUE POSTS
const uniquePosts = getUniquePosts(filteredData);



// ✅ STATS
const stats = calculateStats(filteredData);
const totalEmployees =
  new Set(
    filteredData.map((d: any) => d.employee_id)
  ).size;
const totalPosts = stats.totalAssigned;

const completed = stats.completed;

const pending = stats.pending;

const permanentMissed = stats.permanent;

const performance = stats.performance;



const cards=[

{
title:"Employees",
value:totalEmployees,
icon:"👥",
color:"from-cyan-500 to-blue-500"
},

{
title:"Posts",
value:totalPosts,
icon:"📝",
color:"from-indigo-500 to-blue-500"
},

{
title:"Completed",
value:completed,
icon:"✅",
color:"from-green-500 to-emerald-500"
},

{
title:"Pending",
value:pending,
icon:"⏳",
color:"from-orange-500 to-yellow-500"
},

{
title:"Permanent Missed",
value:permanentMissed,
icon:"🚨",
color:"from-pink-500 to-red-500"
},

{
title:"Performance %",
value:`${performance}%`,
icon:"📊",
color:"from-violet-500 to-blue-500"
}

];



return(

<div className="space-y-6 pb-10">

{/* HEADER */}

<div
className="
rounded-[30px]
overflow-hidden
relative
bg-gradient-to-r
from-slate-900
via-blue-900
to-cyan-700
p-6
md:p-8
shadow-xl
"
>

<div className="relative z-10">

<h1 className="
text-3xl
md:text-5xl
font-bold
text-white
tracking-tight
">

Dashboard

</h1>

<p className="
text-blue-100
mt-2
text-sm
">

Admin overview and performance summary

</p>



{/* ✅ DATE FILTER */}

<div className="
mt-5
flex
gap-3
items-center
flex-wrap
">

<input
type="date"
value={selectedDate}
onChange={(e)=>
setSelectedDate(e.target.value)
}
className="
border
border-white/20
bg-white/10
text-white
px-4
py-2
rounded-xl
backdrop-blur-sm
outline-none
"
/>


<button
onClick={()=>{

const today=

new Date()

.toISOString()

.split("T")[0];

setSelectedDate(today);

}}
className="
px-4
py-2
rounded-xl
bg-white
text-slate-800
text-sm
font-medium
"
>

Today

</button>

</div>




<div
className="
mt-5
bg-white/10
backdrop-blur-sm
rounded-full
overflow-hidden
h-3
"
>

<div
className="
bg-gradient-to-r
from-cyan-300
to-blue-400
h-full
transition-all
duration-1000
"
style={{
width:`${performance}%`
}}
/>

</div>

<p className="
mt-3
text-sm
text-white
">

Performance :
<b> {performance}%</b>

</p>

</div>

</div>



{/* KPI CARDS */}

<div className="
grid
grid-cols-2
xl:grid-cols-3
gap-4
">

{

cards.map(
(card,index)=>(

<div
key={index}
className="
bg-white
rounded-[28px]
p-4
shadow-[0_8px_35px_rgba(0,0,0,0.06)]
hover:translate-y-[-4px]
transition-all
duration-300
border
border-slate-100
overflow-hidden
relative
"
>

<div
className={`
absolute
top-0
left-0
h-1
w-full
bg-gradient-to-r
${card.color}
`}
/>

<div className="
flex
justify-between
items-center
">

<div>

<p className="
text-[11px]
uppercase
font-medium
tracking-wider
text-slate-400
">

{card.title}

</p>

<h2 className="
text-3xl
font-bold
text-slate-800
mt-2
">

{card.value}

</h2>

</div>

<div
className={`
w-14
h-14
rounded-2xl
bg-gradient-to-r
${card.color}
text-white
flex
items-center
justify-center
text-2xl
shadow-lg
`}
>

{card.icon}

</div>

</div>

</div>

)

)

}

</div>



{/* CHART + SIDE */}

<div className="
grid
grid-cols-1
xl:grid-cols-[1.5fr_.8fr]
gap-5
">

<div
className="
bg-white
rounded-[30px]
p-6
border
border-slate-100
shadow-[0_8px_30px_rgba(0,0,0,0.05)]
"
>

<div className="
flex
justify-between
items-center
mb-6
">

<h2 className="
font-bold
text-xl
text-slate-800
">

📈 Performance Analytics

</h2>

<div className="
text-xs
bg-slate-100
px-3
py-1
rounded-full
">

Live Data

</div>

</div>

<Charts
data={filteredData}
/>

</div>




<div className="
flex
flex-col
gap-5
">

<div
className="
bg-white
rounded-[30px]
p-5
border
border-slate-100
shadow-[0_8px_30px_rgba(0,0,0,0.05)]
"
>

<h2 className="
font-bold
text-lg
mb-5
">

🏆 Top Performers

</h2>

<TopPerformers
data={filteredData}
/>

</div>



<div
className="
bg-white
rounded-[30px]
p-5
border
border-slate-100
shadow-[0_8px_30px_rgba(0,0,0,0.05)]
"
>

<h2 className="
font-bold
text-lg
mb-5
">

⚠️ Low Performers

</h2>

<LowPerformer
data={filteredData}
/>

</div>

</div>

</div>

</div>

);

}