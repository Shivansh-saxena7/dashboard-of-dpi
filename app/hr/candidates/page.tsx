"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import { Plus, ChevronDown, X, FileText, UserCheck, Download, FileSpreadsheet, Trash2, Check, Phone, Mail, Briefcase, Users, FileUp, Send } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { buildHrDocumentBlob, LetterheadImage } from "@/lib/generateHrDocumentPdf";
import { exportCandidatesToExcel, exportCandidatesToPDF, CandidateExportRow } from "@/lib/exportCandidateReport";
import DeleteModal from "../../admin/components/DeleteModal";

// Candidate / Interview / Offer-Appointment flow (2026-09-24) — the
// real replacement for the old theoretical "Interview Tracking"
// placeholder (see HRMS_MASTER_PLAN.md §4.2). Reuses the existing
// Document Management pipeline end-to-end for both letters (same
// hr_document_templates/register_hr_document_atomic path
// app/hr/documents/page.tsx already uses, just against candidate_id
// instead of employee_id) — no parallel document system.

const STATUS_OPTIONS = ["APPLIED", "INTERVIEWING", "SELECTED", "ON_HOLD", "OFFER_SENT", "APPOINTMENT_PENDING", "CONVERTED", "REJECTED"];

// Redesign (2026-09-24, real-HR-usability feedback) — one combined
// map per status (label/badge/dot) instead of two parallel ones that
// had drifted apart in color meaning (INTERVIEWING was blue, OFFER_SENT
// was amber -- neither matched the plain-English colors real HR
// expects: yellow while interviewing, green once selected, red once
// rejected, blue once actually on payroll).
const STATUS_META: Record<string, { label: string; badge: string; dot: string }> = {
  APPLIED: { label: "Applied", badge: "bg-slate-100 text-slate-600", dot: "bg-slate-400" },
  INTERVIEWING: { label: "Interviewing", badge: "bg-amber-100 text-amber-700", dot: "bg-amber-500" },
  SELECTED: { label: "Selected", badge: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-500" },
  ON_HOLD: { label: "On Hold", badge: "bg-orange-100 text-orange-700", dot: "bg-orange-500" },
  OFFER_SENT: { label: "Offer Sent", badge: "bg-sky-100 text-sky-700", dot: "bg-sky-500" },
  APPOINTMENT_PENDING: { label: "Appointment Pending", badge: "bg-violet-100 text-violet-700", dot: "bg-violet-500" },
  CONVERTED: { label: "Converted", badge: "bg-blue-100 text-blue-700", dot: "bg-blue-500" },
  REJECTED: { label: "Rejected", badge: "bg-red-100 text-red-600", dot: "bg-red-500" }
};

const STATUS_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(STATUS_META).map(([k, v]) => [k, v.label])
);

// Step-by-step progress, real-HR-usability redesign (2026-09-24) --
// replaces a flat status badge as the only progress signal with a
// visible stepper so it's obvious at a glance where a candidate is in
// the pipeline and what's locked until they get there. Purely a
// presentation-layer derivation of candidate.status (the actual
// source of truth, kept in sync server-side by set_interview_result_
// atomic/the generate-document flow/convert_candidate_to_employee_
// atomic) -- never written back to, never a second source of truth.
const STEP_DEFS = [
  { key: "application", label: "Application" },
  { key: "interview", label: "Interview" },
  { key: "decision", label: "Decision" },
  { key: "offer", label: "Offer Letter" },
  { key: "appointment", label: "Appointment" },
  { key: "employee", label: "Employee" }
] as const;

type StepKey = (typeof STEP_DEFS)[number]["key"];
type StepState = "done" | "current" | "hold" | "upcoming";

// Returns null for REJECTED -- rendered as its own terminal banner
// instead of a stepper, since "which step were they on when rejected"
// isn't a meaningful thing to show as still-in-progress.
function getStepStates(status: string): Record<StepKey, StepState> | null {
  const base: Record<StepKey, StepState> = {
    application: "upcoming",
    interview: "upcoming",
    decision: "upcoming",
    offer: "upcoming",
    appointment: "upcoming",
    employee: "upcoming"
  };
  switch (status) {
    case "APPLIED":
      return { ...base, application: "done", interview: "current" };
    case "INTERVIEWING":
      return { ...base, application: "done", interview: "done", decision: "current" };
    case "ON_HOLD":
      return { ...base, application: "done", interview: "done", decision: "hold" };
    case "SELECTED":
      return { ...base, application: "done", interview: "done", decision: "done", offer: "current" };
    case "OFFER_SENT":
      return { ...base, application: "done", interview: "done", decision: "done", offer: "done", appointment: "current" };
    case "APPOINTMENT_PENDING":
      return { ...base, application: "done", interview: "done", decision: "done", offer: "done", appointment: "done", employee: "current" };
    case "CONVERTED":
      return { ...base, application: "done", interview: "done", decision: "done", offer: "done", appointment: "done", employee: "done" };
    default:
      return null;
  }
}

const RESULT_BUTTON_ACTIVE: Record<string, string> = {
  PENDING: "bg-slate-700 border-slate-700 text-white",
  SELECTED: "bg-emerald-600 border-emerald-600 text-white",
  REJECTED: "bg-red-600 border-red-600 text-white",
  ON_HOLD: "bg-orange-500 border-orange-500 text-white"
};

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  APPLICATION_FORM: "Application Form",
  OFFER_LETTER: "Offer Letter",
  APPOINTMENT_LETTER: "Appointment Letter"
};

