import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin=createClient(

process.env.NEXT_PUBLIC_SUPABASE_URL!,

process.env.SUPABASE_SERVICE_ROLE_KEY!

);

export async function POST(req:Request){

try{

const body=await req.json();

const {
name,
email,
password,
role
}=body;


if(
!name||
!email||
!password||
!role
){

return NextResponse.json(

{
success:false,
message:"All fields required"
},

{
status:400
}

);

}



const {
data:userData,
error:authError
}

=
await supabaseAdmin.auth.admin.createUser({

email,
password,
email_confirm:true

});


if(authError){

return NextResponse.json(

{
success:false,
message:authError.message
},

{
status:400
}

);

}



if(!userData || !userData.user || !userData.user.id){

return NextResponse.json(

{
success:false,
message:"Auth account creation failed unexpectedly - no user ID returned."
},

{
status:500
}

);

}

const authUserId=
userData.user.id;
console.log("AUTH ERROR:", authError);
console.log("USER DATA:", JSON.stringify(userData));



const {
error:employeeError
}
=
await supabaseAdmin
.from("employees")
.insert([{

name,
email,
role,
auth_user_id:authUserId

}]);


if(employeeError){

return NextResponse.json(

{
success:false,
message:employeeError.message
},

{
status:400
}

);

}


return NextResponse.json({

success:true,
message:"Employee created"

});


}catch(error:any){

return NextResponse.json(

{

success:false,
message:error.message

},

{
status:500
}

);

}

}