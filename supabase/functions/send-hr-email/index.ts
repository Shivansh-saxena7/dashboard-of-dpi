// @ts-nocheck

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.0";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { encode as encodeBase64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { resolveCallingEmployeeId } from "../_shared/auth.ts";

// HRMS Phase 4 (2026-09-25) — emails an ALREADY-GENERATED Offer/
// Appointment letter to the candidate, with the exact stored PDF
// attached. Never regenerates the letter — documentId points at the
// same hr_documents row (and same storage_path) the "Generate"/
// "Download" buttons on app/hr/candidates/page.tsx already use, so
// there is one single source of truth for "what letter did this
// candidate actually get," same principle as the rest of this module.
//
// Deno-native SMTP (denomailer) — nodemailer cannot run in an Edge
// Function (no Node net/tls). Fixed subject/body template with an
// auto-appended signature block — HR never types the signature by
// hand, same "template, not free text" posture the letter templates
// themselves already have.
//
// Caller must be role hr or admin — checked here server-side (mirrors
// retry-lead-distribution's admin-only gate, and the exact role check
// app/hr/layout.tsx already uses to gate the whole /hr section). The
// SENDING employee's identity comes from resolveCallingEmployeeId's
// verified-JWT resolution, never a client-supplied id — same reason
// assign-lead never trusts a body-supplied employee id.

const SMTP_HOST = "smtp.hostinger.com";
const SMTP_PORT = 465;
const SMTP_USERNAME = "hr@divyapadma.com";

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  OFFER_LETTER: "Offer Letter",
  APPOINTMENT_LETTER: "Appointment Letter"
};

function respond(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

// Fixed, auto-appended — HR never types this by hand, per the approved
// plan. Any future change to company contact details only needs to
// change it here, not in every HR person's head.
function buildSignature(senderName: string) {
  return [
    "",
    "",
    "Regards,",
    senderName,
    "HR, Divya Padma Infosystem LLP",
    "Email: hr@divyapadma.com",
    "Phone: 9220907342",
    "Website: divyapadma.com",
    "Address: F-417, 4th Floor, Artha Mart, Techzone IV, Greater Noida West"
  ].join("\n");
}

serve(async (req) => {

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const auth = await resolveCallingEmployeeId(req, supabase, corsHeaders);
    if (auth.errorResponse) return auth.errorResponse;

    const { data: callerEmployee, error: callerEmployeeError } = await supabase
      .from("employees")
      .select("name, role")
      .eq("id", auth.employeeId)
      .single();

    if (callerEmployeeError || !callerEmployee) {
      return respond({ success: false, message: "Employee record not found" }, 404);
    }

    if (callerEmployee.role !== "hr" && callerEmployee.role !== "admin") {
      return respond({ success: false, message: "Only HR or Admin can send this email" }, 403);
    }

    const { documentId } = await req.json();

    if (!documentId) {
      return respond({ success: false, message: "documentId is required" }, 400);
    }

    const { data: doc, error: docError } = await supabase
      .from("hr_documents")
      .select("id, document_type, storage_path, candidate_id")
      .eq("id", documentId)
      .single();

    if (docError || !doc) {
      return respond({ success: false, message: "Document not found" }, 404);
    }

    // Only these two document types ever have a "Send Email" button in
    // the UI — enforced here too so a direct/replayed call can't email
    // out an arbitrary uploaded document (e.g. an ID proof upload).
    if (doc.document_type !== "OFFER_LETTER" && doc.document_type !== "APPOINTMENT_LETTER") {
      return respond({ success: false, message: "Only Offer/Appointment letters can be emailed" }, 400);
    }

    if (!doc.candidate_id) {
      return respond({ success: false, message: "This document isn't linked to a candidate" }, 400);
    }

    const { data: candidate, error: candidateError } = await supabase
      .from("candidates")
      .select("id, name, email")
      .eq("id", doc.candidate_id)
      .single();

    if (candidateError || !candidate) {
      return respond({ success: false, message: "Candidate not found" }, 404);
    }

    if (!candidate.email || !candidate.email.trim()) {
      return respond({ success: false, message: "This candidate has no email on file" }, 400);
    }

    const { data: fileBlob, error: downloadError } = await supabase.storage
      .from("hr-documents")
      .download(doc.storage_path);

    if (downloadError || !fileBlob) {
      return respond(
        { success: false, message: downloadError?.message || "Could not load the letter PDF" },
        500
      );
    }

    // A byte-by-byte String.fromCharCode loop here (the original
    // version of this line) is what caused "Function failed due to
    // not having enough compute resources" on real letterhead PDFs
    // (~11MB, since the letterhead image was embedded as PNG — see
    // lib/generateHrDocumentPdf.ts's JPEG conversion, added the same
    // day, for the actual fix to file size). encodeBase64 does the
    // conversion natively instead of a multi-million-iteration
    // synchronous JS loop.
    const base64Content = encodeBase64(await fileBlob.arrayBuffer());

    const smtpPassword = Deno.env.get("HR_SMTP_PASSWORD");

    if (!smtpPassword) {
      return respond(
        { success: false, message: "SMTP is not configured (HR_SMTP_PASSWORD secret missing)" },
        500
      );
    }

    const letterLabel = DOCUMENT_TYPE_LABELS[doc.document_type];
    const senderName = callerEmployee.name || "HR Team";

    const body =
      `Dear ${candidate.name || "Candidate"},\n\n` +
      `Please find your ${letterLabel} attached with this email.\n\n` +
      `Feel free to reach out if you have any questions.` +
      buildSignature(senderName);

    const client = new SMTPClient({
      connection: {
        hostname: SMTP_HOST,
        port: SMTP_PORT,
        tls: true,
        auth: {
          username: SMTP_USERNAME,
          password: smtpPassword
        }
      }
    });

    try {
      await client.send({
        from: `Divya Padma Infosystem LLP <${SMTP_USERNAME}>`,
        to: candidate.email.trim(),
        subject: `Your ${letterLabel} — Divya Padma Infosystem LLP`,
        content: body,
        attachments: [
          {
            filename: `${letterLabel.replace(/\s+/g, "_")}.pdf`,
            content: base64Content,
            encoding: "base64",
            contentType: "application/pdf"
          }
        ]
      });
    } finally {
      // Always close, even if send() throws — an open SMTP connection
      // left dangling on error would otherwise leak across invocations.
      await client.close();
    }

    // Best-effort — the email already sent successfully above; a
    // failure to record the timestamp only means the UI won't show a
    // "Sent on ..." tag, not that the send itself failed.
    const { error: markSentError } = await supabase
      .from("hr_documents")
      .update({ emailed_at: new Date().toISOString() })
      .eq("id", documentId);

    if (markSentError) {
      console.error("send-hr-email: emailed_at update failed:", markSentError.message);
    }

    return respond({ success: true });

  } catch (err) {

    console.error("send-hr-email: unhandled error:", err.message, err.stack);

    return respond({ success: false, error: err.message }, 500);

  }
});
