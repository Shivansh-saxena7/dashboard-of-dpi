import { getUniquePosts } from "./getUniquePosts";
import { calculatePerformance } from "./calculatePerformance";
import { calculateMissed } from "./calculateMissed";

export function calculateStats(data:any[]){

const uniquePosts =
getUniquePosts(data);

const totalAssigned =
uniquePosts.length;

const completed =
uniquePosts.filter((post:any)=>

String(post["IG Like"]).toUpperCase()==="YES"

&&

String(post["FB Like"]).toUpperCase()==="YES"

).length;

const pending =
calculateMissed(uniquePosts);

const permanent =
uniquePosts.filter(
(post:any)=>
post.permanent_missed===true
).length;

const performance =
calculatePerformance(
completed,
totalAssigned
);

return{

totalAssigned,
completed,
pending,
permanent,
performance

};

}