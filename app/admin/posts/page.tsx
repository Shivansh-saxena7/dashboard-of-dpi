"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { supabase } from "@/lib/supabase";
import PostSuccessModal from "../components/PostSuccessModal";
export default function PostsPage() {

    const [postNumber, setPostNumber] = useState("");
    const [date, setDate] = useState("");
    const [igLink, setIgLink] = useState("");
    const [fbLink, setFbLink] = useState("");
    const [loading, setLoading] = useState(false);
    const [successOpen, setSuccessOpen] = useState(false);

    const createPost = async () => {

        try {

            setLoading(true);


            /* CREATE POST */

            const {

                data: postData,
                error: postError

            }

                =

                await supabase
                    .from("posts")
                    .insert([{

                        post_number: Number(postNumber),
                        date,
                        ig_link: igLink,
                        fb_link: fbLink,

                    }])

                    .select()
                    .single();


            if (postError) {

                alert(postError.message);

                return;

            }



            /* GET EMPLOYEES */

          

const {
  data: employees,
  error: employeeError
} =
await supabase
  .from("employees")
  .select("id,name")
  .eq("is_active", true);
  
const {

data: templates,
error: templateError

}

=

await supabase
.from("notifications_templates")
.select("*")
.eq("is_active", true);
//console.log("TEMPLATE ERROR", templateError);
//console.log("TEMPLATES", templates);


if(templateError){

alert(templateError.message);

return;

}
if (!templates || templates.length === 0) {

alert("No notification templates found");

return;

}


const randomTemplate =

templates[
Math.floor(
Math.random() * templates.length
)
];

//console.log("TEMPLATES");
//console.log(templates);

//console.log("RANDOM TEMPLATE");
//console.log(randomTemplate);


            if (employeeError) {

                alert(employeeError.message);

                return;

            }



            /* CREATE TRACKING RECORDS */

            const trackingRows =

                employees.map((employee) => ({

                    employee_id:
                        employee.id,

                    post_id:
                        postData.id,

                    ig_done: false,

                    fb_done: false,

                    done: false,

                    permanent_missed: false,

                    date

                }));


                const notificationRows =

employees.map((employee) => ({

employee_id:
employee.id,

employee_name:
employee.name,

post_id:
postData.id,

title:
randomTemplate.title,

message:
`${randomTemplate.message}

📌 Post #${postNumber} assigned.`,

type:
"POST_ASSIGNED",

is_read:
false

}));

            /* INSERT TRACKING */

            const {

                error: trackingError

            }

                =

                await supabase
                    .from("tracking")
                    .insert(
                        trackingRows
                    );


            if (trackingError) {

                alert(
                    trackingError.message
                );

                return;

            }
            //console.log("POST DATA");
//console.log(postData);



            const {
                

error: notificationError

}

=

await supabase
.from("notification")
.insert(
notificationRows
);


if(notificationError){

alert(
notificationError.message
);

return;

}


            setSuccessOpen(true);





            /* RESET */

            setPostNumber("");

            setDate("");

            setIgLink("");

            setFbLink("");

        } catch (err) {

            //console.log(err);

            alert(
                "Something went wrong"
            );

        } finally {

            setLoading(false);

        }

    };


    return (
  <>  
<PostSuccessModal
open={successOpen}
setOpen={setSuccessOpen}
/>
<div className="space-y-5">

<motion.div

initial={{
opacity:0,
y:-20
}}

animate={{
opacity:1,
y:0
}}

className="
relative
overflow-hidden
rounded-[24px]
bg-gradient-to-br
from-[#0f172a]
via-[#1d4ed8]
to-[#06b6d4]
p-5
md:p-7
text-white
shadow-[0_15px_50px_rgba(37,99,235,0.2)]
"

>

<div className="
absolute
top-[-60px]
right-[-60px]
w-[150px]
h-[150px]
rounded-full
bg-white/10
blur-3xl
"/>

<h1 className="
text-2xl
md:text-4xl
font-bold
">

Posts Management

</h1>

<p className="
mt-2
text-white/80
text-xs
md:text-sm
">

Create and auto assign posts to all employees

</p>

</motion.div>



<div className="
grid
grid-cols-1
lg:grid-cols-[2fr_280px]
gap-5
">


<motion.div

initial={{
opacity:0,
y:20
}}

animate={{
opacity:1,
y:0
}}

className="
bg-white
rounded-[24px]
border
border-slate-100
shadow-md
p-5
"

>

<h2 className="
text-xl
font-bold
text-slate-800
mb-5
">

Create New Post

</h2>


<div className="space-y-4">

<input
type="number"
placeholder="Post Number"
value={postNumber}
onChange={(e)=>setPostNumber(e.target.value)}
className="
w-full
h-12
rounded-xl
bg-slate-50
border
border-slate-200
px-4
outline-none
focus:ring-2
focus:ring-cyan-300
"
/>


<input
type="date"
value={date}
onChange={(e)=>setDate(e.target.value)}
className="
w-full
h-12
rounded-xl
bg-slate-50
border
border-slate-200
px-4
outline-none
focus:ring-2
focus:ring-cyan-300
"
/>



<input
type="text"
placeholder="Instagram Link"
value={igLink}
onChange={(e)=>setIgLink(e.target.value)}
className="
w-full
h-12
rounded-xl
bg-slate-50
border
border-slate-200
px-4
outline-none
focus:ring-2
focus:ring-cyan-300
"
/>



<input
type="text"
placeholder="Facebook Link"
value={fbLink}
onChange={(e)=>setFbLink(e.target.value)}
className="
w-full
h-12
rounded-xl
bg-slate-50
border
border-slate-200
px-4
outline-none
focus:ring-2
focus:ring-cyan-300
"
/>


<button

onClick={createPost}
disabled={loading}

className="
w-full
h-12
rounded-xl
font-semibold
text-white
bg-gradient-to-r
from-blue-600
to-cyan-500
hover:scale-[1.02]
transition-all
"

>

{

loading
?
"Creating..."
:
"Create Post"

}

</button>

</div>

</motion.div>



<div className="space-y-4">

<div className="
rounded-[24px]
bg-gradient-to-br
from-cyan-50
to-blue-100
p-5
shadow-sm
">

<p className="
text-slate-500
text-sm
">

Assignment Mode

</p>

<h1 className="
text-xl
font-bold
mt-2
">

Auto Assign

</h1>

<p className="
text-slate-500
text-sm
">

All employees receive posts automatically

</p>

</div>



<div className="
rounded-[24px]
bg-gradient-to-br
from-slate-900
to-slate-700
text-white
p-5
shadow-md
">

<h2 className="
font-bold
">

Tracking Status

</h2>

<p className="
mt-2
text-sm
text-white/70
">

Tracking records auto-generated

</p>

</div>

</div>

</div>

</div>
</>

);

}