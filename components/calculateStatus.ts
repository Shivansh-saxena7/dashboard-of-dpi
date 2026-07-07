export function calculateStatus(post:any){

const now=new Date();

const postDate=new Date(post.Date);

const sixThirty=new Date(postDate);

sixThirty.setHours(
18,
30,
0,
0
);

const elevenPM=new Date(postDate);

elevenPM.setHours(
23,
0,
0,
0
);

const igDone=

String(post["IG Like"]||"")
.trim()
.toUpperCase()

===

"YES";


const fbDone=

String(post["FB Like"]||"")
.trim()
.toUpperCase()

===

"YES";


const completed=

igDone && fbDone;


if(completed){

return "COMPLETED";

}


if(

!completed
&&
now>=elevenPM

){

return "PERMANENT";

}


if(

!completed
&&
now>=sixThirty

){

return "MISSED";

}


return "ASSIGNED";

}