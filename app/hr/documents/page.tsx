"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import { FileText, Upload, Sparkles, Settings, Search, ChevronDown, FileUp, Check, ImagePlus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { buildHrDocumentBlob, LetterheadImage } from "@/lib/generateHrDocumentPdf";

interface EmployeeRow {
  id: string;
  name: string;
  department: string | null;
  role: string;
  email: string | null;
}

interface TemplateRow {
  id: string;
  title: string;
  body: string;
  letterhead_storage_path: string | null;
  created_at: string;
}

// Fields resolved automatically from the employee record + today's
// date -- the only ones that actually exist on `employees` (confirmed
// via schema check: no designation/salary/joining_date column exists).
// Every other {{token}} found in a template body becomes a manual
// input at generation time.
const AUTO_PLACEHOLDER_LABELS: Record<string, string> = {
  employee_name: "Employee Name",
  department: "Department",
  role: "Role",
  email: "Email",
  today_date: "Today's Date"
};

function resolveAutoValue(key: string, employee: EmployeeRow): string | null {
  switch (key) {
    case "employee_name":
      return employee.name;
    case "department":
      return employee.department || "";
    case "role":
      return employee.role;
    case "email":
      return employee.email || "";
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
    if (key in AUTO_PLACEHOLDER_LABELS) auto.push(key);
    else manual.push(key);
  }
  return { auto, manual };
}

interface DocumentRow {
  id: string;
  document_type: string;
  label: string;
  storage_path: string;
  file_mime_type: string;
  is_generated: boolean;
  created_at: string;
  employee: { id: string; name: string } | null;
  // Candidate-linked documents (2026-09-24) -- hr_documents.employee_id
  // is nullable now, candidate_id is the other half of that pairing
  // (see HRMS_MASTER_PLAN.md's Candidate flow). Without embedding
  // this too, a candidate-stage Offer Letter/Appointment
  // Letter/Application Form showed here as "Unknown employee" --
  // technically not wrong (there IS no employee yet), just unhelpful
  // for Admin/HR browsing this general list.
  candidate: { id: string; name: string } | null;
  uploaded_by: { name: string } | null;
}

// Change Letterhead (2026-09-25) -- single owner of "which templates
// share the one-click letterhead swap." Reused by both the panel's
// note text and the update query itself, so they can never drift.
const SHARED_LETTERHEAD_TEMPLATE_TITLES = ["Offer Letter", "Appointment Letter"];

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  AADHAR: "Aadhar",
  PAN: "PAN",
  OFFER_LETTER: "Offer Letter",
  APPOINTMENT_LETTER: "Appointment Letter",
  EXPERIENCE_LETTER: "Experience Letter",
  EDUCATIONAL: "Educational",
  BOND: "Bond",
  APPLICATION_FORM: "Application Form",
  JOINING_FORM: "Joining Form",
  SALARY_SLIP: "Salary Slip",
  OTHER: "Other"
};

