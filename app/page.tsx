"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import Footer from "@/components/Footer";

import Header from "@/components/Header";
import StartShiftCard from "@/components/StartShiftCard";
import EmployeeTabBar from "@/components/EmployeeTabBar";
import PostsTrackingView from "@/components/PostsTrackingView";

export default function Page() {

const router = useRouter();

const [employee,setEmployee]=useState<any>(null);
const [authChecked,setAuthChecked]=useState(false);


// ✅ AUTH CHECK
useEffect(()=>{

async function getLoggedInEmployee(){

const {
data:{user},
}=await supabase.auth.getUser();

if(!user){

router.replace("/login");
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

if (data.role === "admin" || data.role === "super_admin") {

  router.replace("/admin");

  return;

}

if (data.role === "sales_coordinator") {

  router.replace("/coordinator");

  return;

}

if (data.role === "hr") {

  router.replace("/hr/attendance");

  return;

}

if (data.role === "payroll") {

  router.replace("/payroll");

  return;

}

setEmployee(data);

setAuthChecked(true);

}

getLoggedInEmployee();

},[]);


if(!authChecked){
  return (
    <div className="min-h-screen bg-white" />
  );
}

return(

<main className="
min-h-screen
bg-gradient-to-br
from-white
via-blue-50
to-blue-100
">

<Header />

<EmployeeTabBar role={employee?.role} department={employee?.department} />

{/* GPS shift-start is a Sales/field concern -- same isNonSales rule
    EmployeeTabBar already uses (department set and not "sales"), so
    pre-existing employees with no department value set keep seeing
    Start Shift exactly as before, and it's hidden for every non-Sales
    department (Marketing, Other, Accounts, HR) consistently. */}
{employee?.id && !(employee?.department && employee.department !== "sales") && (
  <StartShiftCard employeeId={employee.id} />
)}

<PostsTrackingView employeeId={employee?.id} employeeName={employee?.name} />

<Footer />
</main>

);

}
