"use client";

import { useEffect,useState } from "react";
import { supabase } from "@/lib/supabase";
import AddEmployeeModal from "../components/AddEmployeeesModal";
import DeleteModal from "../components/DeleteModal";
import { useRouter } from "next/navigation";

export default function Employees(){
    const router = useRouter();

const [employees,setEmployees]=useState<any[]>([]);
const [loading,setLoading]=useState(true);

const [search,setSearch]=useState("");
const [filter,setFilter]=useState("all");

const [openModal,setOpenModal]=useState(false);
const [deleteOpen,setDeleteOpen]=useState(false);
const [selectedId,setSelectedId]=useState("");

useEffect(()=>{

fetchEmployees();

},[]);

const fetchEmployees=async()=>{

const {data,error}=await supabase
.from("employees")
.select("*")
.order(
"created_at",
{
ascending:false
}
);

if(!error){

setEmployees(data||[]);

}

setLoading(false);

};

const toggleEmployeeStatus = async (
  id: string,
  currentStatus: boolean
) => {

  const { error } = await supabase
    .from("employees")
    .update({
      is_active: !currentStatus,
    })
    .eq("id", id);

  if (!error) {
    fetchEmployees();
  }

};

// Round-robin lead assignment participation (V2 Lead Engine).
// Defaults to false for everyone since the column was added in
// Phase 1 — until an admin turns this on here, that employee is
// never eligible for a new lead, no matter how the assignment
// engine or attendance gate are configured.
const toggleRREligible = async (
  id: string,
  currentStatus: boolean
) => {

  const { error } = await supabase
    .from("employees")
    .update({
      rr_eligible: !currentStatus,
    })
    .eq("id", id);

  if (!error) {
    fetchEmployees();
  }

};
// Sales Coordinator role toggle (V2 Follow-up-Stale-Recycling module).
// Deliberately only offered for employees currently "employee" or
// "sales_coordinator" — never shown for "admin"/"team_leader" rows,
// so this simple toggle can never be used to accidentally strip an
// Admin's access or a Team Leader's role (that one has its own
// dedicated, more careful flow on the Teams page already).
const toggleSalesCoordinator = async (
  id: string,
  currentRole: string
) => {

  const newRole = currentRole === "sales_coordinator" ? "employee" : "sales_coordinator";

  const { error } = await supabase
    .from("employees")
    .update({ role: newRole })
    .eq("id", id);

  if (!error) {
    fetchEmployees();
  }

};

// Department controls which EmployeeTabBar tab-set an "employee" row
// gets (Sales: Posts/Leads/Data/Leaderboard vs non-Sales: Posts only)
// — see components/EmployeeTabBar.tsx. Deliberately not offered for
// "team_leader" rows — leading a Sales team structurally requires
// Sales access, so this dropdown can never be used to accidentally
// misconfigure one into losing it. Not shown for admin/
// sales_coordinator either, since those roles have their own separate
// dashboards (/admin, /coordinator) that don't read this field at
// all.
const updateDepartment = async (id: string, newDepartment: string) => {

  const { error } = await supabase
    .from("employees")
    .update({ department: newDepartment })
    .eq("id", id);

  if (!error) {
    fetchEmployees();
  }

};

const deleteEmployee=async()=>{

const res = await fetch("/api/delete-employee", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ employeeId: selectedId }),
});

const result = await res.json();

if(!result.success){
  alert(result.message);
}

setDeleteOpen(false);

fetchEmployees();

};

const filteredEmployees=
employees.filter((employee)=>{

const matchesSearch=

employee.name
?.toLowerCase()
.includes(
search.toLowerCase()
)

||

employee.email
?.toLowerCase()
.includes(
search.toLowerCase()
);

const matchesFilter=

filter==="all"

||

employee.role===filter;

return matchesSearch
&&
matchesFilter;

});



