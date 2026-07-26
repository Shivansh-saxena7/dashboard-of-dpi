"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { supabase } from "@/lib/supabase";
import toast, { Toast } from "react-hot-toast";

export default function SettingsPage() {
  const [employees, setEmployees] = useState<any[]>([]);

  const [selectedEmployee, setSelectedEmployee] = useState("");

  const [email, setEmail] = useState("");

  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  // ✅ Multi Admin section state
  const [selectedAdminEmployee, setSelectedAdminEmployee] = useState("");
  const [adminActionLoading, setAdminActionLoading] = useState<"make" | "remove" | null>(null);

  // ✅ Geofence settings state (V2 — Attendance / Shift Gate)
  const [geoLat, setGeoLat] = useState("");
  const [geoLng, setGeoLng] = useState("");
  const [geoRadius, setGeoRadius] = useState("");
  const [geoLoading, setGeoLoading] = useState(false);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    loadEmployees();
  }, []);

  useEffect(() => {
    loadGeofenceSettings();
  }, []);

  async function loadGeofenceSettings() {
    const { data } = await supabase
      .from("lead_engine_settings")
      .select("office_lat, office_lng, geofence_radius_meters")
      .eq("id", 1)
      .single();

    if (data) {
      setGeoLat(data.office_lat !== null ? String(data.office_lat) : "");
      setGeoLng(data.office_lng !== null ? String(data.office_lng) : "");
      setGeoRadius(String(data.geofence_radius_meters ?? 35));
    }
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      toast.error("Location isn't available on this device/browser.");
      return;
    }

    setLocating(true);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGeoLat(String(position.coords.latitude));
        setGeoLng(String(position.coords.longitude));
        toast.success("Current location captured — review and Save below.");
        setLocating(false);
      },
      (err) => {
        console.log(err);
        toast.error("Couldn't get your location. Please allow location access and try again.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  async function saveGeofenceSettings() {
    const lat = parseFloat(geoLat);
    const lng = parseFloat(geoLng);
    const radius = parseInt(geoRadius, 10);

    if (Number.isNaN(lat) || Number.isNaN(lng) || Number.isNaN(radius)) {
      toast.error("Enter a valid latitude, longitude, and radius.");
      return;
    }

    setGeoLoading(true);

    try {
      const res = await fetch("/api/admin/update-lead-engine-settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          office_lat: lat,
          office_lng: lng,
          geofence_radius_meters: radius
        })
      });

      const result = await res.json();

      if (!res.ok) {
        toast.error(result.error || "Failed to update geofence settings.");
        return;
      }

      toast.success("Geofence settings updated successfully");
    } catch (err) {
      console.log(err);
      toast.error("Something went wrong.");
    } finally {
      setGeoLoading(false);
    }
  }

  async function loadEmployees() {
    const { data } = await supabase.from("employees").select("id,name,email,role,auth_user_id").order("name");

    setEmployees(data || []);
  }

  async function updateCredentials() {
    if (!selectedEmployee) {
      alert("Select Employee");
      return;
    }

    setLoading(true);

    try {
      const employee = employees.find((x: any) => x.id === selectedEmployee);

      if (!employee) {
        toast.error("Please select an employee.");
        return;
      }

      const res = await fetch("/api/admin/update-user", {
        method: "POST",

        headers: {
          "Content-Type": "application/json"
        },

        body: JSON.stringify({
          auth_user_id: employee.auth_user_id,

          email,

          password
        })
      });

      const result = await res.json();

      if (!res.ok) {
        toast.error(result.error);
        return;
      }

      toast.success("Credentials Updated Successfully");

      setPassword("");

      loadEmployees();
    } catch (err) {
      console.log(err);

      toast.error("Something went wrong.");
    }

    setLoading(false);
  }

  // ✅ selected employee object for the Multi Admin section
  const selectedAdminEmployeeData = employees.find((x: any) => x.id === selectedAdminEmployee);

  async function makeAdmin() {
    if (!selectedAdminEmployee) {
      toast.error("Please select an employee.");
      return;
    }

    if (selectedAdminEmployeeData?.role === "admin") {
      toast.error("This employee is already an admin.");
      return;
    }

    setAdminActionLoading("make");

    try {
      const { error } = await supabase
        .from("employees")
        .update({ role: "admin" })
        .eq("id", selectedAdminEmployee);

      if (error) {
        console.log(error);
        toast.error("Failed to update role.");
        return;
      }

      toast.success(`${selectedAdminEmployeeData?.name} is now an Admin`);

      setSelectedAdminEmployee("");

      loadEmployees();
    } catch (err) {
      console.log(err);
      toast.error("Something went wrong.");
    } finally {
      setAdminActionLoading(null);
    }
  }

  async function removeAdmin() {
    if (!selectedAdminEmployee) {
      toast.error("Please select an employee.");
      return;
    }

    if (selectedAdminEmployeeData?.role !== "admin") {
      toast.error("This employee is not an admin.");
      return;
    }

    setAdminActionLoading("remove");

    try {
      const { error } = await supabase
        .from("employees")
        .update({ role: "employee" })
        .eq("id", selectedAdminEmployee);

      if (error) {
        console.log(error);
        toast.error("Failed to update role.");
        return;
      }

      toast.success(`${selectedAdminEmployeeData?.name} is no longer an Admin`);

      setSelectedAdminEmployee("");

      loadEmployees();
    } catch (err) {
      console.log(err);
      toast.error("Something went wrong.");
    } finally {
      setAdminActionLoading(null);
    }
  }

  return (
    <div className="space-y-6">
      <motion.div
        initial={{
          opacity: 0,
          y: -20
        }}
        animate={{
          opacity: 1,
          y: 0
        }}
        className="
relative
overflow-hidden
rounded-[24px]
bg-gradient-to-br
from-[#0f172a]
via-[#1d4ed8]
to-[#06b6d4]
p-6
text-white
shadow-[0_15px_50px_rgba(37,99,235,0.2)]
"
      >
        <div
          className="
absolute
top-[-60px]
right-[-60px]
w-[150px]
h-[150px]
rounded-full
bg-white/10
blur-3xl
"
        />

        <h1
          className="
text-3xl
font-bold
"
        >
          Settings
        </h1>

        <p
          className="
mt-2
text-white/80
text-sm
"
        >
          Manage application settings
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="
bg-white
rounded-[24px]
border
border-slate-100
shadow-md
p-6
"
      >
        <h2
          className="
text-xl
font-bold
text-slate-800
mb-5
"
        >
          🔐 Login Credentials
        </h2>

        <div className="space-y-4">
          <select
            value={selectedEmployee}
            onChange={(e) => {
              setSelectedEmployee(e.target.value);

              const emp = employees.find((x: any) => x.id === e.target.value);

              if (emp) {
                setEmail(emp.email);
              }
            }}
            className="
w-full
h-12
rounded-xl
bg-slate-50
border
border-slate-200
px-4
outline-none
"
          >
            <option value="">Select Employee</option>

            {employees.map((emp: any) => (
              <option key={emp.id} value={emp.id}>
                {emp.name}
              </option>
            ))}
          </select>

          <input
            type="email"
            placeholder="Employee Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="
w-full
h-12
rounded-xl
bg-slate-50
border
border-slate-200
px-4
outline-none
"
          />

          <input
            type="password"
            placeholder="New Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="
w-full
h-12
rounded-xl
bg-slate-50
border
border-slate-200
px-4
outline-none
"
          />
          <button
            onClick={updateCredentials}
            disabled={loading}
            className="
w-full
h-12
rounded-xl
font-semibold
text-white
bg-gradient-to-r
from-blue-600
to-cyan-500
disabled:opacity-60
"
          >
            {loading ? "Updating..." : "Update Credentials"}
          </button>
        </div>
      </motion.div>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="
bg-white
rounded-[24px]
border
border-slate-100
shadow-md
p-6
"
      >
        <h2
          className="
text-xl
font-bold
text-slate-800
mb-5
"
        >
          👑 Multi Admin
        </h2>

        <div className="space-y-4">
          <select
            value={selectedAdminEmployee}
            onChange={(e) => setSelectedAdminEmployee(e.target.value)}
            className="
w-full
h-12
rounded-xl
bg-slate-50
border
border-slate-200
px-4
outline-none
"
          >
            <option value="">Select Employee</option>

            {employees.map((emp: any) => (
              <option key={emp.id} value={emp.id}>
                {emp.name} {emp.role === "admin" ? "(Admin)" : ""}
              </option>
            ))}
          </select>

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={makeAdmin}
              disabled={
                !selectedAdminEmployee ||
                selectedAdminEmployeeData?.role === "admin" ||
                adminActionLoading !== null
              }
              className="
h-12
rounded-xl
font-semibold
text-white
bg-gradient-to-r
from-blue-600
to-cyan-500
disabled:opacity-50
"
            >
              {adminActionLoading === "make" ? "Updating..." : "Make Admin"}
            </button>

            <button
              onClick={removeAdmin}
              disabled={
                !selectedAdminEmployee ||
                selectedAdminEmployeeData?.role !== "admin" ||
                adminActionLoading !== null
              }
              className="
h-12
rounded-xl
font-semibold
text-white
bg-gradient-to-r
from-red-500
to-rose-500
disabled:opacity-50
"
            >
              {adminActionLoading === "remove" ? "Updating..." : "Remove Admin"}
            </button>
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="
bg-white
rounded-[24px]
border
border-slate-100
shadow-md
p-6
"
      >
        <h2
          className="
text-xl
font-bold
text-slate-800
mb-5
"
        >
          📍 Geofence Settings
        </h2>

        <p className="text-sm text-slate-500 mb-4">
          Employees must be within this radius of the office to start their shift and unlock new lead assignment. This never affects social media post access.
        </p>

        <div className="space-y-4">
          <button
            onClick={useMyLocation}
            disabled={locating}
            className="
w-full
h-12
rounded-xl
font-semibold
text-white
bg-gradient-to-r
from-blue-600
to-cyan-500
disabled:opacity-60
"
          >
            {locating ? "Locating..." : "📍 Use My Current Location"}
          </button>

          <div className="grid grid-cols-2 gap-3">
            <input
              type="number"
              step="any"
              placeholder="Office Latitude"
              value={geoLat}
              onChange={(e) => setGeoLat(e.target.value)}
              className="
w-full
h-12
rounded-xl
bg-slate-50
border
border-slate-200
px-4
outline-none
"
            />

            <input
              type="number"
              step="any"
              placeholder="Office Longitude"
              value={geoLng}
              onChange={(e) => setGeoLng(e.target.value)}
              className="
w-full
h-12
rounded-xl
bg-slate-50
border
border-slate-200
px-4
outline-none
"
            />
          </div>

          <input
            type="number"
            placeholder="Geofence Radius (meters)"
            value={geoRadius}
            onChange={(e) => setGeoRadius(e.target.value)}
            className="
w-full
h-12
rounded-xl
bg-slate-50
border
border-slate-200
px-4
outline-none
"
          />

          <p className="text-xs text-slate-400">
            Manual entry also works — the location button just fills these in for convenience.
          </p>

          <button
            onClick={saveGeofenceSettings}
            disabled={geoLoading}
            className="
w-full
h-12
rounded-xl
font-semibold
text-white
bg-gradient-to-r
from-blue-600
to-cyan-500
disabled:opacity-60
"
          >
            {geoLoading ? "Saving..." : "Save Geofence Settings"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}