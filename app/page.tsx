"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

import Header from "@/components/Header";
import StatsCard from "@/components/StatsCard";
import EmployeePanel from "@/components/EmployeePanel";

export default function Page() {

const router = useRouter();

const [employee,setEmployee]=useState<any>(null);

const [selectedEmployee,setSelectedEmployee]=
useState<string>("");

const [data,setData]=useState<any[]>([]);

const [allData,setAllData]=useState<any[]>([]);


// ✅ DATE FILTER
const [selectedDate,setSelectedDate]=
useState<string>("");


// ✅ AUTH CHECK
useEffect(()=>{

async function getLoggedInEmployee(){

const {
data:{user},
}=await supabase.auth.getUser();

if(!user){

router.push("/login");
return;

}

const {data,error}=await supabase

.from("employees")

.select("*")

.eq("auth_user_id",user.id)

.single();

if(error || !data){

console.error("Employee not found");
return;

}
if (!data.is_active) {

  await supabase.auth.signOut();

  router.replace("/login");

  return;

}

setEmployee(data);

setSelectedEmployee(data.id);

}

getLoggedInEmployee();

},[]);



// ✅ LOAD DATA
async function loadData(date:string){

try{

const employeeId=

employee?.role==="employee"

?

employee.id

:

selectedEmployee;


const query = new URLSearchParams({

date:date || "",

employeeId:employeeId || "",

});


const res=await fetch(

`/api/data?${query}`,

{
cache:"no-store"
}

);


if(!res.ok){

setData([]);
return;

}


const json=await res.json();

const records=

Array.isArray(json)

?

json

:

json.data || [];


setData(records);
console.log("===== API DATA =====");
console.table(records);


// ✅ ALL DATA
const allRes=await fetch(

`/api/data?date=${date}`,

{
cache:"no-store"
}

);

const allJson=await allRes.json();

setAllData(

Array.isArray(allJson)

?

allJson

:

[]

);


}catch(err){

console.log(err);

setData([]);

}

}



// ✅ DEFAULT TODAY
useEffect(()=>{

const today=

new Date()

.toISOString()

.split("T")[0];

setSelectedDate(today);

},[]);



// ✅ AUTO LOAD
useEffect(()=>{

if(!employee?.id) return;

loadData(selectedDate);

const interval=setInterval(()=>{

loadData(selectedDate);

},5000);

return ()=>clearInterval(interval);

},[
employee,
selectedEmployee,
selectedDate
]);



// ✅ FILTERED DATA
const filteredData=

selectedDate

?

data.filter((d:any)=>{

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

data;



// ✅ STATS
const stats={

ig:

filteredData.filter(
(d)=>
d["IG Like"]==="YES"
).length,


fb:

filteredData.filter(
(d)=>
d["FB Like"]==="YES"
).length,


posts:

new Set(
filteredData.map(
(d)=>d["Post ID"]
)
).size,


employees:

new Set(
filteredData.map(
(d)=>d.Employee
)
).size,


engagement:

filteredData.length>0

?

Math.round(

(

(

filteredData.filter(
(d)=>d["IG Like"]==="YES"
).length

+

filteredData.filter(
(d)=>d["FB Like"]==="YES"
).length

)

/

(filteredData.length*2)

)

*100

)

:

0,

};



return(

<main className="
min-h-screen
bg-gradient-to-br
from-white
via-blue-50
to-blue-100
">

<Header />


{/* ✅ DATE FILTER */}

<div className="
px-4
mt-4
space-y-3
">

<input
type="date"
value={selectedDate}
onChange={(e)=>
setSelectedDate(e.target.value)
}
className="
w-full
border
px-3
py-2
rounded-md
text-sm
bg-white
shadow
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
w-full
text-xs
py-2
bg-gray-100
rounded-md
hover:bg-gray-200
"
>

Today Data

</button>

</div>



{/* ✅ STATS */}

<StatsCard

stats={stats}

employeeName={
employee?.name || "Employee"
}

/>



{/* ✅ EMPTY */}

{filteredData.length===0

?

(

<div className="
flex
flex-col
items-center
justify-center
mt-16
text-center
px-4
">

<div className="
text-5xl
mb-3
">

📭

</div>

<h2 className="
text-lg
font-semibold
text-gray-700
">

No Data Available

</h2>

<p className="
text-sm
text-gray-500
mt-1
">

No records found for selected date

</p>

</div>

)

:

(

<EmployeePanel
  data={filteredData}
  allData={allData}
  employee={employee}
  selectedEmployee={selectedEmployee}
  setSelectedEmployee={setSelectedEmployee}
  selectedDate={selectedDate}
/>

)

}

</main>

);

}