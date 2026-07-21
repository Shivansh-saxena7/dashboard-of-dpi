"use client";

import {useEffect,useState} from "react";
import {useParams} from "next/navigation";
import Charts from "@/components/Charts";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { calculateStatus } from "@/components/calculateStatus";
export default function EmployeeDetailsPage(){

const params=useParams();
const employeeId=params.id;

const [allData,setAllData]=useState<any[]>([]);
const [selectedDate,setSelectedDate]=useState<Date | null>(null);

useEffect(()=>{

loadData();

},[]);



async function loadData(){

try{

const res=await fetch("/api/data");

const json=await res.json();

const records=
Array.isArray(json)
?json
:json.data||[];

const employeeRecords=

records.filter(
(d:any)=>
String(d.employee_id)
===
String(employeeId)
);
console.log("29 JUNE RECORDS");
console.log(
employeeRecords.filter(
(d:any)=>String(d.Date).trim()==="2026-06-29"
)
);
console.log("EMPLOYEE ID =", employeeId);
console.log("ALL RECORDS =", records.length);
console.log("EMPLOYEE RECORDS =", employeeRecords);
console.log("EMPLOYEE RECORDS COUNT =", employeeRecords.length);

setAllData(employeeRecords);

if(employeeRecords.length){

const latest=
employeeRecords
.sort(
(a:any,b:any)=>
new Date(b.Date).getTime()-
new Date(a.Date).getTime()
)[0];

setSelectedDate(
new Date(
latest.Date
)
);

}

}catch(err){

console.log(err);

}

}



const filteredData=

selectedDate

?

allData.filter(
(d:any)=>

new Date(
d.Date
).toDateString()

===

selectedDate.toDateString()

)

:

allData;

console.log("SELECTED DATE =", selectedDate);
console.log("FILTERED DATA =", filteredData);

const uniquePosts=

Array.from(

new Map(

filteredData.map(
(item:any)=>[
item["Post ID"],
item
]
)

).values()

);



const employeeName=

filteredData?.[0]?.Employee
||
"Employee";



const totalPosts=
uniquePosts.length;


const completed=

uniquePosts.filter(
(post:any)=>

calculateStatus(post)
===
"COMPLETED"

).length;



const missed=

uniquePosts.filter(
(post:any)=>

calculateStatus(post)
===
"MISSED"

).length;


const permanent=

uniquePosts.filter(
(post:any)=>

calculateStatus(post)
===
"PERMANENT"

).length;
const pending=

totalPosts
-
completed
-
permanent;



// ALL TIME STATS
const totalAssigned = totalPosts;



const totalPermanentMissed = permanent;


const totalCompleted = completed;

const overallPerformance=

totalAssigned>0

?

Math.round(
(totalCompleted/totalAssigned)*100
)

:

0;



const risk=

overallPerformance>=80

?

{
label:"Good",
color:"bg-green-100 text-green-700"
}

:

overallPerformance>=50

?

{
label:"Needs Attention",
color:"bg-yellow-100 text-yellow-700"
}

:

{
label:"High Risk",
color:"bg-red-100 text-red-700"
};



const lastActivity=

allData.length

?

allData
.sort(
(a:any,b:any)=>

new Date(
b.Date
).getTime()

-

new Date(
a.Date
).getTime()

)[0]?.Date

:

"--";


const permanentHistory=

Array.from(

new Map(

allData.map(
(d:any)=>[
d["Post ID"],
d
]
)

).values()

)

.filter(
(post:any)=>

calculateStatus(post)
===
"PERMANENT"

);


return(

<div className="bg-slate-100 min-h-screen p-6">

{/* HERO */}

<div className="
rounded-[35px]
bg-gradient-to-r
from-slate-900
via-blue-900
to-cyan-700
p-7
shadow-xl
mb-7
">

<div className="
flex
justify-between
items-center
flex-wrap
gap-5
">

<div>

<h1 className="
text-white
text-4xl
font-bold
">

{employeeName}

</h1>

<p className="
text-white/70
mt-2
">

Employee Dashboard

</p>

</div>



<div className="
bg-white/10
backdrop-blur-xl
rounded-3xl
px-4
py-3
">

<DatePicker
selected={selectedDate}
onChange={(date:Date | null)=>
setSelectedDate(date)
}
dateFormat="dd-MM-yyyy"
className="
bg-transparent
text-white
outline-none
font-semibold
w-[130px]
cursor-pointer
"
/>
</div>

</div>

</div>




{/* STATS */}

<div className="
grid
grid-cols-2
lg:grid-cols-4
gap-5
mb-7
">

<Card
title="Posts"
value={totalPosts}
icon="📝"
/>

<Card
title="Completed"
value={completed}
icon="✅"
/>

<Card
title="Pending"
value={pending}
icon="⏳"
/>

<Card
title="Permanent"
value={permanent}
icon="🚨"
/>

</div>


{/* OVERALL INSIGHTS */}

<div className="
grid
grid-cols-2
lg:grid-cols-4
gap-5
mb-7
">

<Card
title="Assigned"
value={totalAssigned}
icon="📦"
/>

<Card
title="Missed"
value={missed}
icon="🚨"
/>

<Card
title="Total Permanent"
value={totalPermanentMissed}
icon="🚨"
/>
<Card
title="Overall %"
value={`${overallPerformance}%`}
icon="🔥"
/>

<div className="
bg-white
rounded-[30px]
shadow-md
p-5
">

<p className="
text-xs
text-gray-400
">

Risk Status

</p>

<div className={`
mt-3
px-3
py-2
rounded-full
text-sm
font-medium
w-fit

${risk.color}

`}>

{risk.label}

</div>

</div>

</div>



<div className="
bg-white
rounded-[35px]
shadow-md
p-6
mb-7
">

<div className="
flex
justify-between
items-center
flex-wrap
gap-4
">

<div>

<p className="
text-gray-400
text-xs
">

Last Activity

</p>

<h2 className="
font-bold
text-xl
mt-1
">

{lastActivity}

</h2>

</div>

<div>

<p className="
text-gray-400
text-xs
">

Monthly Summary

</p>

<h2 className="
font-bold
text-xl
mt-1
">

{totalCompleted} Completed

</h2>

</div>

</div>

</div>

{/* CHART */}

<div className="
bg-white
rounded-[35px]
shadow-md
p-6
mb-7
">

<h2 className="
font-bold
mb-5
">

📊 Performance Analytics

</h2>

<Charts
data={uniquePosts}
/>

</div>


{

permanentHistory.length>0

&&

<div className="
bg-white
rounded-[35px]
shadow-md
p-6
mb-7
">

<h2 className="
font-bold
mb-5
text-red-600
">

🚨 Permanent Missed History

</h2>

<div className="
grid
grid-cols-2
sm:grid-cols-3
md:grid-cols-4
lg:grid-cols-6
gap-3
max-h-[300px]
overflow-y-auto
pr-2
">

{

permanentHistory.map(
(item:any,index:number)=>(

<div
key={index}
className="
p-4
rounded-2xl
bg-red-50
border
border-red-100
hover:scale-[1.02]
transition
"
>

<p className="
font-semibold
">

{item["Post ID"]}

</p>

<p className="
text-xs
text-gray-500
mt-1
">

{item.Date}

</p>

</div>

))

}

</div>

</div>

}

{/* HISTORY */}

<div className="
bg-white
rounded-[35px]
shadow-md
p-6
">

<h2 className="
font-bold
mb-5
">

📄 Post History

</h2>


<div className="
space-y-4
">

{

uniquePosts.length===0

?

(

<div className="
bg-slate-50
border-2
border-dashed
border-slate-200
rounded-[30px]
py-14
flex
flex-col
items-center
justify-center
">

<div className="
w-20
h-20
rounded-full
bg-blue-100
flex
items-center
justify-center
text-4xl
mb-4
">

📭

</div>

<h2 className="
text-xl
font-bold
text-slate-700
">

No Data Available

</h2>

<p className="
text-slate-400
mt-2
">

No posts found for selected date

</p>

</div>

)

:

(

uniquePosts.map(
(post:any,index:number)=>(

<div
key={index}
className="
bg-slate-50
rounded-2xl
border
p-5
flex
justify-between
items-center
flex-wrap
gap-4
"
>

<div>

<h2 className="
font-bold
text-lg
">

{post["Post ID"]}

</h2>

<p className="
text-gray-500
text-sm
">

📅 {post.Date}

</p>

</div>


<div className="
flex
gap-3
flex-wrap
items-center
">

<span className={`
px-4
py-2
rounded-full
text-xs

${
calculateStatus(post)==="COMPLETED"
?
"bg-green-100 text-green-700"

:

calculateStatus(post)==="PERMANENT"

?
"bg-red-100 text-red-700"

:

calculateStatus(post)==="MISSED"

?
"bg-orange-100 text-orange-700"

:

"bg-blue-100 text-blue-700"

}
`}>

{calculateStatus(post)}

</span>

</div>

</div>

))

)

}

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

return(

<div className="
bg-white
rounded-[30px]
shadow-md
p-5
flex
justify-between
items-center
">

<div>

<p className="
text-gray-400
text-xs
">

{title}

</p>

<h2 className="
text-3xl
font-bold
mt-2
">

{value}

</h2>

</div>

<div className="
h-14
w-14
rounded-2xl
bg-gradient-to-r
from-cyan-500
to-blue-600
flex
justify-center
items-center
text-white
text-2xl
">

{icon}

</div>

</div>

);

}