// Primary-vs-secondary action redesign (2026-09-24, real-HR-usability
// feedback round 2) — "Log Interview" and the Offer/Appointment Letter
// buttons were previously always styled as equally-prominent primary
// buttons regardless of stage, which reads as "all of these are the
// thing to do right now" even once most of them are either done or
// not yet relevant. This derives the single action that's actually
// the next real step for a candidate's CURRENT status, so the JSX can
// style that one loud and demote everything else to a quiet secondary
// link -- never hide the others entirely (a second interview round,
// or regenerating an already-sent letter, are still real, occasional
// needs), just stop competing with what genuinely matters right now.
// Returns null for INTERVIEWING/ON_HOLD -- there the interview
// card's own Result buttons already ARE the actionable thing, and for
// CONVERTED/REJECTED, where nothing is actionable anymore.
function getPrimaryAction(status: string): "interview" | "offer" | "appointment" | "convert" | null {
  switch (status) {
    case "APPLIED":
      return "interview";
    case "SELECTED":
      return "offer";
    case "OFFER_SENT":
      return "appointment";
    case "APPOINTMENT_PENDING":
      return "convert";
    default:
      return null;
  }
}

const PRIMARY_BUTTON_CLASS =
  "h-10 px-4 rounded-xl font-bold text-white text-xs flex items-center gap-2 shadow-sm hover:opacity-90 transition";
const SECONDARY_BUTTON_CLASS = "h-8 px-2.5 rounded-lg text-[11px] font-semibold text-slate-400 hover:text-slate-600 transition flex items-center gap-1";

// Offer Letter is only generatable once at least one interview round
// has genuinely concluded with a positive result -- gate lives on
// candidate.status (kept in sync server-side by
// set_interview_result_atomic), not on scanning interview rows
// client-side, since that RPC is the single source of truth for when
// the status is allowed to move.
const OFFER_ELIGIBLE_STATUSES = ["SELECTED", "OFFER_SENT", "APPOINTMENT_PENDING"];

const INTERVIEW_RESULT_OPTIONS = ["PENDING", "SELECTED", "REJECTED", "ON_HOLD"];
const INTERVIEW_RESULT_LABELS: Record<string, string> = {
  PENDING: "Pending",
  SELECTED: "Selected",
  REJECTED: "Rejected",
  ON_HOLD: "On Hold"
};

// Deliberately its own small map, NOT app/hr/documents/page.tsx's
// AUTO_PLACEHOLDER_LABELS (department/role there) -- a candidate has
// neither of those, and treating them as "auto" here would silently
// substitute an empty string instead of prompting HR to fill them in.
// Only what resolveAutoValueForCandidate below can actually resolve
// belongs in this set.
const CANDIDATE_AUTO_PLACEHOLDER_LABELS: Record<string, string> = {
  employee_name: "Candidate Name",
  email: "Email",
  today_date: "Today's Date"
};

function resolveAutoValueForCandidate(key: string, candidate: CandidateRow): string | null {
  switch (key) {
    case "employee_name":
      return candidate.name;
    case "email":
      return candidate.email || "";
    case "today_date":
      return new Date().toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" });
    default:
      return null;
  }
}

function detectPlaceholders(body: string): { auto: string[]; manual: string[] } {
  const found = new Set<string>();
  const regex = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  let match;
  while ((match = regex.exec(body)) !== null) {
    found.add(match[1]);
  }
  const auto: string[] = [];
  const manual: string[] = [];
  for (const key of found) {
    if (key in CANDIDATE_AUTO_PLACEHOLDER_LABELS) auto.push(key);
    else manual.push(key);
  }
  return { auto, manual };
}

interface CandidateRow {
  id: string;
  name: string;
  mobile: string;
  email: string | null;
  position_applied_for: string;
  notes: string | null;
  status: string;
  converted_employee_id: string | null;
  created_at: string;
}

interface InterviewRow {
  id: string;
  candidate_id: string;
  interviewer_employee_id: string;
  designation: string;
  interview_date: string;
  notes: string | null;
  result: string;
  created_at: string;
  interviewer: { name: string } | null;
}

interface TemplateRow {
  id: string;
  title: string;
  body: string;
  letterhead_storage_path: string | null;
}

interface CandidateDocumentRow {
  id: string;
  candidate_id: string;
  document_type: string;
  label: string;
  storage_path: string;
  is_generated: boolean;
  created_at: string;
  emailed_at: string | null;
}

interface EmployeeOption {
  id: string;
  name: string;
}

