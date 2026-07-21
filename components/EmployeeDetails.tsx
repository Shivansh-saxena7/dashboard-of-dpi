"use client";

import { useEffect, useState } from "react";
import { getUniquePosts } from "@/lib/getUniquePosts";


export default function EmployeeDetails({
  data,
  selected,
  selectedDate,
}: any) {
  const [open, setOpen] = useState<string | null>(null);

  const [filter, setFilter] = useState<"all" | "missed" | "permanent">("all");

  // ✅ per post tracking
  const [openedLinks, setOpenedLinks] = useState<{
    [postId: string]: {
      ig: boolean;
      fb: boolean;
    };
  }>({});

  // ✅ force rerender state
  const [allData, setAllData] = useState(data);
  useEffect(() => {
  setAllData(data);
}, [data]);

  if (!selected) return <div>Select employee</div>;

const posts = getUniquePosts(allData);

  // ✅ normalize
  const isYes = (v: any) => String(v || "").trim().toUpperCase() === "YES";

  // ✅ filters
  const filteredPosts = posts.filter((post: any) => {
    const list = allData.filter((d: any) => d["Post ID"] === post["Post ID"]);

    const me = list.find((d: any) => String(d.employee_id || "").trim() === String(selected || "").trim());
    console.log("SELECTED:", selected);
console.log("ME RECORD:", me);

    if (!me) return false;

    const igDone = isYes(me["IG Like"]);
    const fbDone = isYes(me["FB Like"]);
    const now = new Date();

    const postDate = new Date(me.Date);

    // deadline = उसी post दिन की रात 11:00
    const deadline = new Date(postDate);

    deadline.setHours(23, 0, 0, 0);

    const isPermanentMissed = now > deadline && !(igDone && fbDone);

    // permanent
    if (filter === "permanent") {
      return isPermanentMissed;
    }

    // missed
    const missedTime = new Date(postDate);

    missedTime.setHours(18, 30, 0, 0);

    if (filter === "missed") {
      return now > missedTime && !(igDone && fbDone) && !isPermanentMissed;
    }

    // all
    if (filter === "all") {
      return true;
    }

    return false;
  });

  const format = (id: string, date?: string) => {
    const postNumber = id.split("-P")[1];

    if (!date) {
      return `Post ${postNumber}`;
    }

    const parsed = new Date(date);

    const day = parsed.getDate();

    const month = parsed.toLocaleString("en-US", {
      month: "short"
    });

    return `${day} ${month} • Post ${postNumber}`;
  };

  return (
    <div className="space-y-2">
      {/* FILTERS */}
      <div className="flex gap-2 mb-2">
        <button
          onClick={() => setFilter("all")}
          className={`px-3 py-1 text-xs rounded-full ${
            filter === "all" ? "bg-blue-500 text-white" : "bg-gray-200 text-gray-600"
          }`}
        >
          All
        </button>

        <button
          onClick={() => setFilter("missed")}
          className={`px-3 py-1 text-xs rounded-full ${
            filter === "missed" ? "bg-red-500 text-white" : "bg-gray-200 text-gray-600"
          }`}
        >
          ❌ Missed
        </button>

        <button
          onClick={() => setFilter("permanent")}
          className={`px-3 py-1 text-xs rounded-full ${
            filter === "permanent" ? "bg-black text-white" : "bg-gray-200 text-gray-600"
          }`}
        >
          ⛔ Permanent
        </button>
      </div>

      {filteredPosts.map((post: any) => {
        const list = allData.filter((d: any) => d["Post ID"] === post["Post ID"]);

        const me = list.find((d: any) => String(d.employee_id || "").trim() === String(selected || "").trim());

        const both = list.filter((d: any) => isYes(d["IG Like"]) && isYes(d["FB Like"]));

        const ig = list.filter((d: any) => isYes(d["IG Like"]) && !isYes(d["FB Like"]));

        const fb = list.filter((d: any) => isYes(d["FB Like"]) && !isYes(d["IG Like"]));

        const miss = !isYes(me?.["IG Like"]) && !isYes(me?.["FB Like"]) ? [me] : [];

        const igMissed = !isYes(me?.["IG Like"]);
        const fbMissed = !isYes(me?.["FB Like"]);

        const now = new Date();

        const postDate = new Date(me?.Date);

        const deadline = new Date(postDate);

        deadline.setHours(23, 0, 0, 0);

        const isPermanentMissed = now > deadline && !(isYes(me?.["IG Like"]) && isYes(me?.["FB Like"]));

        // ✅ current post state
        const currentLinks = openedLinks[post["Post ID"]] || {
          ig: false,
          fb: false
        };

        const canMarkDone = !((igMissed && !currentLinks.ig) || (fbMissed && !currentLinks.fb));

        return (
          <div key={post["Post ID"]} className="bg-white p-2 rounded-lg shadow-sm border">
            <p className="inline-block text-[10px] px-2 py-1 rounded-full bg-blue-50 text-blue-600 font-medium mb-1">
              👤 {me?.Employee}
            </p>

            <div
              onClick={() => setOpen(open === post["Post ID"] ? null : post["Post ID"])}
              className="flex justify-between items-center cursor-pointer"
            >
              <div>
                <p className="text-xs sm:text-sm font-semibold">{format(post["Post ID"], post.Date)}</p>

                <p className="text-[10px] text-gray-500 mt-1 flex flex-wrap gap-1">
                  🔥 {both.length} • 📸 {ig.length} • 👍 {fb.length} • ❌ {miss.length}
                </p>
              </div>

              <span className="text-xs">{open === post["Post ID"] ? "▲" : "▼"}</span>
            </div>

            {open === post["Post ID"] && (
              <div className="mt-2 space-y-3 max-h-[320px] overflow-y-auto pr-1">
                {/* STATUS */}
                <div className="bg-gray-50 border rounded-lg p-2">
                  <p className="text-[10px] text-gray-400 mb-1">Your Status</p>

                  <div className="flex gap-2 flex-wrap">
                    <span
                      className={`px-2 py-1 rounded-full text-[10px] font-medium ${
                        !igMissed ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"
                      }`}
                    >
                      IG {me?.["IG Like"]}
                    </span>

                    <span
                      className={`px-2 py-1 rounded-full text-[10px] font-medium ${
                        !fbMissed ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"
                      }`}
                    >
                      FB {me?.["FB Like"]}
                    </span>
                  </div>
                </div>

                {/* PERMANENT */}
                {me?.permanent_missed && (
                  <div className="bg-black text-white rounded-lg p-3">
                    <p className="text-xs font-semibold mb-1">⛔ Deadline Passed</p>

                    <p className="text-[10px] opacity-80">
                      This post could not be completed before the 11:00 PM cutoff and has been marked as permanently
                      missed.
                    </p>
                  </div>
                )}

                {/* MISSED */}
                {(igMissed || fbMissed) && !isPermanentMissed && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                    <p className="text-xs text-red-600 font-semibold mb-1">Action Required</p>

                    <p className="text-[10px] text-red-500/80 mb-3">
                      Complete the steps below to update your status for this post.
                    </p>

                    {/* STEP 1 */}
                    <div className="mb-3">
                      <p className="text-[10px] font-semibold text-gray-600 mb-1.5 flex items-center gap-1.5">
                        <span className="h-4 w-4 rounded-full bg-gray-800 text-white text-[9px] flex items-center justify-center font-bold">
                          1
                        </span>
                        Open the post and like it
                      </p>

                      <div className="flex gap-2 flex-wrap">
                        {igMissed && (
                          <a
                            href={post["IG Link"]}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() =>
                              setOpenedLinks((prev) => ({
                                ...prev,
                                [post["Post ID"]]: {
                                  ...currentLinks,
                                  ig: true
                                }
                              }))
                            }
                            className={`px-3 py-1 text-[10px] font-medium rounded-full transition ${
                              currentLinks.ig
                                ? "bg-green-100 text-green-700"
                                : "bg-blue-100 text-blue-700 hover:bg-blue-200"
                            }`}
                          >
                            {currentLinks.ig ? "✓ Instagram Opened" : "Open Instagram"}
                          </a>
                        )}

                        {fbMissed && (
                          <a
                            href={post["FB Link"]}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() =>
                              setOpenedLinks((prev) => ({
                                ...prev,
                                [post["Post ID"]]: {
                                  ...currentLinks,
                                  fb: true
                                }
                              }))
                            }
                            className={`px-3 py-1 text-[10px] font-medium rounded-full transition ${
                              currentLinks.fb
                                ? "bg-green-100 text-green-700"
                                : "bg-indigo-100 text-indigo-700 hover:bg-indigo-200"
                            }`}
                          >
                            {currentLinks.fb ? "✓ Facebook Opened" : "Open Facebook"}
                          </a>
                        )}
                      </div>
                    </div>

                    {/* STEP 2 */}
                    <div>
                      <p className="text-[10px] font-semibold text-gray-600 mb-1.5 flex items-center gap-1.5">
                        <span
                          className={`h-4 w-4 rounded-full text-white text-[9px] flex items-center justify-center font-bold ${
                            canMarkDone ? "bg-gray-800" : "bg-gray-300"
                          }`}
                        >
                          2
                        </span>
                        Confirm once you've liked both
                      </p>

                      {!canMarkDone && (
                        <p className="text-[10px] bg-yellow-100 text-yellow-800 p-2 rounded mb-2">
                          Please open and like the post{igMissed && fbMissed ? "s" : ""} above before confirming.
                          Marking done without liking may result in your submission being rejected.
                        </p>
                      )}

                     <button
                        disabled={!canMarkDone}
                        onClick={async () => {
                          try {
                            const updatePlatforms = [];

                            if (igMissed) {
                              updatePlatforms.push("ig");
                            }

                            if (fbMissed) {
                              updatePlatforms.push("fb");
                            }

                            const res = await fetch(
                              "https://inmxkanrwcjlgajqpcuf.supabase.co/functions/v1/update-tracking-status",
                              {
                                method: "POST",
                                headers: {
                                  "Content-Type": "application/json"
                                },
                                body: JSON.stringify({
                                  id: me.id,
                                  platforms: updatePlatforms
                                })
                              }
                            );

                            if (!res.ok) {
                              const errText = await res.text();
                              console.log("UPDATE ERROR", errText);
                              return;
                            }

                     const refresh = await fetch(
  `/api/data?employeeId=${selected}&date=${selectedDate}`,
  {
    cache: "no-store",
  }
);
                            const json = await refresh.json();

                            const records = Array.isArray(json) ? json : json.data || [];

                            setAllData(records);

                            setOpen(null);
                          } catch (err) {
                            console.log(err);
                          }
                        }}
                           className={`w-full py-2 text-[11px] rounded-lg font-semibold transition ${
                          canMarkDone
                            ? "bg-red-500 text-white hover:bg-red-600"
                            : "bg-gray-300 text-gray-500 cursor-not-allowed"
                        }`}
                      >
                        {canMarkDone ? "Confirm — Mark as Done" : "Mark Done"}
                      </button>
                    </div>
                  </div>
                )}

                {/* GROUPS */}
                <Block title="✔ Both" data={both} color="green" />

                <Block title="📸 IG Only" data={ig} color="blue" />

                <Block title="👍 FB Only" data={fb} color="indigo" />

                <Block title="❌ Missed" data={miss} color="red" limit />

                {/* POST DETAILS */}
                <div className="bg-gray-50 border rounded-lg p-3">
                  <p className="text-xs font-semibold mb-2">📄 Post Details</p>

                  <div className="space-y-2 text-[11px]">
                    <div>
                      <span className="font-medium">Post ID:</span> {post["Post ID"]}
                    </div>

                    <div>
                      <span className="font-medium">Date:</span> {post.Date}
                    </div>

                    <div className="flex gap-2 flex-wrap">
                      {!isPermanentMissed && !isYes(me?.["IG Like"]) && post["IG Link"] && (
                        <a
                          href={post["IG Link"]}
                          target="_blank"
                          className="px-2 py-1 bg-pink-100 text-pink-700 rounded-full"
                        >
                          Instagram Post
                        </a>
                      )}

                      {!isPermanentMissed && !isYes(me?.["FB Like"]) && post["FB Link"] && (
                        <a
                          href={post["FB Link"]}
                          target="_blank"
                          className="px-2 py-1 bg-blue-100 text-blue-700 rounded-full"
                        >
                          Facebook Post
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Block({ title, data, color, limit = false }: any) {
  const colorMap: any = {
    green: "bg-green-100 text-green-700",
    blue: "bg-blue-100 text-blue-700",
    indigo: "bg-indigo-100 text-indigo-700",
    red: "bg-red-100 text-red-700"
  };

  // duplicate employees remove
const uniqueData = Array.from(
  new Map(
    data.map((d: any) => [`${d.employee_id}`, d])
  ).values()
);

  const display = limit ? uniqueData.slice(0, 4) : uniqueData;

  return (
    <div>
      <p className="text-[10px] font-medium mb-1">
        {title} ({uniqueData.length})
      </p>

      <div className="flex flex-wrap gap-1">
        {display.map((d: any, i: number) => (
          <span key={i} className={`px-2 py-1 rounded-full text-[10px] ${colorMap[color]}`}>
            {d.Employee}
          </span>
        ))}

        {limit && uniqueData.length > 4 && (
          <span className="text-[10px] text-gray-400">+{uniqueData.length - 4}</span>
        )}
      </div>
    </div>
  );
}