return(

<div className="space-y-6">

<AddEmployeeModal
open={openModal}
setOpen={setOpenModal}
refreshEmployees={fetchEmployees}
/>
<DeleteModal

open={deleteOpen}

setOpen={setDeleteOpen}

onDelete={deleteEmployee}

/>


{/* TOP */}

<div className="
flex
flex-col
md:flex-row
justify-between
gap-5
">

<div>

<h1 className="
text-3xl
font-bold
text-slate-800
">

Employees

</h1>

<p className="
text-slate-500
mt-1
">

Manage team members

</p>

</div>


<button

onClick={()=>
setOpenModal(true)
}

className="
h-12
px-6
rounded-2xl
text-white
font-medium
bg-gradient-to-r
from-blue-600
to-cyan-500
shadow-lg
hover:scale-105
transition
"

>

+ Add Employee

</button>

</div>



{/* STATS */}

<div className="
grid
grid-cols-2
lg:grid-cols-4
gap-4
">

<div className="
bg-gradient-to-br
from-cyan-50
to-blue-100
rounded-3xl
p-5
">

<p className="text-sm">

Total

</p>

<h1 className="
text-3xl
font-bold
">

{employees.length}

</h1>

</div>



<div className="
bg-gradient-to-br
from-cyan-50
to-blue-100
rounded-3xl
p-5
">

<p className="text-sm">

Admins

</p>

<h1 className="
text-3xl
font-bold
">

{
employees.filter(
e=>e.role==="admin"
).length
}

</h1>

</div>



<div className="
bg-gradient-to-br
from-cyan-50
to-blue-100
rounded-3xl
p-5
">

<p className="text-sm">

Employees

</p>

<h1 className="
text-3xl
font-bold
">

{
employees.filter(
e=>e.role==="employee"
).length
}

</h1>

</div>



<div className="
bg-gradient-to-br
from-green-50
to-green-100
rounded-3xl
p-5
">

<p className="text-sm">

Status

</p>

<h1 className="
text-2xl
font-bold
text-green-700
">

Active

</h1>

</div>

</div>




{/* SEARCH */}

<input

placeholder="🔍 Search employee"

value={search}

onChange={(e)=>
setSearch(
e.target.value
)
}

className="
w-full
h-14
rounded-2xl
bg-white
border
border-slate-200
px-5
outline-none
focus:ring-4
focus:ring-cyan-200
"
/>



{/* FILTERS */}

<div className="
flex
gap-3
flex-wrap
">

{

["all","admin","employee"]

.map((item)=>(

<button

key={item}

onClick={()=>
setFilter(item)
}

className={`

px-5
py-2
rounded-full
capitalize
transition

${
filter===item

?

"bg-blue-600 text-white"

:

"bg-white"

}

`}

>

{item}

</button>

))

}

</div>



{/* EMPLOYEE LIST */}

{

loading

?

<div>

Loading...

</div>

:

<div className="
space-y-4
">

{

filteredEmployees.map(
(employee)=>(


<div

key={employee.id}

onClick={()=>
router.push(
`/admin/employees/${employee.id}`
)
}

className="
bg-white
rounded-3xl
shadow-md
border
border-slate-100
p-5
flex
flex-col
md:flex-row
md:justify-between
md:items-center
gap-4
cursor-pointer
hover:scale-[1.02]
hover:shadow-xl
transition-all
duration-300
"
>
  <div className="
flex
items-center
gap-4
">

<div className="
h-14
w-14
rounded-full
bg-gradient-to-r
from-cyan-500
to-blue-600
flex
items-center
justify-center
text-white
font-bold
text-lg
">

{

employee.name
?.charAt(0)

}

</div>


<div>

<h2 className="
font-bold
text-slate-800
">

{employee.name}

</h2>

<p className="
text-sm
text-slate-500
">

{employee.email}

</p>

</div>

</div>



<div className="
flex
items-center
flex-wrap
gap-3
">

<span className="
px-4
py-2
rounded-full
text-xs
bg-cyan-100
text-cyan-700
">

{employee.role}

</span>
<span
className={`
px-4
py-2
rounded-full
text-xs
font-medium

${
employee.is_active
? "bg-green-100 text-green-700"
: "bg-red-100 text-red-700"
}
`}
>

{employee.is_active ? "Active" : "Inactive"}

</span>

<span
className={`
px-4
py-2
rounded-full
text-xs
font-medium

${
employee.rr_eligible
? "bg-amber-100 text-amber-700"
: "bg-slate-100 text-slate-500"
}
`}
>

{employee.rr_eligible ? "RR: On" : "RR: Off"}

</span><button
onClick={async (e) => {

e.stopPropagation();

await toggleEmployeeStatus(
employee.id,
employee.is_active
);

}}

className={`
px-4
py-2
rounded-xl
text-xs
font-semibold
transition

${
employee.is_active

? "bg-red-100 text-red-700 hover:bg-red-200"

: "bg-green-100 text-green-700 hover:bg-green-200"

}

`}
>

{employee.is_active

? "Deactivate"

: "Activate"

}

</button>

<button
onClick={async (e) => {

e.stopPropagation();

await toggleRREligible(
employee.id,
employee.rr_eligible
);

}}

className={`
px-4
py-2
rounded-xl
text-xs
font-semibold
transition

${
employee.rr_eligible

? "bg-slate-100 text-slate-600 hover:bg-slate-200"

: "bg-amber-100 text-amber-700 hover:bg-amber-200"

}

`}
>

{employee.rr_eligible

? "Remove from RR"

: "Add to RR"

}

</button>

{(employee.role === "employee" || employee.role === "sales_coordinator") && (
  <button
    onClick={async (e) => {
      e.stopPropagation();
      await toggleSalesCoordinator(employee.id, employee.role);
    }}
    className={`px-4 py-2 rounded-xl text-xs font-semibold transition ${
      employee.role === "sales_coordinator"
        ? "bg-blue-100 text-blue-700 hover:bg-blue-200"
        : "bg-cyan-50 text-cyan-700 hover:bg-cyan-100"
    }`}
  >
    {employee.role === "sales_coordinator" ? "Remove Coordinator role" : "Make Sales Coordinator"}
  </button>
)}

{employee.role === "employee" && (
  <select
    value={employee.department || "sales"}
    onChange={async (e) => {
      e.stopPropagation();
      await updateDepartment(employee.id, e.target.value);
    }}
    onClick={(e) => e.stopPropagation()}
    className="px-3 py-2 rounded-xl text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200 outline-none"
  >
    <option value="sales">Sales</option>
    <option value="hr">HR</option>
    <option value="accounts">Accounts</option>
    <option value="marketing">Digital Marketer</option>
    <option value="other">Other</option>
  </select>
)}

<button

onClick={(e)=>{

e.stopPropagation();

setSelectedId(employee.id);

setDeleteOpen(true);

}}
className="
h-10
w-10
rounded-full
bg-red-50
border
border-red-100
flex
items-center
justify-center
text-red-500
hover:bg-red-500
hover:text-white
hover:scale-110
transition-all
duration-300
shadow-sm
"

title="Delete Employee"

>

<svg
xmlns="http://www.w3.org/2000/svg"
className="w-5 h-5"
fill="none"
viewBox="0 0 24 24"
stroke="currentColor"
strokeWidth={2}
>

<path
strokeLinecap="round"
strokeLinejoin="round"
d="M19 7L18.132 19.142A2 2 0 0116.138 21H7.862A2 2 0 015.868 19.142L5 7M10 11V17M14 11V17M4 7H20M9 7V4A1 1 0 0110 3H14A1 1 0 0115 4V7"
/>

</svg>

</button>

</div>

</div>

))

}

</div>

}

</div>

)

}