// Horizontal 6-step progress bar (2026-09-24). Wraps to two rows via
// flex-wrap on narrow screens rather than needing a separate mobile
// layout -- 6 compact steps fit fine either way.
function CandidateStepper({ status }: { status: string }) {
  if (status === "REJECTED") {
    return (
      <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-red-50 border border-red-100">
        <span className="h-6 w-6 rounded-full bg-red-500 text-white flex items-center justify-center shrink-0">
          <X size={13} />
        </span>
        <span className="text-xs font-bold text-red-600">Process ended — candidate rejected</span>
      </div>
    );
  }

  const states = getStepStates(status);
  if (!states) return null;

  return (
    <div className="flex items-start flex-wrap gap-y-3">
      {STEP_DEFS.map((step, i) => {
        const state = states[step.key];
        const circleClass =
          state === "done"
            ? "bg-emerald-500 border-emerald-500 text-white"
            : state === "current"
            ? "bg-white border-blue-500 text-blue-600"
            : state === "hold"
            ? "bg-white border-orange-400 text-orange-500"
            : "bg-white border-slate-200 text-slate-300";
        const labelClass =
          state === "done"
            ? "text-emerald-600"
            : state === "current"
            ? "text-blue-600"
            : state === "hold"
            ? "text-orange-500"
            : "text-slate-300";

        return (
          <div key={step.key} className="flex items-start">
            <div className="flex flex-col items-center gap-1 w-[78px] sm:w-[92px]">
              <div className={`h-7 w-7 rounded-full flex items-center justify-center text-[11px] font-bold border-2 shrink-0 ${circleClass}`}>
                {state === "done" ? <Check size={13} /> : i + 1}
              </div>
              <span className={`text-[10px] font-bold text-center leading-tight ${labelClass}`}>{step.label}</span>
            </div>
            {i < STEP_DEFS.length - 1 && (
              <div className={`h-0.5 w-4 sm:w-8 mt-3.5 shrink-0 ${state === "done" ? "bg-emerald-400" : "bg-slate-200"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function HrCandidatesPage() {
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [interviews, setInterviews] = useState<InterviewRow[]>([]);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [documents, setDocuments] = useState<CandidateDocumentRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [myEmployeeId, setMyEmployeeId] = useState("");
  // Delete restricted to Admin (2026-09-24) — same defense-in-depth
  // pattern already used on app/hr/documents/page.tsx's Delete
  // buttons: RLS is the real enforcement (delete_candidate_atomic
  // itself is admin-gated), this just keeps HR from seeing a button
  // that would fail server-side.
  const [myRole, setMyRole] = useState("");

  const [statusFilter, setStatusFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CandidateRow | null>(null);
  const [deletingCandidate, setDeletingCandidate] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addMobile, setAddMobile] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [addPosition, setAddPosition] = useState("");
  const [addNotes, setAddNotes] = useState("");
  const [adding, setAdding] = useState(false);

  const [interviewOpenFor, setInterviewOpenFor] = useState<string | null>(null);
  const [interviewerId, setInterviewerId] = useState("");
  const [interviewDesignation, setInterviewDesignation] = useState("");
  const [interviewDate, setInterviewDate] = useState("");
  const [interviewNotes, setInterviewNotes] = useState("");
  const [loggingInterview, setLoggingInterview] = useState(false);
  const [settingResultFor, setSettingResultFor] = useState<string | null>(null);

  const [applicationFormFile, setApplicationFormFile] = useState<File | null>(null);
  const [uploadingApplicationFormFor, setUploadingApplicationFormFor] = useState<string | null>(null);
  // Collapsed-by-default (2026-09-24) -- uploading the Application
  // Form is a real but supporting/administrative task, never the
  // actual next step at any pipeline stage, so it stays a quiet
  // secondary link rather than an always-visible dashed box competing
  // with whatever genuinely is the primary action right now.
  const [uploadFormOpenFor, setUploadFormOpenFor] = useState<string | null>(null);

  const [generateOpenFor, setGenerateOpenFor] = useState<{ candidateId: string; documentType: "OFFER_LETTER" | "APPOINTMENT_LETTER" } | null>(null);
  const [generateManualValues, setGenerateManualValues] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState(false);

  const [sendingEmailFor, setSendingEmailFor] = useState<string | null>(null);

  const [convertOpenFor, setConvertOpenFor] = useState<string | null>(null);
  const [convertEmail, setConvertEmail] = useState("");
  const [convertPassword, setConvertPassword] = useState("");
  const [convertRole, setConvertRole] = useState("employee");
  const [convertDepartment, setConvertDepartment] = useState("sales");
  const [converting, setConverting] = useState(false);

  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    loadAll();
    loadSelf();
  }, []);

  async function loadSelf() {
    const {
      data: { user }
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.from("employees").select("id, role").eq("auth_user_id", user.id).single();
    if (data) {
      setMyEmployeeId(data.id);
      setMyRole(data.role);
    }
  }

  async function loadAll() {
    setLoading(true);

    const [{ data: candidatesData }, { data: interviewsData }, { data: templatesData }, { data: documentsData }, { data: employeesData }] =
      await Promise.all([
        supabase.from("candidates").select("*").order("created_at", { ascending: false }),
        supabase
          .from("candidate_interviews")
          .select("*, interviewer:employees!candidate_interviews_interviewer_employee_id_fkey(name)")
          .order("interview_date", { ascending: false }),
        supabase.from("hr_document_templates").select("id, title, body, letterhead_storage_path").in("title", ["Offer Letter", "Appointment Letter"]),
        supabase.from("hr_documents").select("id, candidate_id, document_type, label, storage_path, is_generated, created_at, emailed_at").not("candidate_id", "is", null).order("created_at", { ascending: false }),
        supabase.from("employees").select("id, name").eq("is_active", true).order("name")
      ]);

    setCandidates((candidatesData || []) as CandidateRow[]);
    setInterviews((interviewsData || []) as InterviewRow[]);
    setTemplates((templatesData || []) as TemplateRow[]);
    setDocuments((documentsData || []) as CandidateDocumentRow[]);
    setEmployees((employeesData || []) as EmployeeOption[]);
    setLoading(false);
  }

  const interviewsByCandidate = useMemo(() => {
    const map = new Map<string, InterviewRow[]>();
    interviews.forEach((i) => {
      if (!map.has(i.candidate_id)) map.set(i.candidate_id, []);
      map.get(i.candidate_id)!.push(i);
    });
    return map;
  }, [interviews]);

  const documentsByCandidate = useMemo(() => {
    const map = new Map<string, CandidateDocumentRow[]>();
    documents.forEach((d) => {
      if (!map.has(d.candidate_id)) map.set(d.candidate_id, []);
      map.get(d.candidate_id)!.push(d);
    });
    return map;
  }, [documents]);

  const visibleCandidates = useMemo(() => {
    return statusFilter ? candidates.filter((c) => c.status === statusFilter) : candidates;
  }, [candidates, statusFilter]);

  async function handleAddCandidate() {
    if (!addName.trim() || !addMobile.trim() || !addPosition.trim()) {
      toast.error("Name, mobile, and position applied for are required.");
      return;
    }
    if (!myEmployeeId) {
      toast.error("Could not identify your employee record.");
      return;
    }

    setAdding(true);
    const { error } = await supabase.from("candidates").insert({
      name: addName.trim(),
      mobile: addMobile.trim(),
      email: addEmail.trim() || null,
      position_applied_for: addPosition.trim(),
      notes: addNotes.trim() || null,
      created_by_employee_id: myEmployeeId
    });

    if (error) {
      toast.error(error.message || "Could not add candidate.");
    } else {
      toast.success("Candidate added.");
      setAddOpen(false);
      setAddName("");
      setAddMobile("");
      setAddEmail("");
      setAddPosition("");
      setAddNotes("");
      loadAll();
    }
    setAdding(false);
  }

  async function handleLogInterview(candidate: CandidateRow) {
    if (!interviewerId || !interviewDesignation.trim() || !interviewDate) {
      toast.error("Interviewer, designation, and date are required.");
      return;
    }
    if (!myEmployeeId) {
      toast.error("Could not identify your employee record.");
      return;
    }

    setLoggingInterview(true);
    const { error } = await supabase.from("candidate_interviews").insert({
      candidate_id: candidate.id,
      interviewer_employee_id: interviewerId,
      designation: interviewDesignation.trim(),
      interview_date: interviewDate,
      notes: interviewNotes.trim() || null,
      created_by_employee_id: myEmployeeId
    });

    if (error) {
      toast.error(error.message || "Could not log interview.");
      setLoggingInterview(false);
      return;
    }

    // First interview logged for a candidate still sitting at APPLIED
    // moves them along automatically -- a real interview genuinely
    // happening is exactly what "Interviewing" means. Never downgrades
    // a candidate already further along (Offer Sent etc.) if HR logs
    // an additional interview round later.
    if (candidate.status === "APPLIED") {
      await supabase.from("candidates").update({ status: "INTERVIEWING" }).eq("id", candidate.id);
    }

    toast.success("Interview logged.");
    setInterviewOpenFor(null);
    setInterviewerId("");
    setInterviewDesignation("");
    setInterviewDate("");
    setInterviewNotes("");
    setLoggingInterview(false);
    loadAll();
  }

  async function handleSetResult(interviewId: string, result: string) {
    setSettingResultFor(interviewId);
    const { error } = await supabase.rpc("set_interview_result_atomic", {
      p_interview_id: interviewId,
      p_result: result
    });
    if (error) {
      toast.error(error.message || "Could not set result.");
      setSettingResultFor(null);
      return;
    }
    toast.success("Interview result updated.");
    setSettingResultFor(null);
    loadAll();
  }

  async function handleUploadApplicationForm(candidate: CandidateRow) {
    if (!applicationFormFile) {
      toast.error("Choose a file first.");
      return;
    }

    setUploadingApplicationFormFor(candidate.id);
    try {
      const sanitizedName = applicationFormFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storagePath = `candidates/${candidate.id}/${crypto.randomUUID()}-${sanitizedName}`;

      const { error: uploadError } = await supabase.storage
        .from("hr-documents")
        .upload(storagePath, applicationFormFile, { contentType: applicationFormFile.type });

      if (uploadError) {
        toast.error(uploadError.message || "Upload failed.");
        return;
      }

      const { error: registerError } = await supabase.rpc("register_hr_document_atomic", {
        p_employee_id: null,
        p_document_type: "APPLICATION_FORM",
        p_label: `Application Form - ${candidate.name}`,
        p_storage_path: storagePath,
        p_file_mime_type: applicationFormFile.type,
        p_is_generated: false,
        p_candidate_id: candidate.id
      });

      if (registerError) {
        await supabase.storage.from("hr-documents").remove([storagePath]);
        toast.error(registerError.message || "Could not save document record.");
        return;
      }

      toast.success("Application Form uploaded.");
      setApplicationFormFile(null);
      setUploadFormOpenFor(null);
      loadAll();
    } finally {
      setUploadingApplicationFormFor(null);
    }
  }

  async function handleReject(candidate: CandidateRow) {
    const { error } = await supabase.from("candidates").update({ status: "REJECTED" }).eq("id", candidate.id);
    if (error) {
      toast.error(error.message || "Could not update status.");
      return;
    }
    toast.success("Candidate marked Rejected.");
    loadAll();
  }

  async function handleDeleteCandidate() {
    if (!deleteTarget) return;

    setDeletingCandidate(true);
    try {
      const { data: storagePaths, error } = await supabase.rpc("delete_candidate_atomic", {
        p_candidate_id: deleteTarget.id
      });

      if (error) {
        toast.error(error.message || "Could not delete candidate.");
        return;
      }

      // DB rows are already gone at this point (the RPC is what
      // actually deletes them) -- this just clears the now-orphaned
      // files out of the bucket. A failure here is logged but not
      // surfaced as the operation failing, since the candidate/
      // interviews/document-records are genuinely already deleted.
      if (Array.isArray(storagePaths) && storagePaths.length > 0) {
        const { error: storageError } = await supabase.storage.from("hr-documents").remove(storagePaths);
        if (storageError) {
          console.error("delete_candidate_atomic: storage cleanup failed:", storageError.message);
        }
      }

      toast.success("Candidate deleted.");
      setDeleteTarget(null);
      loadAll();
    } finally {
      setDeletingCandidate(false);
    }
  }

  const generateTemplate = generateOpenFor
    ? templates.find((t) => t.title === (generateOpenFor.documentType === "OFFER_LETTER" ? "Offer Letter" : "Appointment Letter")) || null
    : null;
  const generatePlaceholders = generateTemplate ? detectPlaceholders(generateTemplate.body) : { auto: [], manual: [] };

  async function handleGenerateDocument() {
    if (!generateOpenFor || !generateTemplate) return;
    const candidate = candidates.find((c) => c.id === generateOpenFor.candidateId);
    if (!candidate) return;

    for (const key of generatePlaceholders.manual) {
      if (!generateManualValues[key]?.trim()) {
        toast.error(`Fill in "${key}" before generating.`);
        return;
      }
    }

    setGenerating(true);
    try {
      const substituted = generateTemplate.body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
        const autoValue = resolveAutoValueForCandidate(key, candidate);
        if (autoValue !== null) return autoValue;
        return generateManualValues[key] || "";
      });

      let letterhead: LetterheadImage | undefined;
      if (generateTemplate.letterhead_storage_path) {
        const { data: signedData, error: signedError } = await supabase.storage
          .from("hr-documents")
          .createSignedUrl(generateTemplate.letterhead_storage_path, 60);

        if (signedError || !signedData) {
          toast.error(signedError?.message || "Could not load letterhead image.");
          setGenerating(false);
          return;
        }

        const imageRes = await fetch(signedData.signedUrl);
        const imageBlob = await imageRes.blob();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(imageBlob);
        });
        letterhead = { dataUrl };
      }

      const label = generateTemplate.title;
      const blob = await buildHrDocumentBlob(label, substituted, letterhead);
      const storagePath = `candidates/${candidate.id}/${crypto.randomUUID()}-generated.pdf`;

      const { error: uploadError } = await supabase.storage.from("hr-documents").upload(storagePath, blob, { contentType: "application/pdf" });
      if (uploadError) {
        toast.error(uploadError.message || "Upload failed.");
        setGenerating(false);
        return;
      }

      const { error: registerError } = await supabase.rpc("register_hr_document_atomic", {
        p_employee_id: null,
        p_document_type: generateOpenFor.documentType,
        p_label: label,
        p_storage_path: storagePath,
        p_file_mime_type: "application/pdf",
        p_is_generated: true,
        p_candidate_id: candidate.id
      });

      if (registerError) {
        await supabase.storage.from("hr-documents").remove([storagePath]);
        toast.error(registerError.message || "Could not save document record.");
        setGenerating(false);
        return;
      }

      // Status progression -- only ever moves forward, never
      // backward, so regenerating an earlier letter later doesn't
      // undo further progress.
      const currentIndex = STATUS_OPTIONS.indexOf(candidate.status);
      const targetStatus = generateOpenFor.documentType === "OFFER_LETTER" ? "OFFER_SENT" : "APPOINTMENT_PENDING";
      const targetIndex = STATUS_OPTIONS.indexOf(targetStatus);
      if (currentIndex < targetIndex && candidate.status !== "REJECTED") {
        await supabase.from("candidates").update({ status: targetStatus }).eq("id", candidate.id);
      }

      toast.success(`${label} generated.`);
      setGenerateOpenFor(null);
      setGenerateManualValues({});
      loadAll();
    } finally {
      setGenerating(false);
    }
  }

  async function handleDownloadDocument(doc: CandidateDocumentRow) {
    const { data, error } = await supabase.storage.from("hr-documents").createSignedUrl(doc.storage_path, 300);
    if (error || !data) {
      toast.error(error?.message || "Could not generate link.");
      return;
    }
    window.open(data.signedUrl, "_blank");
  }

  // Phase 4 (2026-09-25) -- emails the exact already-generated letter
  // PDF to the candidate, via the send-hr-email Edge Function. Same
  // "Authorization: Bearer <session.access_token>, identity resolved
  // server-side from the token" pattern retry-lead-distribution and
  // import-leads-csv already use, not a new one.
  async function handleSendEmail(doc: CandidateDocumentRow) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      toast.error("Your session has expired — please log in again.");
      return;
    }

    setSendingEmailFor(doc.id);
    try {
      const res = await fetch(
        "https://inmxkanrwcjlgajqpcuf.supabase.co/functions/v1/send-hr-email",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`
          },
          body: JSON.stringify({ documentId: doc.id })
        }
      );
      const result = await res.json();

      if (!result.success) {
        toast.error(result.message || "Could not send email.");
        return;
      }

      toast.success("Email sent.");
      loadAll();
    } catch {
      toast.error("Could not send email.");
    } finally {
      setSendingEmailFor(null);
    }
  }

  async function handleConvert(candidate: CandidateRow) {
    if (!convertEmail.trim() || !convertPassword.trim()) {
      toast.error("Email and password are required.");
      return;
    }

    setConverting(true);
    try {
      const res = await fetch("/api/convert-candidate-to-employee", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId: candidate.id,
          email: convertEmail.trim(),
          password: convertPassword,
          role: convertRole,
          department: convertDepartment
        })
      });
      const result = await res.json();

      if (!result.success) {
        toast.error(result.message || "Could not convert candidate.");
        return;
      }

      toast.success("Candidate converted to employee.");
      setConvertOpenFor(null);
      setConvertEmail("");
      setConvertPassword("");
      setConvertRole("employee");
      setConvertDepartment("sales");
      loadAll();
    } catch (err: any) {
      toast.error(err.message || "Could not convert candidate.");
    } finally {
      setConverting(false);
    }
  }

  async function handleExport(format: "excel" | "pdf") {
    setExporting(true);
    try {
      const rows: CandidateExportRow[] = visibleCandidates.map((c) => {
        const latest = (interviewsByCandidate.get(c.id) || [])[0] || null;
        return {
          name: c.name,
          mobile: c.mobile,
          email: c.email,
          positionAppliedFor: c.position_applied_for,
          status: c.status,
          latestInterviewDesignation: latest?.designation || null,
          latestInterviewDate: latest?.interview_date || null,
          latestInterviewerName: latest?.interviewer?.name || null,
          createdAt: c.created_at
        };
      });

      const meta = {
        employeeLabel: null,
        otherFilters: statusFilter ? [{ label: "Status", value: STATUS_LABELS[statusFilter] }] : []
      };

      if (format === "excel") await exportCandidatesToExcel(rows, meta);
      else await exportCandidatesToPDF(rows, meta);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">Candidates</h1>
          <p className="text-slate-500 mt-1">Interview → Application → Offer → Appointment → Employee.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleExport("excel")}
            disabled={exporting}
            className="h-10 px-4 rounded-xl bg-emerald-50 text-emerald-700 text-xs font-bold flex items-center gap-1.5 disabled:opacity-50"
          >
            <FileSpreadsheet size={14} />
            Excel
          </button>
          <button
            onClick={() => handleExport("pdf")}
            disabled={exporting}
            className="h-10 px-4 rounded-xl bg-red-50 text-red-600 text-xs font-bold flex items-center gap-1.5 disabled:opacity-50"
          >
            <Download size={14} />
            PDF
          </button>
        </div>
      </div>

      <div className="bg-white rounded-[24px] border border-slate-100 shadow-md p-6">
        {addOpen ? (
          <div className="space-y-3">
            <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400 font-bold">New Candidate — Application Form</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="Full name" className="h-11 rounded-xl bg-slate-50 border border-slate-200 px-3 text-sm outline-none" />
              <input value={addMobile} onChange={(e) => setAddMobile(e.target.value)} placeholder="Mobile" className="h-11 rounded-xl bg-slate-50 border border-slate-200 px-3 text-sm outline-none" />
              <input value={addEmail} onChange={(e) => setAddEmail(e.target.value)} placeholder="Email (optional)" className="h-11 rounded-xl bg-slate-50 border border-slate-200 px-3 text-sm outline-none" />
              <input value={addPosition} onChange={(e) => setAddPosition(e.target.value)} placeholder="Position applied for" className="h-11 rounded-xl bg-slate-50 border border-slate-200 px-3 text-sm outline-none" />
            </div>
            <textarea
              value={addNotes}
              onChange={(e) => setAddNotes(e.target.value)}
              placeholder="Notes (optional)"
              rows={2}
              className="w-full rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-sm outline-none"
            />
            <div className="flex items-center gap-2">
              <button onClick={handleAddCandidate} disabled={adding} className="h-10 px-5 rounded-xl font-semibold text-white bg-gradient-to-r from-blue-600 to-cyan-500 disabled:opacity-50 text-sm">
                {adding ? "Adding..." : "Add Candidate"}
              </button>
              <button onClick={() => setAddOpen(false)} className="h-10 px-3 text-sm text-slate-400">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setAddOpen(true)} className="flex items-center gap-2 text-sm font-bold text-blue-700">
            <Plus size={16} />
            Add Candidate
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <div className="relative">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="appearance-none h-10 rounded-xl bg-white border border-slate-200 pl-3 pr-8 text-sm outline-none"
          >
            <option value="">All Statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
          <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        </div>
      </div>

      {loading ? (
        <div className="text-center text-sm text-slate-400 py-10">Loading...</div>
      ) : visibleCandidates.length === 0 ? (
        <div className="bg-white rounded-[24px] border border-slate-100 shadow-md p-10 text-center text-sm text-slate-400">
          No candidates yet.
        </div>
      ) : (
        <div className="space-y-3">
          {visibleCandidates.map((candidate) => {
            const candidateInterviews = interviewsByCandidate.get(candidate.id) || [];
            const candidateDocuments = documentsByCandidate.get(candidate.id) || [];
            const expanded = expandedId === candidate.id;
            const hasOfferLetter = candidateDocuments.some((d) => d.document_type === "OFFER_LETTER");
            const hasAppointmentLetter = candidateDocuments.some((d) => d.document_type === "APPOINTMENT_LETTER");
            const primaryAction = getPrimaryAction(candidate.status);

            return (
              <motion.div
                key={candidate.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-[24px] border border-slate-100 shadow-md p-5"
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <p className="text-base font-bold text-slate-800">{candidate.name}</p>
                      <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full ${STATUS_META[candidate.status].badge}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${STATUS_META[candidate.status].dot}`} />
                        {STATUS_META[candidate.status].label}
                      </span>
                    </div>
                    <div className="flex items-center gap-3.5 flex-wrap mt-1.5 text-xs text-slate-500">
                      <span className="flex items-center gap-1"><Phone size={12} />{candidate.mobile}</span>
                      {candidate.email && <span className="flex items-center gap-1"><Mail size={12} />{candidate.email}</span>}
                      <span className="flex items-center gap-1"><Briefcase size={12} />{candidate.position_applied_for}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {myRole === "admin" && (
                      <button
                        onClick={() => setDeleteTarget(candidate)}
                        title="Delete this candidate, all their interviews, and all their documents"
                        className="h-9 w-9 rounded-lg bg-red-50 border border-red-100 text-red-500 flex items-center justify-center hover:bg-red-100 transition"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                    <button
                      onClick={() => setExpandedId(expanded ? null : candidate.id)}
                      className="h-9 px-3 rounded-lg bg-slate-50 border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-100 transition"
                    >
                      {expanded ? "Collapse" : "Details"}
                    </button>
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-slate-100">
                  <CandidateStepper status={candidate.status} />
                </div>

                {expanded && (
                  <div className="mt-5 pt-5 border-t border-slate-100 space-y-5">
                    {/* Interviews */}
                    <div>
                      <div className="flex items-center gap-1.5 mb-2.5">
                        <Users size={13} className="text-slate-400" />
                        <p className="text-[11px] uppercase tracking-[0.15em] text-slate-500 font-bold">Interviews</p>
                      </div>
                      {candidateInterviews.length === 0 ? (
                        <p className="text-xs text-slate-400 mb-2">No interviews logged yet.</p>
                      ) : (
                        <div className="space-y-2 mb-2">
                          {candidateInterviews.map((iv) => (
                            <div key={iv.id} className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                              <div className="text-xs mb-2">
                                <span className="font-bold text-slate-800">{iv.designation}</span>
                                <span className="text-slate-400"> · {new Date(iv.interview_date).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" })} · by {iv.interviewer?.name || "Unknown"}</span>
                              </div>
                              {iv.notes && <p className="text-xs text-slate-400 mb-2">{iv.notes}</p>}
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400 mr-1">Result:</span>
                                {iv.result === "PENDING" && (
                                  <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded mr-1">
                                    Awaiting decision
                                  </span>
                                )}
                                {INTERVIEW_RESULT_OPTIONS.map((r) => (
                                  <button
                                    key={r}
                                    disabled={settingResultFor === iv.id}
                                    onClick={() => handleSetResult(iv.id, r)}
                                    className={`h-7 px-3 rounded-lg text-[11px] font-bold border transition disabled:opacity-50 ${
                                      iv.result === r ? RESULT_BUTTON_ACTIVE[r] : "bg-white border-slate-200 text-slate-500 hover:border-slate-300"
                                    }`}
                                  >
                                    {INTERVIEW_RESULT_LABELS[r]}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {interviewOpenFor === candidate.id ? (
                        <div className="space-y-2 p-3 rounded-xl bg-blue-50/50 border border-blue-100">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <select value={interviewerId} onChange={(e) => setInterviewerId(e.target.value)} className="h-9 rounded-lg bg-white border border-slate-200 px-2 text-xs outline-none">
                              <option value="">Interviewer...</option>
                              {employees.map((e) => (
                                <option key={e.id} value={e.id}>{e.name}</option>
                              ))}
                            </select>
                            <input value={interviewDesignation} onChange={(e) => setInterviewDesignation(e.target.value)} placeholder="Designation" className="h-9 rounded-lg bg-white border border-slate-200 px-2 text-xs outline-none" />
                            <input type="date" value={interviewDate} onChange={(e) => setInterviewDate(e.target.value)} className="h-9 rounded-lg bg-white border border-slate-200 px-2 text-xs outline-none" />
                            <input value={interviewNotes} onChange={(e) => setInterviewNotes(e.target.value)} placeholder="Notes (optional)" className="h-9 rounded-lg bg-white border border-slate-200 px-2 text-xs outline-none" />
                          </div>
                          <div className="flex items-center gap-2">
                            <button onClick={() => handleLogInterview(candidate)} disabled={loggingInterview} className="h-8 px-3 rounded-lg bg-blue-600 text-white text-xs font-bold disabled:opacity-50">
                              Save
                            </button>
                            <button onClick={() => setInterviewOpenFor(null)} className="h-8 px-2 text-xs text-slate-400">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        candidate.status !== "CONVERTED" && candidate.status !== "REJECTED" && (
                          candidateInterviews.length === 0 ? (
                            <button
                              onClick={() => setInterviewOpenFor(candidate.id)}
                              className={`${PRIMARY_BUTTON_CLASS} bg-gradient-to-r from-blue-600 to-cyan-500`}
                            >
                              <Plus size={14} /> Log Interview
                            </button>
                          ) : (
                            // Not the primary action once at least one round
                            // already exists -- relabeled too, since "Log
                            // Interview" alone reads ambiguously once a
                            // candidate is already Selected/Offer Sent/etc.
                            // ("what does this even mean right now?").
                            <button onClick={() => setInterviewOpenFor(candidate.id)} className={SECONDARY_BUTTON_CLASS}>
                              <Plus size={12} /> Log another interview round
                            </button>
                          )
                        )
                      )}
                    </div>

                    {/* Documents */}
                    <div>
                      <div className="flex items-center gap-1.5 mb-2.5">
                        <FileText size={13} className="text-slate-400" />
                        <p className="text-[11px] uppercase tracking-[0.15em] text-slate-500 font-bold">Documents</p>
                      </div>
                      {candidateDocuments.length === 0 ? (
                        <p className="text-xs text-slate-400 mb-2">No documents yet.</p>
                      ) : (
                        <div className="space-y-1.5 mb-3">
                          {candidateDocuments.map((d) => (
                            <div key={d.id} className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-100">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${d.is_generated ? "bg-indigo-100 text-indigo-600" : "bg-slate-200 text-slate-500"}`}>
                                  {d.is_generated ? <FileText size={14} /> : <FileUp size={14} />}
                                </div>
                                <div className="min-w-0">
                                  <p className="text-xs font-bold text-slate-700 truncate">{DOCUMENT_TYPE_LABELS[d.document_type] || d.label}</p>
                                  <p className="text-[10px] text-slate-400">
                                    {d.is_generated ? "Generated" : "Uploaded"} · {new Date(d.created_at).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}
                                    {d.emailed_at && (
                                      <span className="text-emerald-600 font-semibold"> · Sent {new Date(d.emailed_at).toLocaleDateString([], { month: "short", day: "numeric" })}</span>
                                    )}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {(d.document_type === "OFFER_LETTER" || d.document_type === "APPOINTMENT_LETTER") && (
                                  <button
                                    onClick={() => handleSendEmail(d)}
                                    disabled={!candidate.email || sendingEmailFor === d.id}
                                    title={!candidate.email ? "Add a candidate email first" : undefined}
                                    className="h-7 px-2.5 rounded-lg bg-violet-50 text-violet-700 text-xs font-bold flex items-center gap-1 disabled:opacity-40"
                                  >
                                    <Send size={11} /> {sendingEmailFor === d.id ? "Sending…" : d.emailed_at ? "Resend" : "Email Bhejo"}
                                  </button>
                                )}
                                <button onClick={() => handleDownloadDocument(d)} className="h-7 px-2.5 rounded-lg bg-teal-50 text-teal-700 text-xs font-bold flex items-center gap-1">
                                  <FileText size={11} /> View
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {candidate.status !== "CONVERTED" && candidate.status !== "REJECTED" && (
                        <div className="space-y-2.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            {OFFER_ELIGIBLE_STATUSES.includes(candidate.status) ? (
                              <button
                                onClick={() => setGenerateOpenFor({ candidateId: candidate.id, documentType: "OFFER_LETTER" })}
                                className={
                                  primaryAction === "offer"
                                    ? `${PRIMARY_BUTTON_CLASS} bg-gradient-to-r from-amber-500 to-orange-500`
                                    : SECONDARY_BUTTON_CLASS
                                }
                              >
                                {primaryAction === "offer" && <FileText size={14} />}
                                {hasOfferLetter ? "Regenerate Offer Letter" : "Generate Offer Letter"}
                              </button>
                            ) : (
                              <p className="text-[11px] text-slate-400 px-1">
                                Mark an interview "Selected" to unlock the Offer Letter.
                              </p>
                            )}
                            {hasOfferLetter && (
                              <button
                                onClick={() => setGenerateOpenFor({ candidateId: candidate.id, documentType: "APPOINTMENT_LETTER" })}
                                className={
                                  primaryAction === "appointment"
                                    ? `${PRIMARY_BUTTON_CLASS} bg-gradient-to-r from-violet-600 to-purple-500`
                                    : SECONDARY_BUTTON_CLASS
                                }
                              >
                                {primaryAction === "appointment" && <FileText size={14} />}
                                {hasAppointmentLetter ? "Regenerate Appointment Letter" : "Generate Appointment Letter"}
                              </button>
                            )}
                          </div>

                          {/* Upload Application Form -- always a quiet
                              secondary/collapsed action (2026-09-24): a
                              supporting document, never the actual next
                              step at any stage, so it never competes
                              visually with whatever genuinely is. */}
                          {uploadFormOpenFor === candidate.id ? (
                            <div className="flex items-center gap-2 flex-wrap p-2.5 rounded-xl bg-slate-50 border border-dashed border-slate-200">
                              <FileUp size={14} className="text-slate-400 shrink-0" />
                              <input
                                type="file"
                                onChange={(e) => setApplicationFormFile(e.target.files?.[0] || null)}
                                className="text-[11px] text-slate-500 max-w-[200px]"
                              />
                              <button
                                onClick={() => handleUploadApplicationForm(candidate)}
                                disabled={uploadingApplicationFormFor === candidate.id || !applicationFormFile}
                                className="h-8 px-3 rounded-lg bg-slate-700 text-white text-xs font-bold disabled:opacity-50 ml-auto"
                              >
                                {uploadingApplicationFormFor === candidate.id ? "Uploading..." : "Upload"}
                              </button>
                              <button
                                onClick={() => {
                                  setUploadFormOpenFor(null);
                                  setApplicationFormFile(null);
                                }}
                                className="h-8 px-2 text-xs text-slate-400"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button onClick={() => setUploadFormOpenFor(candidate.id)} className={SECONDARY_BUTTON_CLASS}>
                              <FileUp size={12} /> Upload Application Form
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Convert to Employee */}
                    <div>
                      {candidate.status === "CONVERTED" ? (
                        <div className="px-3.5 py-3 rounded-xl bg-blue-50 border border-blue-100 text-blue-700 text-xs font-bold flex items-center gap-2">
                          <UserCheck size={15} /> Converted to employee
                        </div>
                      ) : hasAppointmentLetter ? (
                        convertOpenFor === candidate.id ? (
                          <div className="space-y-2 p-3.5 rounded-xl bg-violet-50/50 border border-violet-100">
                            <p className="text-[10px] font-bold text-violet-700 uppercase tracking-wide">Create Employee Account</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              <input value={convertEmail} onChange={(e) => setConvertEmail(e.target.value)} placeholder="Login email" className="h-9 rounded-lg bg-white border border-slate-200 px-2 text-xs outline-none" />
                              <input type="password" value={convertPassword} onChange={(e) => setConvertPassword(e.target.value)} placeholder="Temporary password" className="h-9 rounded-lg bg-white border border-slate-200 px-2 text-xs outline-none" />
                              <select value={convertRole} onChange={(e) => setConvertRole(e.target.value)} className="h-9 rounded-lg bg-white border border-slate-200 px-2 text-xs outline-none">
                                <option value="employee">Employee</option>
                                <option value="team_leader">Team Leader</option>
                                <option value="hr">HR</option>
                                <option value="sales_coordinator">Sales Coordinator</option>
                              </select>
                              <select value={convertDepartment} onChange={(e) => setConvertDepartment(e.target.value)} className="h-9 rounded-lg bg-white border border-slate-200 px-2 text-xs outline-none">
                                <option value="sales">Sales</option>
                                <option value="hr">HR</option>
                              </select>
                            </div>
                            <div className="flex items-center gap-2">
                              <button onClick={() => handleConvert(candidate)} disabled={converting} className="h-8 px-3 rounded-lg bg-violet-600 text-white text-xs font-bold disabled:opacity-50">
                                {converting ? "Converting..." : "Confirm Conversion"}
                              </button>
                              <button onClick={() => setConvertOpenFor(null)} className="h-8 px-2 text-xs text-slate-400">Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => {
                              setConvertOpenFor(candidate.id);
                              setConvertEmail(candidate.email || "");
                            }}
                            className="h-10 px-4 rounded-xl font-bold text-white bg-gradient-to-r from-violet-600 to-purple-500 text-xs flex items-center gap-2 shadow-sm hover:opacity-90 transition"
                          >
                            <UserCheck size={14} /> Convert to Employee
                          </button>
                        )
                      ) : null}
                    </div>

                    {candidate.status !== "CONVERTED" && candidate.status !== "REJECTED" && (
                      <button onClick={() => handleReject(candidate)} className="text-xs font-bold text-red-500 hover:text-red-600">
                        Mark as Rejected
                      </button>
                    )}
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Generate document modal */}
      {generateOpenFor && generateTemplate && (
        <div className="fixed inset-0 z-[200] bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-[24px] p-6 w-full max-w-md space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-slate-800">Generate {generateTemplate.title}</p>
              <button onClick={() => setGenerateOpenFor(null)}><X size={16} /></button>
            </div>
            {generatePlaceholders.auto.length > 0 && (
              <p className="text-[11px] text-slate-400">
                Auto-filled: {generatePlaceholders.auto.map((k) => CANDIDATE_AUTO_PLACEHOLDER_LABELS[k]).join(", ")}
              </p>
            )}
            {generatePlaceholders.manual.length === 0 ? (
              <p className="text-[11px] text-slate-400">No manual fields needed for this template.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {generatePlaceholders.manual.map((key) => (
                  <input
                    key={key}
                    value={generateManualValues[key] || ""}
                    onChange={(e) => setGenerateManualValues((prev) => ({ ...prev, [key]: e.target.value }))}
                    placeholder={key}
                    className="h-10 rounded-xl bg-slate-50 border border-slate-200 px-3 text-sm outline-none"
                  />
                ))}
              </div>
            )}
            <div className="flex items-center gap-2 pt-2">
              <button onClick={handleGenerateDocument} disabled={generating} className="h-10 px-5 rounded-xl font-semibold text-white bg-gradient-to-r from-amber-600 to-orange-500 disabled:opacity-50 text-sm">
                {generating ? "Generating..." : "Generate"}
              </button>
              <button onClick={() => setGenerateOpenFor(null)} className="h-10 px-3 text-sm text-slate-400">Cancel</button>
            </div>
          </div>
        </div>
      )}

      <DeleteModal
        open={Boolean(deleteTarget)}
        setOpen={(open: boolean) => !open && setDeleteTarget(null)}
        onDelete={handleDeleteCandidate}
        title="Delete Candidate"
        message={
          deletingCandidate
            ? "Deleting..."
            : `This permanently deletes "${deleteTarget?.name}", all of their logged interviews, and all of their documents (Application Form, Offer Letter, Appointment Letter). This cannot be undone.`
        }
      />
    </div>
  );
}
