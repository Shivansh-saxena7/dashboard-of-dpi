// @ts-nocheck

// Shared CORS headers for V2 Edge Functions called directly from the
// browser (start-shift, assign-lead, and future ones like
// recycle-stale-leads/check-sla-breach). One definition, imported
// everywhere — same single-owner principle as everything else in
// this project, instead of each function redefining its own headers.
//
// Every function using this must also:
//   1. Return corsHeaders on the OPTIONS preflight request, before
//      doing any other work.
//   2. Include corsHeaders on every Response it returns, success or
//      error — the browser checks the actual response too, not just
//      the preflight.
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
