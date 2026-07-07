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


export default function LowPerformers({
  data,
}: {
  data: DataType[];
}) {
  const weekData = getWeekData(data);

  const uniquePosts=getUniquePosts(weekData);

const penalties: Record<string, number> = {};

uniquePosts.forEach((post:any)=>{

const status =
calculateStatus(post);

if(

status==="MISSED"

||

status==="PERMANENT"

){

penalties[post.Employee] =
(penalties[post.Employee] || 0) + 1;

}

});

  // highest missed first
  const low = Object.entries(penalties)
    .sort((a, b) => b[1] - a[1])
    .filter(([_, missed]) => missed > 0);

  return (
    <div className="bg-red-50 p-4 rounded-2xl shadow">
      <h3 className="font-semibold mb-3 text-red-600">
        ⚠️ Weekly Low Performers
      </h3>

      <div className="max-h-[300px] overflow-y-auto flex flex-col gap-2">
        {low.length === 0 ? (
          <div className="text-green-600 text-sm">
            No low performers this week 🎉
          </div>
        ) : (
          low.map(([name, missed]) => (
            <div
              key={name}
              className="flex justify-between bg-white p-2 rounded"
            >
              <span>{name}</span>

              <span className="text-red-500 font-semibold">
                Missed: {missed}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}