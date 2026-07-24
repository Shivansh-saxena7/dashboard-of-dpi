// @ts-nocheck

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async () => {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const now = new Date();

    // TEMP TESTING
    // normally 11 PM check hota
    // abhi disable kar diya
    const hour = now.getHours();

    if (hour < 23) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Not 11 PM yet",
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    const today = now.toISOString().split("T")[0];

    //console.log("TODAY:", today);

    // sab rows lao
    const { data, error } = await supabase
      .from("tracking")
      .select("*")
      .eq("date", today);

    if (error) {
      return new Response(
        JSON.stringify({
          step: "FETCH_ERROR",
          error: error.message,
        }),
        {
          headers: { "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    //console.log("TOTAL ROWS:", data?.length || 0);

    let updatedCount = 0;

    for (const row of data || []) {
      //console.log("CHECKING ROW:", row);

      // agar done nahi hai
      if (
  row.done === false ||
  row.done === null ||
  String(row.done).toLowerCase() === "false"
) {
        //console.log("MARKING MISSED:", row.id);

        const { error: updateError } = await supabase
          .from("tracking")
          .update({
            permanent_missed: true,
          })
          .eq("id", row.id);

        if (updateError) {
          return new Response(
            JSON.stringify({
              step: "UPDATE_ERROR",
              row,
              error: updateError.message,
            }),
            {
              headers: { "Content-Type": "application/json" },
              status: 500,
            }
          );
        }

        updatedCount++;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        totalRows: data?.length || 0,
        updatedCount,
        message: "Permanent missed updated successfully",
      }),
      {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        step: "MAIN_CATCH",
        error: error.message,
      }),
      {
        headers: { "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});