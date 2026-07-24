"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import { Building2, ShieldCheck, Mail, Lock, Eye, EyeOff, ArrowRight } from "lucide-react";
import { Playfair_Display } from "next/font/google";

import { supabase } from "@/lib/supabase";

const playfair = Playfair_Display({ subsets: ["latin"], weight: ["600", "700"] });

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    checkSession();
  }, []);

  const checkSession = async () => {
    const {
      data: { session }
    } = await supabase.auth.getSession();

    if (!session) return;

    const { data: employee } = await supabase
      .from("employees")
      .select("*")
      .eq("auth_user_id", session.user.id)
      .single();

    if (!employee?.is_active) {
      await supabase.auth.signOut();
      return;
    }

    if (employee?.role === "admin") {
      router.replace("/admin");
    } else {
      router.replace("/");
    }
  };

  const handleLogin = async () => {
    try {
      setLoading(true);

      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) {
        console.log("LOGIN ERROR:", error);
        toast.error("Invalid email or password");
        return;
      }

      const { data: employee } = await supabase
        .from("employees")
        .select("*")
        .eq("auth_user_id", data.user.id)
        .single();

      if (!employee?.is_active) {
        await supabase.auth.signOut();
        toast.error("Your account has been deactivated. Please contact administrator.");
        return;
      }

      if (employee?.role === "admin") {
        toast.success("Welcome back, Admin!");
        setTimeout(() => {
          router.replace("/admin");
        }, 600);
      } else {
        toast.success("Login Successful!");
        setTimeout(() => {
          router.replace("/");
        }, 600);
      }

      return;
    } catch (err) {
      console.log(err);
      toast.error("Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen relative overflow-hidden bg-[#080808] flex items-center justify-center px-4 sm:px-6 py-4">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-black via-[#0b0b0b] to-[#111827]" />

      {/* Gold glow */}
      <motion.div
        animate={{ x: [-20, 20, -20], y: [0, -20, 0] }}
        transition={{ duration: 10, repeat: Infinity }}
        className="absolute top-[-150px] left-[-150px] w-[350px] h-[350px] sm:w-[450px] sm:h-[450px] rounded-full bg-yellow-500/10 blur-[120px] sm:blur-[140px]"
      />

      {/* Blue glow */}
      <motion.div
        animate={{ x: [20, -20, 20], y: [0, 20, 0] }}
        transition={{ duration: 12, repeat: Infinity }}
        className="absolute bottom-[-150px] right-[-150px] w-[350px] h-[350px] sm:w-[450px] sm:h-[450px] rounded-full bg-cyan-500/10 blur-[120px] sm:blur-[140px]"
      />

      {/* Grid */}
      <div
        className="absolute inset-0 opacity-[0.05] bg-[linear-gradient(to_right,#ffffff_1px,transparent_1px),linear-gradient(to_bottom,#ffffff_1px,transparent_1px)] bg-[size:40px_40px] sm:bg-[size:55px_55px]"
      />

      {/* floating icons */}
      <motion.div
        animate={{ y: [0, -20, 0] }}
        transition={{ duration: 4, repeat: Infinity }}
        className="hidden lg:block absolute left-[10%] top-[25%] text-yellow-400/10"
      >
        <Building2 size={100} />
      </motion.div>

      <motion.div
        animate={{ y: [0, 20, 0] }}
        transition={{ duration: 5, repeat: Infinity }}
        className="hidden lg:block absolute right-[10%] bottom-[25%] text-cyan-400/10"
      >
        <ShieldCheck size={90} />
      </motion.div>

      {/* Main Card */}
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1 }}
        className="relative z-10 w-full max-w-[400px] mx-auto max-h-full overflow-y-auto"
      >
        <div
          className="
          bg-white/[0.04]
          backdrop-blur-3xl
          border
          border-white/10
          rounded-[24px] sm:rounded-[32px]
          px-6 sm:px-7
          py-6 sm:py-7
          shadow-[0_0_70px_rgba(0,255,255,.15)]
          "
        >
          {/* TOP GOLD ACCENT */}
          <div className="h-[2px] w-14 mx-auto mb-4 rounded-full bg-gradient-to-r from-transparent via-yellow-400 to-transparent" />

          {/* Logo */}
          <div className="flex justify-center mb-4">
            <div
              className="
              relative
              h-[64px] w-[64px] sm:h-[72px] sm:w-[72px]
              rounded-[20px] sm:rounded-[22px]
              bg-white
              overflow-hidden
              shadow-[0_0_50px_rgba(255,255,255,.3)]
              border border-white/80
              "
            >
              <Image
                src="/dpilogo.png"
                alt="DPI Logo"
                fill
                sizes="72px"
                className="object-contain scale-[1.45] p-1"
              />
            </div>
          </div>

          {/* Heading */}
          <div className="text-center">
            <h1
              className={`${playfair.className} text-white font-bold text-[26px] sm:text-[30px] leading-none tracking-tight`}
            >
              DPI Dashboard
            </h1>

 <div className="mt-2.5 text-center">
  <p className="text-[10px] text-gray-500 tracking-[0.15em] uppercase mb-1">
    Founders
  </p>
  <p className="text-[11px] tracking-wide">
    <span className="text-yellow-400/85 font-medium">Mr. Ashwani Srivastava</span>
    <span className="text-gray-600 mx-1.5">&amp;</span>
    <span className="text-yellow-400/85 font-medium">Mrs. Anamika Sinha</span>
  </p>
</div>

          </div>

          {/* Inputs */}
          <div className="mt-6 space-y-3.5">
            <div>
              <label className="text-gray-300 text-xs sm:text-sm mb-1.5 block">Email Address</label>

              <div className="relative">
                <Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  className="
                  w-full
                  h-[46px] sm:h-[50px]
                  rounded-xl
                  bg-white/[0.05]
                  border
                  border-white/10
                  pl-11
                  pr-5
                  text-white
                  text-sm
                  placeholder:text-gray-500
                  outline-none
                  transition-all
                  focus:border-yellow-400
                  focus:ring-4
                  focus:ring-yellow-400/20
                  "
                />
              </div>
            </div>

            <div>
              <label className="text-gray-300 text-xs sm:text-sm mb-1.5 block">Password</label>

              <div className="relative">
                <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleLogin();
                  }}
                  className="
                  w-full
                  h-[46px] sm:h-[50px]
                  rounded-xl
                  bg-white/[0.05]
                  border
                  border-white/10
                  pl-11
                  pr-11
                  text-white
                  text-sm
                  placeholder:text-gray-500
                  outline-none
                  transition-all
                  focus:border-yellow-400
                  focus:ring-4
                  focus:ring-yellow-400/20
                  "
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              onClick={handleLogin}
              disabled={loading}
              className="
              group
              w-full
              h-[48px] sm:h-[52px]
              rounded-xl
              bg-gradient-to-r
              from-yellow-500
              to-amber-300
              text-black
              font-bold
              text-sm
              shadow-[0_0_40px_rgba(234,179,8,.45)]
              hover:scale-[1.02]
              active:scale-[0.98]
              transition-all
              disabled:opacity-70
              disabled:hover:scale-100
              flex items-center justify-center gap-2
              "
            >
              {loading ? (
                "Signing In..."
              ) : (
                <>
                  Access Dashboard
                  <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
                </>
              )}
            </button>
          </div>

         <div className="mt-5 text-center space-y-1">
  <p className="text-[11px] text-gray-500">Protected by DPI Authentication</p>
  <p className="text-[10px] text-gray-600 tracking-wide">
    Designed &amp; Developed by <span className="text-yellow-500/70 font-semibold">Shivansh Saxena</span>
  </p>
  <p className="text-[9px] text-gray-700 tracking-wide">Version 1.0</p>
</div>
        </div>
      </motion.div>
    </div>
  );
}