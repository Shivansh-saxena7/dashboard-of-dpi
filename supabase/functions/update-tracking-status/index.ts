// @ts-nocheck

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.0";

serve(async (req) => {
  try {

    const { id, platform } = await req.json();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: row, error } = await supabase
      .from("tracking")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !row) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Tracking row not found"
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 404
        }
      );
    }

    const updateData: any = {};

    if (platform === "ig") {
      updateData.ig_done = true;
      updateData["IG Like"] = "YES";
    }

    if (platform === "fb") {
      updateData.fb_done = true;
      updateData["FB Like"] = "YES";
    }

    await supabase
      .from("tracking")
      .update(updateData)
      .eq("id", id);

    const { data: latest } = await supabase
      .from("tracking")
      .select("*")
      .eq("id", id)
      .single();

    if (latest.ig_done && latest.fb_done) {

      await supabase
        .from("tracking")
        .update({
          done: true,
          permanent_missed: false
        })
        .eq("id", id);

    }

    return new Response(
      JSON.stringify({
        success: true
      }),
      {
        headers: {
          "Content-Type": "application/json"
        }
      }
    );

  } catch (err) {

    return new Response(
      JSON.stringify({
        success: false,
        error: err.message
      }),
      {
        headers: {
          "Content-Type": "application/json"
        },
        status: 500
      }
    );

  }
});