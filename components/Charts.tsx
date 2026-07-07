"use client";

import { useState } from "react";

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
  const uniqueData = Array.from(

new Map(

data.map(
(d:any)=>[
`${d.employee_id}-${d["Post ID"]}`,
d
]
)

).values()

);

const scores: Record<
string,
{
totalPosts:number;
totalLikes:number;
}
> = {};

uniqueData.forEach((d:any)=>{

const name=d.Employee;

if(!scores[name]){

scores[name]={
totalPosts:0,
totalLikes:0
};

}

scores[name].totalPosts+=1;

const ig=

String(
d["IG Like"]||""
)
.trim()
.toUpperCase();

const fb=

String(
d["FB Like"]||""
)
.trim()
.toUpperCase();

if(ig==="YES"){

scores[name].totalLikes+=1;

}

if(fb==="YES"){

scores[name].totalLikes+=1;

}

});
  // ✅ PERCENT CALCULATION
  const chartData = Object.entries(scores)
    .map(([name, val]) => {
      const maxPossible = val.totalPosts * 2; // IG + FB
      const percent = Math.round((val.totalLikes / maxPossible) * 100);

      return { name, percent };
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