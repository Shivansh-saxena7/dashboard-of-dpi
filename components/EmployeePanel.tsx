"use client";

import EmployeeDetails from "./EmployeeDetails";
import TopPerformers from "./TopPerformers";
import LowPerformer from "./LowPerformer";
import { calculateStats } from "@/lib/calculateStats";
import { getUniquePosts } from "@/lib/getUniquePosts";
import Charts from "./Charts";

type DataType = {
id: string;
employee_id: string;
Date: string;
"Post ID": string;
"IG Link": string;
"FB Link": string;
Employee: string;
"IG Like": string;
"FB Like": string;
done?: boolean;
};

type Props = {
data: DataType[];
allData: any[];
employee: any;
selectedEmployee: string;
setSelectedEmployee: any;
selectedDate: string;
};

export default function EmployeePanel({
data,
employee,
allData,
selectedEmployee,
selectedDate,
}: Props) {

const employeeData = data.find(
(d:any)=>
String(d.employee_id).trim()===
String(selectedEmployee).trim()
);

const employeeName=
employeeData?.Employee || "Employee";


// FIXED LOGIC

const stats = calculateStats(data);const totalPosts = stats.totalAssigned;

const completed = stats.completed;

const pending = stats.pending;

const performance = stats.performance;

// employee ranking

const scores:any={};

allData.forEach((d:any)=>{

const score=
(d["IG Like"]==="YES"?1:0)
+
(d["FB Like"]==="YES"?1:0);

scores[d.Employee]=
(scores[d.Employee]||0)
+
score;

});

const sorted=
Object.entries(scores)
.sort(
(a:any,b:any)=>
Number(b[1])-Number(a[1])
);

const rank=
sorted.findIndex(
(x:any)=>
x[0]===employeeName
)+1;

const remainingGoal=
Math.max(
5-completed,
0
);

const today = new Date();

const postDate =
new Date(data?.[0]?.Date);

const isHistory =
today.toDateString() !==
postDate.toDateString();

const currentHour =
new Date().getHours();

const goalMessage =
isHistory
? "📁 Historical record"
: currentHour < 18
? `🚀 ${pending} posts pending`
: currentHour < 23
? "⚠️ Complete pending posts before deadline"
: "⛔ Activity window closed";


let statusMessage = "";

if(isHistory){

statusMessage="📁 History";

}

else if(currentHour<18){

statusMessage=`⏳ ${pending} remaining`;

}

else if(currentHour<23){

statusMessage="🚨 Missed window active";

}

else{

statusMessage="⛔ Closed";

}


const isToday=
employeeData?.Date
?
new Date(employeeData.Date)
.toDateString()
===
new Date().toDateString()
:false;


return (

<div className="grid grid-cols-1 lg:grid-cols-3 gap-6 px-4 mt-8">

<div className="lg:col-span-1">

<div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6">

<div className="flex justify-between items-center">

<div>

<h2 className="text-2xl font-bold text-gray-800">
🏆 Personal Progress
</h2>

<p className="text-sm text-gray-500">
Track your weekly growth
</p>

</div>

<div className="text-3xl">
📊
</div>

</div>


<div className="mt-6 bg-gray-50 rounded-2xl border border-gray-100 p-4">

<div className="flex justify-between items-center">

<div>

<p className="text-xs text-gray-400">
Employee Profile
</p>

<h3 className="text-xl font-bold mt-1">
{employeeName}
</h3>

<p className="text-xs text-gray-500 mt-2">
Daily engagement progress
</p>

</div>

<div
className="
w-14
h-14
rounded-full
bg-gradient-to-r
from-blue-500
to-indigo-500
text-white
flex
items-center
justify-center
font-bold
text-xl">

{employeeName.charAt(0)}

</div>

</div>

</div>

<div className="grid grid-cols-2 gap-3 mt-5">

<div className="bg-blue-50 rounded-xl p-3">

<p className="text-xs text-gray-500">
Current Rank
</p>

<h4 className="text-2xl font-bold text-blue-600">
#{rank>0?rank:"--"}
</h4>

</div>

<div className="bg-orange-50 rounded-xl p-3">

<p className="text-xs text-gray-500">
Pending
</p>

<h4 className="text-2xl font-bold">
{pending}
</h4>

</div>

<div className="bg-green-50 rounded-xl p-3">

<p className="text-xs text-gray-500">
Completed
</p>

<h4 className="text-2xl font-bold text-green-600">
{completed}/{totalPosts}
</h4>

</div>

<div className="bg-purple-50 rounded-xl p-3">

<p className="text-xs text-gray-500">
Status
</p>

<p className="font-bold">
{statusMessage}
</p>

</div>

</div>

<div className="mt-6">

<div className="flex justify-between mb-2">

<p className="text-sm font-medium">
Performance
</p>

<p className="font-bold">
{performance}%
</p>

</div>

<div className="w-full bg-gray-200 rounded-full h-4 overflow-hidden">

<div
className="bg-gradient-to-r from-blue-500 to-indigo-500 h-full rounded-full"

style={{
width:`${performance}%`
}}
/>

</div>

</div>

<div className="mt-5 bg-blue-50 rounded-xl p-3">

<p className="text-xs text-gray-500">
🎯 Next Goal
</p>

<p className="font-medium mt-1">
{goalMessage}
</p>

</div>

</div>

</div>

<div className="lg:col-span-2 flex flex-col gap-6">

<TopPerformers data={allData}/>

<Charts data={data}/>

<EmployeeDetails
data={data}
selected={selectedEmployee}
selectedDate={selectedDate}
/>

<LowPerformer data={allData}/>

</div>

</div>

);

}