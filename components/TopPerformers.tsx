"use client";
import {calculateStatus} from "./calculateStatus";
import { getWeekData } from "@/lib/getWeekData";
import { getUniquePosts } from "@/lib/getUniquePosts";
type DataType = {
  Employee: string;
  Date: string;
  "IG Like": string;
  "FB Like": string;
};


export default function TopPerformers({ data }: { data: DataType[] }) {
  const weekData = getWeekData(data);


const uniquePosts = getUniquePosts(weekData);
const scores: Record<string, number> = {};

uniquePosts.forEach((post:any)=>{

const status =
calculateStatus(post);

if(status==="COMPLETED"){

scores[post.Employee] =
(scores[post.Employee] || 0) + 1;

}

});

  const top = Object.entries(scores)
  .filter(([_, score]) => score > 0)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 3);
  const now = new Date();

const start = new Date(now);
start.setDate(now.getDate() - 6);

const formatDate = (date: Date) =>
  date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
  });

const weekRange = `${formatDate(start)} - ${formatDate(now)}`;

  return (
    <div className="bg-yellow-100 p-4 rounded-2xl shadow">
      <h3 className="font-semibold mb-3">🏆 This Week . {weekRange}</h3>

      {top.map(([name, score], i) => (
        <div key={name} className="flex justify-between py-1">
          <span>{i + 1}. {name}</span>
          <span>{score}</span>
        </div>
      ))}
    </div>
  );
}