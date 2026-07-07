export function calculateMissed(data:any[]){

const now = new Date();

return data.filter((post:any)=>{

const igDone =

String(
post["IG Like"] || ""
)
.trim()
.toUpperCase()

===

"YES";

const fbDone =

String(
post["FB Like"] || ""
)
.trim()
.toUpperCase()

===

"YES";

const completed =
igDone && fbDone;

const postDate =
new Date(post.Date);

const deadline =
new Date(postDate);

deadline.setHours(
23,
0,
0,
0
);

return (

!completed
&&
now < deadline

);

}).length;

}