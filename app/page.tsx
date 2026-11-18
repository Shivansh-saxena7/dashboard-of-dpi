"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/currentUser";
import Footer from "@/components/Footer";

import Header from "@/components/Header";
import StartShiftCard from "@/components/StartShiftCard";
import EmployeeTabBar from "@/components/EmployeeTabBar";
import PostsTrackingView from "@/components/PostsTrackingView";
import ResumeCallStrip from "@/components/ResumeCallStrip";
import { takeColdStartResume } from "@/lib/activeCall";
import { rememberEmployeeId } from "@/lib/clientIdentity";
import EmployeeHomeP1 from "@/components/EmployeeHomeP1";
import { homeModeAllows } from "@/lib/employeeHome";

export default function Page() {

const router = useRouter();

const [employee,setEmployee]=useState<any>(null);
const [authChecked,setAuthChecked]=useState(false);
// Employee Home Phase 1 (2026-11-18): lead_engine_settings.employee_home_mode. Off (the old Home) unless the setting
// says otherwise; a missing column, a failed read or a slow answer (over 2 s) all mean off.
const [newHome,setNewHome]=useState(false);


// ✅ AUTH CHECK
useEffect(()=>{

async function getLoggedInEmployee(){

const user = await getCurrentUser();

if(!user){

router.replace("/login");
return;

}

const homeModePromise: Promise<Record<string, unknown> | null> = Promise.race([
  Promise.resolve(supabase.from("lead_engine_settings").select("*").eq("id", 1).maybeSingle())
    .then(({ data: settings }) => (settings as Record<string, unknown> | null) ?? null, () => null),
  new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000))
]);

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

// Call-return (2026-11-13): an app started again during a call goes straight back to that lead (lib/activeCall.ts).
rememberEmployeeId(data.id);
const resumePath = takeColdStartResume(data.id);
if (resumePath) {

  router.replace(resumePath);

  return;

}

const homeSettings = await homeModePromise;
setNewHome(homeModeAllows(homeSettings, data.id));

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

<ResumeCallStrip employeeId={employee?.id} />

{/* GPS shift-start is a Sales/field concern -- same isNonSales rule
    EmployeeTabBar already uses (department set and not "sales"), so
    pre-existing employees with no department value set keep seeing
    Start Shift exactly as before, and it's hidden for every non-Sales
    department (Marketing, Other, Accounts, HR) consistently. */}
{employee?.id && !(employee?.department && employee.department !== "sales") && (
  <StartShiftCard employeeId={employee.id} />
)}

{newHome && employee?.id ? (
  <EmployeeHomeP1 employeeId={employee.id} employeeName={employee?.name} />
) : (
  <PostsTrackingView employeeId={employee?.id} employeeName={employee?.name} />
)}

<Footer />
</main>

);

}
