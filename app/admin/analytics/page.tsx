"use client";

import {useEffect,useState} from "react";
import Charts from "@/components/Charts";
import TopPerformers from "@/components/TopPerformers";
import LowPerformer from "@/components/LowPerformer";
import {calculateStats} from "@/lib/calculateStats";
import {getUniquePosts} from "@/lib/getUniquePosts";
import { reportClientError } from "@/lib/reportClientError";

import PageHeader from "@/components/PageHeader";
export default function AnalyticsPage(){

const [allData,setAllData]=useState<any[]>([]);
const [filter,setFilter]=useState("month");
const now = new Date();

const filteredData = allData.filter((item:any)=>{

const date = new Date(item.Date);

if(filter==="today"){

return (
date.toDateString()
===
now.toDateString()
);

}

if(filter==="week"){

const diff =

(now.getTime()-date.getTime())

/

(1000*60*60*24);

return diff<=7;

}

if(filter==="month"){

return (

date.getMonth()===now.getMonth()

&&

date.getFullYear()===now.getFullYear()

);

}

return true;

});

useEffect(()=>{

loadData();

},[]);



async function loadData(){

try{

const res=
await fetch("/api/data");

const json=
await res.json();

const records=

Array.isArray(json)

?

json

:

json.data||[];

setAllData(records);

}catch(err){

console.log(err);
reportClientError("load analytics data", err);

}

}



/* employees */

const totalEmployees=

new Set(

filteredData.map(
(d:any)=>
d.employee_id
)

).size;



/* remove duplicate posts */
const uniquePosts = getUniquePosts(filteredData);



/* stats */
const {
totalAssigned,
completed,
pending,
permanent,
performance
} = calculateStats(filteredData);



const health=

performance>=80

?

{
label:"Good",
color:"bg-green-100 text-green-600"
}

:

performance>=50

?

{
label:"Average",
color:"bg-yellow-100 text-yellow-600"
}

:

{
label:"Risk",
color:"bg-red-100 text-red-600"
};




const cards=[

{
title:"Employees",
value:totalEmployees,
icon:"👥"
},

{
title:"Assigned",
value:totalAssigned,
icon:"📦"
},

{
title:"Completed",
value:completed,
icon:"✅"
},

{
title:"Pending",
value:pending,
icon:"⏳"
},

{
title:"Permanent",
value:permanent,
icon:"🚨"
},

{
title:"Performance",
value:`${performance}%`,
icon:"📈"
}

];



return(

<div className="
min-h-screen
bg-slate-100
p-6
space-y-6
">

{/* HERO */}

<PageHeader
  eyebrow="Overview"
  title="Team Analytics"
  description="Performance insights and employee tracking"
>
  <div className="flex gap-2 flex-wrap">
    <button onClick={()=>setFilter("today")} className="px-3 h-8 rounded-full bg-white/20 text-white text-xs font-semibold">Today</button>
    <button onClick={()=>setFilter("week")} className="px-3 h-8 rounded-full bg-white/20 text-white text-xs font-semibold">Week</button>
    <button onClick={()=>setFilter("month")} className="px-3 h-8 rounded-full bg-white/20 text-white text-xs font-semibold">Month</button>
    <button onClick={()=>setFilter("all")} className="px-3 h-8 rounded-full bg-white/20 text-white text-xs font-semibold">All Time</button>
  </div>
  <div className="mt-4 inline-flex text-sm font-semibold">
    <span className={health.color+" px-3 py-1 rounded-full"}>
      {health.label}
    </span>
  </div>
</PageHeader>



{/* CARDS */}

<div className="
grid
grid-cols-2
xl:grid-cols-3
gap-5
">

{

cards.map(
(card,index)=>(

<Card
key={index}
title={card.title}
value={card.value}
icon={card.icon}
/>

))

}

</div>




{/* CHARTS + TOP */}

<div className="
grid
grid-cols-1
xl:grid-cols-2
gap-6
">

<div className="
bg-white
rounded-[35px]
shadow-md
p-6
">

<h2 className="
font-bold
mb-4
">

📈 Team Performance

</h2>

<Charts
data={uniquePosts}
/>

</div>



<div className="
space-y-6
">

<div className="
bg-white
rounded-[35px]
shadow-md
p-6
">

<h2 className="
font-bold
mb-4
">

🏆 Top Performer

</h2>

<TopPerformers
data={allData}
/>

</div>



<div className="
bg-white
rounded-[35px]
shadow-md
p-6
">

<h2 className="
font-bold
mb-4
">

⚠ Low Performer

</h2>

<LowPerformer
data={allData}
/>

</div>

</div>

</div>

</div>

);

}




function Card({
title,
value,
icon
}:any){

// Label on its own full-width line (UI/UX Phase 8): beside a 56px icon
// in a half-width phone card it collided with the icon, then truncated.
return(
<div className="bg-white rounded-[30px] shadow-md p-4 sm:p-5">
  <p className="text-xs text-gray-400">{title}</p>
  <div className="flex items-center justify-between gap-3 mt-2">
    <h2 className="text-2xl sm:text-3xl font-bold">{value}</h2>
    <div className="h-11 w-11 sm:h-14 sm:w-14 shrink-0 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 flex items-center justify-center text-xl sm:text-2xl text-white">
      {icon}
    </div>
  </div>
</div>
);

}