// HR/Admin's own upload/list/download surface. Upload is a two-step
// client flow: the file goes straight to the private hr-documents
// bucket (their own bucket RLS already permits this), then
// register_hr_document_atomic records the metadata row AND notifies
// the employee in one atomic call -- that RPC exists specifically
// because `notification` has no HR insert grant (admin-only), so a
// bare client insert for the notification half would fail regardless.
// Download here is a plain, real signed URL + <a download> -- HR/Admin
// never go through the employee's view-only-canvas path (piece 3).
export default function HrDocumentsPage() {
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadEmployeeId, setUploadEmployeeId] = useState("");
  const [uploadType, setUploadType] = useState("OTHER");
  const [uploadLabel, setUploadLabel] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const [myEmployeeId, setMyEmployeeId] = useState("");
  // Delete restricted to Admin (2026-09-24) — RLS is the real
  // enforcement (hr_documents_hr_* and the storage bucket's HR
  // policies no longer grant DELETE at all, admin-only), this is just
  // defense-in-depth so an HR caller never even sees a Delete button
  // that would fail server-side.
  const [myRole, setMyRole] = useState("");

  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [manageTemplatesOpen, setManageTemplatesOpen] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [templateTitle, setTemplateTitle] = useState("");
  const [templateBody, setTemplateBody] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  // Letterhead (2026-09-21): templateLetterheadPath tracks what's
  // currently saved on the template being edited (null = none, or a
  // fresh upload's path once handleSaveTemplate has written it).
  // templateLetterheadFile is a pending new upload not yet saved;
  // templateRemoveLetterhead marks "clear the existing one" separately
  // from "never had one", since both end at letterhead_storage_path
  // being null but only one should touch storage on save.
  const [templateLetterheadPath, setTemplateLetterheadPath] = useState<string | null>(null);
  const [templateLetterheadFile, setTemplateLetterheadFile] = useState<File | null>(null);
  const [templateRemoveLetterhead, setTemplateRemoveLetterhead] = useState(false);

  // Change Letterhead (2026-09-25, Admin-only UI) -- a shortcut over
  // the exact same letterhead_storage_path field Manage Templates
  // already edits per-template, just applied to both letter templates
  // at once instead of opening each one individually.
  const [changeLetterheadOpen, setChangeLetterheadOpen] = useState(false);
  const [newLetterheadFile, setNewLetterheadFile] = useState<File | null>(null);
  const [changingLetterhead, setChangingLetterhead] = useState(false);

  const [generateOpen, setGenerateOpen] = useState(false);
  const [generateTemplateId, setGenerateTemplateId] = useState("");
  const [generateEmployeeId, setGenerateEmployeeId] = useState("");
  const [generateType, setGenerateType] = useState("OFFER_LETTER");
  const [generateLabel, setGenerateLabel] = useState("");
  const [generateManualValues, setGenerateManualValues] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    loadEmployees();
    loadDocuments();
    loadTemplates();
    loadSelf();
  }, []);

  async function loadEmployees() {
    const { data } = await supabase.from("employees").select("id, name, department, role, email").eq("is_active", true).order("name");
    if (data) setEmployees(data as EmployeeRow[]);
  }

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

  async function loadTemplates() {
    const { data, error } = await supabase
      .from("hr_document_templates")
      .select("id, title, body, letterhead_storage_path, created_at")
      .order("created_at", { ascending: false });
    if (error) {
      toast.error(error.message || "Could not load templates.");
      return;
    }
    setTemplates(data || []);
  }

  async function loadDocuments() {
    setLoading(true);
    const { data, error } = await supabase
      .from("hr_documents")
      .select(
        `
        id, document_type, label, storage_path, file_mime_type, is_generated, created_at,
        employee:employees!hr_documents_employee_id_fkey(id, name),
        candidate:candidates!hr_documents_candidate_id_fkey(id, name),
        uploaded_by:employees!hr_documents_uploaded_by_employee_id_fkey(name)
        `
      )
      .order("created_at", { ascending: false });

    if (error) {
      toast.error(error.message || "Could not load documents.");
      setLoading(false);
      return;
    }

    setDocuments((data || []) as unknown as DocumentRow[]);
    setLoading(false);
  }

  const visibleDocuments = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return documents.filter((d) => {
      if (employeeFilter && d.employee?.id !== employeeFilter) return false;
      if (q && !d.label.toLowerCase().includes(q) && !(d.employee?.name || d.candidate?.name || "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [documents, employeeFilter, searchQuery]);

  async function handleUpload() {
    if (!uploadEmployeeId) {
      toast.error("Pick an employee first.");
      return;
    }
    if (!uploadLabel.trim()) {
      toast.error("A label is required.");
      return;
    }
    if (!uploadFile) {
      toast.error("Pick a file to upload.");
      return;
    }

    setUploading(true);
    try {
      const sanitizedName = uploadFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storagePath = `${uploadEmployeeId}/${crypto.randomUUID()}-${sanitizedName}`;

      const { error: uploadError } = await supabase.storage.from("hr-documents").upload(storagePath, uploadFile);

      if (uploadError) {
        toast.error(uploadError.message || "Upload failed.");
        return;
      }

      const { error: registerError } = await supabase.rpc("register_hr_document_atomic", {
        p_employee_id: uploadEmployeeId,
        p_document_type: uploadType,
        p_label: uploadLabel.trim(),
        p_storage_path: storagePath,
        p_file_mime_type: uploadFile.type || "application/octet-stream",
        p_is_generated: false
      });

      if (registerError) {
        // Storage object is now orphaned (metadata insert failed) --
        // clean it up so it doesn't sit around invisibly.
        await supabase.storage.from("hr-documents").remove([storagePath]);
        toast.error(registerError.message || "Could not save document record.");
        return;
      }

      toast.success("Document uploaded.");
      setUploadOpen(false);
      setUploadLabel("");
      setUploadFile(null);
      loadDocuments();
    } catch (err) {
      console.error(err);
      toast.error("Something went wrong.");
    } finally {
      setUploading(false);
    }
  }

  async function handleDownload(doc: DocumentRow) {
    const { data, error } = await supabase.storage.from("hr-documents").createSignedUrl(doc.storage_path, 300);

    if (error || !data) {
      toast.error(error?.message || "Could not generate download link.");
      return;
    }

    const a = document.createElement("a");
    a.href = data.signedUrl;
    a.download = doc.label;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  async function handleDelete(doc: DocumentRow) {
    const { error: storageError } = await supabase.storage.from("hr-documents").remove([doc.storage_path]);
    if (storageError) {
      toast.error(storageError.message || "Could not delete file.");
      return;
    }

    const { error } = await supabase.from("hr_documents").delete().eq("id", doc.id);
    if (error) {
      toast.error(error.message || "Could not delete document record.");
      return;
    }

    toast.success("Document deleted.");
    loadDocuments();
  }

  function startEditTemplate(template: TemplateRow) {
    setEditingTemplateId(template.id);
    setTemplateTitle(template.title);
    setTemplateBody(template.body);
    setTemplateLetterheadPath(template.letterhead_storage_path);
    setTemplateLetterheadFile(null);
    setTemplateRemoveLetterhead(false);
  }

  function cancelEditTemplate() {
    setEditingTemplateId(null);
    setTemplateTitle("");
    setTemplateBody("");
    setTemplateLetterheadPath(null);
    setTemplateLetterheadFile(null);
    setTemplateRemoveLetterhead(false);
  }

  async function handleSaveTemplate() {
    if (!templateTitle.trim()) {
      toast.error("A title is required.");
      return;
    }
    if (!templateBody.trim()) {
      toast.error("Body is required.");
      return;
    }

    setSavingTemplate(true);
    try {
      // Letterhead upload happens first, same "storage write, then
      // metadata write, clean up on metadata failure" shape as
      // handleUpload/handleGenerate elsewhere in this file — reuses
      // the same private hr-documents bucket, under its own
      // letterheads/ prefix so it's visually distinct from per-
      // employee document paths.
      let letterheadPath = templateLetterheadPath;

      if (templateRemoveLetterhead && !templateLetterheadFile) {
        letterheadPath = null;
      }

      if (templateLetterheadFile) {
        const sanitizedName = templateLetterheadFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const newPath = `letterheads/${crypto.randomUUID()}-${sanitizedName}`;

        const { error: uploadError } = await supabase.storage.from("hr-documents").upload(newPath, templateLetterheadFile);
        if (uploadError) {
          toast.error(uploadError.message || "Letterhead upload failed.");
          return;
        }

        letterheadPath = newPath;
      }

      if (editingTemplateId) {
        const { error } = await supabase
          .from("hr_document_templates")
          .update({ title: templateTitle.trim(), body: templateBody, letterhead_storage_path: letterheadPath })
          .eq("id", editingTemplateId);
        if (error) {
          toast.error(error.message || "Could not update template.");
          return;
        }
        toast.success("Template updated.");
      } else {
        const { error } = await supabase.from("hr_document_templates").insert({
          title: templateTitle.trim(),
          body: templateBody,
          letterhead_storage_path: letterheadPath,
          created_by_employee_id: myEmployeeId
        });
        if (error) {
          toast.error(error.message || "Could not create template.");
          return;
        }
        toast.success("Template created.");
      }

      cancelEditTemplate();
      loadTemplates();
    } finally {
      setSavingTemplate(false);
    }
  }

  async function handleDeleteTemplate(id: string) {
    const { error } = await supabase.from("hr_document_templates").delete().eq("id", id);
    if (error) {
      toast.error(error.message || "Could not delete template.");
      return;
    }
    toast.success("Template deleted.");
    if (editingTemplateId === id) cancelEditTemplate();
    loadTemplates();
  }

  // Change Letterhead (2026-09-25) -- uploads once, then points BOTH
  // SHARED_LETTERHEAD_TEMPLATE_TITLES templates' letterhead_storage_path
  // at the new file. Same "upload to storage, then write metadata,
  // clean up storage on a failed write" shape as handleUpload/
  // handleSaveTemplate elsewhere in this file. The old letterhead file
  // is left in storage untouched -- same as editing one template's
  // letterhead individually already does today, not a new gap.
  async function handleChangeLetterhead() {
    if (!newLetterheadFile) {
      toast.error("Choose an image first.");
      return;
    }

    setChangingLetterhead(true);
    try {
      const sanitizedName = newLetterheadFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const newPath = `letterheads/${crypto.randomUUID()}-${sanitizedName}`;

      const { error: uploadError } = await supabase.storage.from("hr-documents").upload(newPath, newLetterheadFile);
      if (uploadError) {
        toast.error(uploadError.message || "Upload failed.");
        return;
      }

      const { error: updateError } = await supabase
        .from("hr_document_templates")
        .update({ letterhead_storage_path: newPath })
        .in("title", SHARED_LETTERHEAD_TEMPLATE_TITLES);

      if (updateError) {
        await supabase.storage.from("hr-documents").remove([newPath]);
        toast.error(updateError.message || "Could not update templates.");
        return;
      }

      toast.success(`Letterhead updated for ${SHARED_LETTERHEAD_TEMPLATE_TITLES.join(" and ")}.`);
      setChangeLetterheadOpen(false);
      setNewLetterheadFile(null);
      loadTemplates();
    } catch (err) {
      console.error(err);
      toast.error("Something went wrong.");
    } finally {
      setChangingLetterhead(false);
    }
  }

  const generateTemplate = templates.find((t) => t.id === generateTemplateId) || null;
  const generatePlaceholders = generateTemplate ? detectPlaceholders(generateTemplate.body) : { auto: [], manual: [] };

  async function handleGenerate() {
    if (!generateTemplate) {
      toast.error("Pick a template.");
      return;
    }
    if (!generateEmployeeId) {
      toast.error("Pick an employee.");
      return;
    }
    if (!generateLabel.trim()) {
      toast.error("A label is required.");
      return;
    }

    const employee = employees.find((e) => e.id === generateEmployeeId);
    if (!employee) {
      toast.error("Employee not found.");
      return;
    }

    for (const key of generatePlaceholders.manual) {
      if (!generateManualValues[key]?.trim()) {
        toast.error(`Fill in "${key}" before generating.`);
        return;
      }
    }

    setGenerating(true);
    try {
      const substituted = generateTemplate.body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
        const autoValue = resolveAutoValue(key, employee);
        if (autoValue !== null) return autoValue;
        return generateManualValues[key] || "";
      });

      // Letterhead (2026-09-21) — buildHrDocumentBlob's addImage()
      // needs the actual image bytes, not a URL it fetches itself, so
      // the signed URL is read here and converted to a data: URL
      // before being handed over. HR/Admin already have direct bucket
      // RLS access, so a short-lived signed URL (not the no-download
      // employee-viewer path elsewhere in this module) is fine here.
      let letterhead: LetterheadImage | undefined;
      if (generateTemplate.letterhead_storage_path) {
        const { data: signedData, error: signedError } = await supabase.storage
          .from("hr-documents")
          .createSignedUrl(generateTemplate.letterhead_storage_path, 60);

        if (signedError || !signedData) {
          toast.error(signedError?.message || "Could not load letterhead image.");
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

      const blob = await buildHrDocumentBlob(generateLabel.trim(), substituted, letterhead);
      const storagePath = `${generateEmployeeId}/${crypto.randomUUID()}-generated.pdf`;

      const { error: uploadError } = await supabase.storage
        .from("hr-documents")
        .upload(storagePath, blob, { contentType: "application/pdf" });

      if (uploadError) {
        toast.error(uploadError.message || "Upload failed.");
        return;
      }

      const { error: registerError } = await supabase.rpc("register_hr_document_atomic", {
        p_employee_id: generateEmployeeId,
        p_document_type: generateType,
        p_label: generateLabel.trim(),
        p_storage_path: storagePath,
        p_file_mime_type: "application/pdf",
        p_is_generated: true
      });

      if (registerError) {
        await supabase.storage.from("hr-documents").remove([storagePath]);
        toast.error(registerError.message || "Could not save document record.");
        return;
      }

      toast.success("Document generated.");
      setGenerateOpen(false);
      setGenerateTemplateId("");
      setGenerateEmployeeId("");
      setGenerateLabel("");
      setGenerateManualValues({});
      loadDocuments();
    } catch (err) {
      console.error(err);
      toast.error("Something went wrong.");
    } finally {
      setGenerating(false);
    }
  }

  const totalDocuments = documents.length;
  const generatedCount = documents.filter((d) => d.is_generated).length;
  const uploadedCount = totalDocuments - generatedCount;

  return (
    <div className="space-y-6 pb-10">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-[24px] bg-gradient-to-br from-teal-700 via-emerald-600 to-teal-500 text-white p-5 sm:p-6"
      >
        <FileText size={170} strokeWidth={1.1} className="absolute -right-8 -bottom-12 text-white/10 pointer-events-none hidden sm:block" />

        <div className="relative flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.2em] text-teal-100 uppercase mb-2">HR Documents</p>
            <h1 className="text-xl sm:text-2xl font-bold">Employee Documents</h1>
            <p className="text-sm text-white/70 mt-1">
              Employees can view their own documents but never download them — only HR/Admin can here.
            </p>
          </div>
          <div className="flex gap-2 flex-wrap shrink-0">
            <button
              onClick={() => setUploadOpen(true)}
              className="flex items-center gap-1.5 h-10 px-4 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-sm font-semibold transition"
            >
              <Upload size={14} /> Upload Document
            </button>
            <button
              onClick={() => setGenerateOpen(true)}
              className="flex items-center gap-1.5 h-10 px-4 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-sm font-semibold transition"
            >
              <Sparkles size={14} /> Generate Document
            </button>
            <button
              onClick={() => setManageTemplatesOpen(true)}
              className="flex items-center gap-1.5 h-10 px-4 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-sm font-semibold transition"
            >
              <Settings size={14} /> Manage Templates
            </button>
            {myRole === "admin" && (
              <button
                onClick={() => setChangeLetterheadOpen(true)}
                className="flex items-center gap-1.5 h-10 px-4 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-sm font-semibold transition"
              >
                <ImagePlus size={14} /> Change Letterhead
              </button>
            )}
          </div>
        </div>

        <div className="relative flex items-center gap-2.5 flex-wrap mt-5">
          <div className="flex items-baseline gap-1.5 bg-white/10 border border-white/15 rounded-xl px-3.5 py-2">
            <span className="text-lg font-bold leading-none">{totalDocuments}</span>
            <span className="text-[11px] text-white/70 font-semibold">Total Documents</span>
          </div>
          <div className="flex items-baseline gap-1.5 bg-white/10 border border-white/15 rounded-xl px-3.5 py-2">
            <span className="text-lg font-bold leading-none">{generatedCount}</span>
            <span className="text-[11px] text-white/70 font-semibold">Generated</span>
          </div>
          <div className="flex items-baseline gap-1.5 bg-white/10 border border-white/15 rounded-xl px-3.5 py-2">
            <span className="text-lg font-bold leading-none">{uploadedCount}</span>
            <span className="text-[11px] text-white/70 font-semibold">Uploaded</span>
          </div>
        </div>
      </motion.div>

      {uploadOpen && (
        <div className="rounded-2xl bg-white border border-slate-100 shadow-[0_4px_20px_rgba(15,23,42,0.06)] p-5 space-y-3.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center shrink-0">
                <Upload size={15} />
              </div>
              <p className="text-sm font-bold text-slate-800">Upload Document</p>
            </div>
            <button onClick={() => setUploadOpen(false)} className="text-xs font-bold text-slate-400 hover:text-slate-600">
              Close
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              value={uploadEmployeeId}
              onChange={(e) => setUploadEmployeeId(e.target.value)}
              className="h-10 rounded-xl bg-slate-50 border border-slate-200 px-3 text-xs font-semibold text-slate-600 outline-none focus:ring-2 focus:ring-teal-100 focus:border-teal-300 transition"
            >
              <option value="">Select employee...</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name}
                </option>
              ))}
            </select>
            <select
              value={uploadType}
              onChange={(e) => setUploadType(e.target.value)}
              className="h-10 rounded-xl bg-slate-50 border border-slate-200 px-3 text-xs font-semibold text-slate-600 outline-none focus:ring-2 focus:ring-teal-100 focus:border-teal-300 transition"
            >
              {Object.entries(DOCUMENT_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <input
              value={uploadLabel}
              onChange={(e) => setUploadLabel(e.target.value)}
              placeholder="Label (e.g. Aadhar Card - Front)"
              className="h-10 flex-1 min-w-[200px] rounded-xl bg-slate-50 border border-slate-200 px-3 text-xs outline-none focus:ring-2 focus:ring-teal-100 focus:border-teal-300 transition"
            />
            <label className="h-10 flex items-center gap-2 px-3 rounded-xl bg-slate-50 border border-dashed border-slate-300 text-xs text-slate-500 cursor-pointer hover:bg-slate-100 transition">
              <FileUp size={14} className="text-slate-400 shrink-0" />
              <span className="truncate max-w-[140px]">{uploadFile ? uploadFile.name : "Choose a file"}</span>
              <input type="file" onChange={(e) => setUploadFile(e.target.files?.[0] || null)} className="hidden" />
            </label>
          </div>
          <div className="flex gap-2">
            <button
              disabled={uploading}
              onClick={handleUpload}
              className="h-10 px-5 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-teal-600 to-emerald-500 shadow-sm hover:opacity-90 disabled:opacity-60 transition"
            >
              {uploading ? "Uploading..." : "Upload"}
            </button>
            <button
              disabled={uploading}
              onClick={() => setUploadOpen(false)}
              className="h-10 px-4 rounded-xl text-xs font-bold bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-60 transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {changeLetterheadOpen && myRole === "admin" && (
        <div className="rounded-2xl bg-white border border-slate-100 shadow-[0_4px_20px_rgba(15,23,42,0.06)] p-5 space-y-3.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center shrink-0">
                <ImagePlus size={15} />
              </div>
              <p className="text-sm font-bold text-slate-800">Change Letterhead</p>
            </div>
            <button
              onClick={() => {
                setChangeLetterheadOpen(false);
                setNewLetterheadFile(null);
              }}
              className="text-xs font-bold text-slate-400 hover:text-slate-600"
            >
              Close
            </button>
          </div>

          <p className="text-[11px] text-slate-400">
            Uploads a new letterhead image and updates it everywhere at once — no code change or deploy needed.
            This will update the letterhead used in: <span className="font-semibold text-slate-600">{SHARED_LETTERHEAD_TEMPLATE_TITLES.join(", ")}</span>.
          </p>

          <label className="h-10 flex items-center gap-2 px-3 rounded-xl bg-slate-50 border border-dashed border-slate-300 text-xs text-slate-500 cursor-pointer hover:bg-slate-100 transition w-fit">
            <FileUp size={14} className="text-slate-400 shrink-0" />
            <span className="truncate max-w-[220px]">{newLetterheadFile ? newLetterheadFile.name : "Choose an image (PNG or JPEG)"}</span>
            <input
              type="file"
              accept="image/png,image/jpeg"
              onChange={(e) => setNewLetterheadFile(e.target.files?.[0] || null)}
              className="hidden"
            />
          </label>

          <div className="flex gap-2">
            <button
              disabled={changingLetterhead}
              onClick={handleChangeLetterhead}
              className="h-10 px-5 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-teal-600 to-emerald-500 shadow-sm hover:opacity-90 disabled:opacity-60 transition"
            >
              {changingLetterhead ? "Updating..." : "Save & Apply"}
            </button>
            <button
              disabled={changingLetterhead}
              onClick={() => {
                setChangeLetterheadOpen(false);
                setNewLetterheadFile(null);
              }}
              className="h-10 px-4 rounded-xl text-xs font-bold bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-60 transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {manageTemplatesOpen && (
        <div className="rounded-2xl bg-white border border-slate-100 shadow-[0_4px_20px_rgba(15,23,42,0.06)] p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center shrink-0">
                <Settings size={15} />
              </div>
              <p className="text-sm font-bold text-slate-800">Manage Templates</p>
            </div>
            <button onClick={() => setManageTemplatesOpen(false)} className="text-xs font-bold text-slate-400 hover:text-slate-600">
              Close
            </button>
          </div>

          <div className="space-y-2">
            <input
              value={templateTitle}
              onChange={(e) => setTemplateTitle(e.target.value)}
              placeholder="Template title (e.g. Offer Letter)"
              className="h-10 w-full rounded-xl bg-slate-50 border border-slate-200 px-3 text-xs outline-none focus:ring-2 focus:ring-teal-100 focus:border-teal-300 transition"
            />
            <textarea
              value={templateBody}
              onChange={(e) => setTemplateBody(e.target.value)}
              placeholder={"Template body. Use {{employee_name}}, {{department}}, {{role}}, {{email}}, {{today_date}} for auto-filled fields, or any other {{token}} (e.g. {{position}}, {{joining_date}}) to be filled in manually when generating."}
              rows={6}
              className="w-full rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-xs outline-none font-mono focus:ring-2 focus:ring-teal-100 focus:border-teal-300 transition"
            />

            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-2">
              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">
                Letterhead Image (optional)
              </p>
              <p className="text-[11px] text-slate-400">
                Generated documents print on top of this image full-page — leave blank to use the plain company-name header.
              </p>

              {templateLetterheadPath && !templateRemoveLetterhead && !templateLetterheadFile && (
                <div className="flex items-center justify-between gap-2 text-xs text-slate-600">
                  <span className="flex items-center gap-1.5"><Check size={13} className="text-emerald-600" /> Letterhead image set.</span>
                  <button
                    onClick={() => setTemplateRemoveLetterhead(true)}
                    className="text-xs font-bold px-2.5 py-1 rounded-full bg-red-50 text-red-600 hover:bg-red-100"
                  >
                    Remove
                  </button>
                </div>
              )}

              {templateRemoveLetterhead && (
                <div className="flex items-center justify-between gap-2 text-xs text-amber-700">
                  <span>Letterhead will be removed on save.</span>
                  <button
                    onClick={() => setTemplateRemoveLetterhead(false)}
                    className="text-xs font-bold px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200"
                  >
                    Undo
                  </button>
                </div>
              )}

              <input
                type="file"
                accept="image/png,image/jpeg"
                onChange={(e) => {
                  setTemplateLetterheadFile(e.target.files?.[0] || null);
                  setTemplateRemoveLetterhead(false);
                }}
                className="text-xs w-full"
              />
              {templateLetterheadFile && (
                <p className="text-[11px] text-teal-700">New image selected: {templateLetterheadFile.name}</p>
              )}
            </div>

            <div className="flex gap-2">
              <button
                disabled={savingTemplate}
                onClick={handleSaveTemplate}
                className="h-10 px-5 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-teal-600 to-emerald-500 shadow-sm hover:opacity-90 disabled:opacity-60 transition"
              >
                {savingTemplate ? "Saving..." : editingTemplateId ? "Update Template" : "Create Template"}
              </button>
              {editingTemplateId && (
                <button
                  disabled={savingTemplate}
                  onClick={cancelEditTemplate}
                  className="h-10 px-4 rounded-xl text-xs font-bold bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-60 transition"
                >
                  Cancel Edit
                </button>
              )}
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t border-slate-100">
            {templates.length === 0 ? (
              <p className="text-xs text-slate-400">No templates yet.</p>
            ) : (
              templates.map((t) => (
                <div key={t.id} className="rounded-xl bg-slate-50 border border-slate-100 p-3 flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-xs font-bold text-slate-700">{t.title}</p>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => startEditTemplate(t)} className="text-xs font-bold px-3 py-1 rounded-full bg-teal-50 text-teal-700 hover:bg-teal-100">
                      Edit
                    </button>
                    {myRole === "admin" && (
                      <button onClick={() => handleDeleteTemplate(t.id)} className="text-xs font-bold px-3 py-1 rounded-full bg-red-50 text-red-600 hover:bg-red-100">
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {generateOpen && (
        <div className="rounded-2xl bg-white border border-slate-100 shadow-[0_4px_20px_rgba(15,23,42,0.06)] p-5 space-y-3.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center shrink-0">
                <Sparkles size={15} />
              </div>
              <p className="text-sm font-bold text-slate-800">Generate Document from Template</p>
            </div>
            <button onClick={() => setGenerateOpen(false)} className="text-xs font-bold text-slate-400 hover:text-slate-600">
              Close
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              value={generateTemplateId}
              onChange={(e) => setGenerateTemplateId(e.target.value)}
              className="h-10 rounded-xl bg-slate-50 border border-slate-200 px-3 text-xs font-semibold text-slate-600 outline-none focus:ring-2 focus:ring-teal-100 focus:border-teal-300 transition"
            >
              <option value="">Select template...</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
            <select
              value={generateEmployeeId}
              onChange={(e) => setGenerateEmployeeId(e.target.value)}
              className="h-10 rounded-xl bg-slate-50 border border-slate-200 px-3 text-xs font-semibold text-slate-600 outline-none focus:ring-2 focus:ring-teal-100 focus:border-teal-300 transition"
            >
              <option value="">Select employee...</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name}
                </option>
              ))}
            </select>
            <select
              value={generateType}
              onChange={(e) => setGenerateType(e.target.value)}
              className="h-10 rounded-xl bg-slate-50 border border-slate-200 px-3 text-xs font-semibold text-slate-600 outline-none focus:ring-2 focus:ring-teal-100 focus:border-teal-300 transition"
            >
              {Object.entries(DOCUMENT_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <input
              value={generateLabel}
              onChange={(e) => setGenerateLabel(e.target.value)}
              placeholder="Label (e.g. Offer Letter - Vivek Srivastava)"
              className="h-10 flex-1 min-w-[220px] rounded-xl bg-slate-50 border border-slate-200 px-3 text-xs outline-none focus:ring-2 focus:ring-teal-100 focus:border-teal-300 transition"
            />
          </div>

          {generateTemplate && (
            <div className="space-y-2 pt-2 border-t border-slate-100">
              {generatePlaceholders.auto.length > 0 && (
                <p className="text-[11px] text-slate-400">
                  Auto-filled: {generatePlaceholders.auto.map((k) => AUTO_PLACEHOLDER_LABELS[k]).join(", ")}
                </p>
              )}
              {generatePlaceholders.manual.length === 0 ? (
                <p className="text-[11px] text-slate-400">No manual fields needed for this template.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {generatePlaceholders.manual.map((key) => (
                    <input
                      key={key}
                      value={generateManualValues[key] || ""}
                      onChange={(e) => setGenerateManualValues((prev) => ({ ...prev, [key]: e.target.value }))}
                      placeholder={key}
                      className="h-10 flex-1 min-w-[160px] rounded-xl bg-slate-50 border border-slate-200 px-3 text-xs outline-none"
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <button
              disabled={generating}
              onClick={handleGenerate}
              className="h-10 px-5 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-teal-600 to-emerald-500 shadow-sm hover:opacity-90 disabled:opacity-60 transition"
            >
              {generating ? "Generating..." : "Generate"}
            </button>
            <button
              disabled={generating}
              onClick={() => setGenerateOpen(false)}
              className="h-10 px-4 rounded-xl text-xs font-bold bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-60 transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-100 shadow-[0_4px_20px_rgba(15,23,42,0.06)] p-2.5 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by document label or name..."
            className="w-full h-10 rounded-xl bg-slate-50 border border-slate-200 pl-10 pr-3 text-sm outline-none focus:ring-2 focus:ring-teal-100 focus:border-teal-300 transition"
          />
        </div>
        <div className="relative">
          <select
            value={employeeFilter}
            onChange={(e) => setEmployeeFilter(e.target.value)}
            className="appearance-none h-10 rounded-xl bg-slate-50 border border-slate-200 pl-3 pr-8 text-sm outline-none focus:ring-2 focus:ring-teal-100 focus:border-teal-300 transition"
          >
            <option value="">All Employees</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.name}
              </option>
            ))}
          </select>
          <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        </div>
      </div>

      {loading ? (
        <div className="text-center text-sm text-slate-400 py-10">Loading...</div>
      ) : visibleDocuments.length === 0 ? (
        <div className="bg-white rounded-[24px] border border-slate-100 shadow-[0_4px_20px_rgba(15,23,42,0.06)] p-10 text-center text-sm text-slate-400">
          {documents.length === 0 ? "No documents yet." : "No documents match your search."}
        </div>
      ) : (
        <div className="space-y-3">
          {visibleDocuments.map((doc) => (
            <div key={doc.id} className="rounded-2xl bg-white border border-slate-100 shadow-[0_2px_10px_rgba(15,23,42,0.05)] hover:shadow-[0_6px_20px_rgba(15,23,42,0.08)] transition-shadow p-4 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-start gap-3 min-w-0">
                <div className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${doc.is_generated ? "bg-indigo-100 text-indigo-600" : "bg-slate-200 text-slate-500"}`}>
                  {doc.is_generated ? <FileText size={15} /> : <FileUp size={15} />}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-bold text-slate-800">{doc.label}</p>
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                      {DOCUMENT_TYPE_LABELS[doc.document_type] || doc.document_type}
                    </span>
                    {doc.is_generated && (
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600">Generated</span>
                    )}
                    {doc.candidate && (
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-violet-50 text-violet-600">Candidate</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {doc.employee?.name || doc.candidate?.name || "Unknown"} · uploaded by {doc.uploaded_by?.name || "—"} on{" "}
                    {new Date(doc.created_at).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}
                  </p>
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => handleDownload(doc)}
                  className="text-xs font-bold px-3 py-1.5 rounded-full bg-teal-50 text-teal-700 hover:bg-teal-100"
                >
                  Download
                </button>
                {myRole === "admin" && (
                  <button
                    onClick={() => handleDelete(doc)}
                    className="text-xs font-bold px-3 py-1.5 rounded-full bg-red-50 text-red-600 hover:bg-red-100"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
