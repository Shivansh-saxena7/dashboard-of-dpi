"use client";

import { useState } from "react";
import { getUniquePosts } from "@/lib/getUniquePosts";
import { calculateStatus } from "./calculateStatus";

type DataType = {
  Employee: string;
  employee_id:string;
  "Post ID":string;
  "IG Like": string;
  "FB Like": string;
};

export default function Charts({ data }: { data: DataType[] }) {
  const [showAll, setShowAll] = useState(false);

  // ✅ REAL PERFORMANCE CALCULATION
 const uniqueData = getUniquePosts(data);

const scores: Record<
  string,
  {
    totalPosts: number;
    completed: number;
  }
> = {};

uniqueData.forEach((post: any) => {

  const name = post.Employee;

  if (!scores[name]) {

    scores[name] = {
      totalPosts: 0,
      completed: 0
    };

  }

  scores[name].totalPosts++;

  if (calculateStatus(post) === "COMPLETED") {

    scores[name].completed++;

  }

});
  // ✅ PERCENT CALCULATION
 const chartData = Object.entries(scores)
  .map(([name, val]) => {

    const percent =
      val.totalPosts > 0
        ? Math.round((val.completed / val.totalPosts) * 100)
        : 0;

    return {
      name,
      percent
    };

  })
  .sort((a, b) => b.percent - a.percent);
   

  // ✅ MOBILE OPTIMIZATION (TOP 4)
  const visibleData = showAll ? chartData : chartData.slice(0, 4);

  return (
    <div className="bg-white/60 backdrop-blur-xl p-4 rounded-2xl shadow border border-white/40">

      {/* HEADER */}
      <div className="flex justify-between items-center mb-3">
        <h2 className="text-base font-semibold">
          📊 Performance
        </h2>

        {chartData.length > 4 && (
          <button
            onClick={() => setShowAll(!showAll)}
            className="text-xs text-blue-600"
          >
            {showAll ? "Less" : "View All"}
          </button>
        )}
      </div>

      {/* LIST */}
      <div className="flex flex-col gap-3">

        {visibleData.map((item, i) => (
          <div key={item.name} className="flex flex-col gap-1">

            {/* NAME + % */}
            <div className="flex justify-between text-xs">
              <span className="font-medium">
                {i === 0 ? "🔥 " : ""}{item.name}
              </span>
              <span>{item.percent}%</span>
            </div>

            {/* PROGRESS BAR */}
            <div className="w-full h-2 bg-gray-200 rounded-full">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all duration-500"
                style={{ width: `${item.percent}%` }}
              />
            </div>

          </div>
        ))}

      </div>
    </div>
  );
}