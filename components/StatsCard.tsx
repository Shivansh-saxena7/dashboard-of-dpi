"use client";

import { motion } from "framer-motion";

type Props = {
  stats: {
    ig: number;
    fb: number;
    posts: number;
    employees: number;
    engagement: number;
  };
  employeeName: string;
};
 

export default function StatsCards({ stats,employeeName, }: Props) {
  const hour: number = new Date().getHours();

let greeting: string = "Good Morning";

if (hour >= 12 && hour < 17) {
  greeting = "Good Afternoon";
}

if (hour >= 17 && hour < 21) {
  greeting = "Good Evening";
}

if (hour >= 21 || hour < 5) {
  greeting = "Good Night";
}
  const cards = [
    {
      title: "IG Likes",
      value: stats.ig,
      color: "from-pink-500 to-purple-500",
      icon: "📸",
    },
    {
      title: "FB Likes",
      value: stats.fb,
      color: "from-blue-500 to-indigo-500",
      icon: "📘",
    },
    {
      title: "Posts",
      value: stats.posts,
      color: "from-orange-400 to-yellow-500",
      icon: "📝",
    },
    {
  title: greeting,
  value: employeeName,
  color: "from-violet-500 to-fuchsia-500",
  icon: "✨",
},
    {
      title: "Engagement",
      value: stats.engagement + "%",
      color: "from-green-400 to-emerald-500",
      icon: "📊",
    },
  ];


  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4 px-3 sm:px-4 mt-4 sm:mt-6">

      {cards.map((card, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 25 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.08 }}
          className={`
            relative 
            p-3 sm:p-4 
            rounded-2xl 
            overflow-hidden
            bg-white/60 backdrop-blur-xl 
            border border-white/40 
            shadow-md sm:shadow-lg
            hover:shadow-xl 
            active:scale-[0.97]
            transition duration-300

            ${i === cards.length - 1 ? "col-span-2 sm:col-span-1" : ""}
          `}
        >

          {/* GRADIENT GLOW */}
          <div
            className={`absolute inset-0 opacity-20 bg-gradient-to-br ${card.color}`}
          />

          {/* CONTENT */}
          <div className="relative z-10 flex flex-col gap-1 sm:gap-2">

            <div className="flex justify-between items-center">
              <span className="text-[11px] sm:text-sm text-gray-600">
                {card.title}
              </span>

              <span className="text-lg sm:text-xl">
                {card.icon}
              </span>
            </div>

            <h2 className="text-xl sm:text-2xl font-bold text-gray-800">
              {card.value}
            </h2>

          </div>

        </motion.div>
      ))}
    </div>
  );
}