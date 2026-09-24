"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
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
  uploaded_by: { name: string } | null;
}

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  AADHAR: "Aadhar",
  PAN: "PAN",
  OFFER_LETTER: "Offer Letter",
  APPOINTMENT_LETTER: "Appointment Letter",
  EXPERIENCE_LETTER: "Experience Letter",
  EDUCATIONAL: "Educational",
  BOND: "Bond",
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
  const [loading, setLoading] = useState(true);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadEmployeeId, setUploadEmployeeId] = useState("");
  const [uploadType, setUploadType] = useState("OTHER");
  const [uploadLabel, setUploadLabel] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const [myEmployeeId, setMyEmployeeId] = useState("");

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
    const { data } = await supabase.from("employees").select("id").eq("auth_user_id", user.id).single();
    if (data) setMyEmployeeId(data.id);
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

  const visibleDocuments = useMemo(
    () => (employeeFilter ? documents.filter((d) => d.employee?.id === employeeFilter) : documents),
    [documents, employeeFilter]
  );

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

  return (
    <div className="space-y-6 pb-10">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-[24px] bg-gradient-to-br from-teal-700 via-emerald-600 to-teal-500 text-white p-6"
      >
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.2em] text-teal-100 uppercase mb-2">HR Documents</p>
            <h1 className="text-xl font-bold">Employee Documents</h1>
            <p className="text-sm text-white/70 mt-1">
              Employees can view their own documents but never download them — only HR/Admin can here.
            </p>
          </div>
          <div className="flex gap-2 flex-wrap shrink-0">
            <button
              onClick={() => setUploadOpen(true)}
              className="flex items-center gap-1.5 h-10 px-4 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-sm font-semibold transition"
            >
              📤 Upload Document
            </button>
            <button
              onClick={() => setGenerateOpen(true)}
              className="flex items-center gap-1.5 h-10 px-4 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-sm font-semibold transition"
            >
              ✨ Generate Document
            </button>
            <button
              onClick={() => setManageTemplatesOpen(true)}
              className="flex items-center gap-1.5 h-10 px-4 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-sm font-semibold transition"
            >
              📝 Manage Templates
            </button>
          </div>
        </div>
      </motion.div>

      {uploadOpen && (
        <div className="rounded-2xl bg-white border border-slate-100 shadow-md p-5 space-y-3">
          <p className="text-sm font-bold text-slate-800">Upload Document</p>
          <div className="flex flex-wrap gap-2">
            <select
              value={uploadEmployeeId}
              onChange={(e) => setUploadEmployeeId(e.target.value)}
              className="h-10 rounded-xl bg-slate-50 border border-slate-200 px-3 text-xs font-semibold text-slate-600 outline-none"
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
              className="h-10 rounded-xl bg-slate-50 border border-slate-200 px-3 text-xs font-semibold text-slate-600 outline-none"
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
              className="h-10 flex-1 min-w-[200px] rounded-xl bg-slate-50 border border-slate-200 px-3 text-xs outline-none"
            />
            <input
              type="file"
              onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
              className="text-xs"
            />
          </div>
          <div className="flex gap-2">
            <button
              disabled={uploading}
              onClick={handleUpload}
              className="h-10 px-4 rounded-xl text-xs font-bold bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-60 transition"
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

      {manageTemplatesOpen && (
        <div className="rounded-2xl bg-white border border-slate-100 shadow-md p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-bold text-slate-800">Manage Templates</p>
            <button onClick={() => setManageTemplatesOpen(false)} className="text-xs font-bold text-slate-400 hover:text-slate-600">
              Close
            </button>
          </div>

          <div className="space-y-2">
            <input
              value={templateTitle}
              onChange={(e) => setTemplateTitle(e.target.value)}
              placeholder="Template title (e.g. Offer Letter)"
              className="h-10 w-full rounded-xl bg-slate-50 border border-slate-200 px-3 text-xs outline-none"
            />
            <textarea
              value={templateBody}
              onChange={(e) => setTemplateBody(e.target.value)}
              placeholder={"Template body. Use {{employee_name}}, {{department}}, {{role}}, {{email}}, {{today_date}} for auto-filled fields, or any other {{token}} (e.g. {{position}}, {{joining_date}}) to be filled in manually when generating."}
              rows={6}
              className="w-full rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-xs outline-none font-mono"
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
                  <span>✅ Letterhead image set.</span>
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
                className="h-10 px-4 rounded-xl text-xs font-bold bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-60 transition"
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
                    <button onClick={() => handleDeleteTemplate(t.id)} className="text-xs font-bold px-3 py-1 rounded-full bg-red-50 text-red-600 hover:bg-red-100">
                      Delete
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {generateOpen && (
        <div className="rounded-2xl bg-white border border-slate-100 shadow-md p-5 space-y-3">
          <p className="text-sm font-bold text-slate-800">Generate Document from Template</p>
          <div className="flex flex-wrap gap-2">
            <select
              value={generateTemplateId}
              onChange={(e) => setGenerateTemplateId(e.target.value)}
              className="h-10 rounded-xl bg-slate-50 border border-slate-200 px-3 text-xs font-semibold text-slate-600 outline-none"
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
              className="h-10 rounded-xl bg-slate-50 border border-slate-200 px-3 text-xs font-semibold text-slate-600 outline-none"
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
              className="h-10 rounded-xl bg-slate-50 border border-slate-200 px-3 text-xs font-semibold text-slate-600 outline-none"
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
              className="h-10 flex-1 min-w-[220px] rounded-xl bg-slate-50 border border-slate-200 px-3 text-xs outline-none"
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
              className="h-10 px-4 rounded-xl text-xs font-bold bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-60 transition"
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

      <select
        value={employeeFilter}
        onChange={(e) => setEmployeeFilter(e.target.value)}
        className="h-10 rounded-xl bg-white border border-slate-200 px-3 text-xs font-semibold text-slate-600 outline-none"
      >
        <option value="">All Employees</option>
        {employees.map((emp) => (
          <option key={emp.id} value={emp.id}>
            {emp.name}
          </option>
        ))}
      </select>

      {loading ? (
        <p className="text-sm text-slate-400 px-1">Loading...</p>
      ) : visibleDocuments.length === 0 ? (
        <p className="text-sm text-slate-400 px-1">No documents yet.</p>
      ) : (
        <div className="space-y-3">
          {visibleDocuments.map((doc) => (
            <div key={doc.id} className="rounded-2xl bg-white border border-slate-100 shadow-[0_2px_10px_rgba(15,23,42,0.05)] p-4 flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-slate-800">{doc.label}</p>
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                    {DOCUMENT_TYPE_LABELS[doc.document_type] || doc.document_type}
                  </span>
                  {doc.is_generated && (
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600">Generated</span>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  {doc.employee?.name || "Unknown employee"} · uploaded by {doc.uploaded_by?.name || "—"} on{" "}
                  {new Date(doc.created_at).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => handleDownload(doc)}
                  className="text-xs font-bold px-3 py-1.5 rounded-full bg-teal-50 text-teal-700 hover:bg-teal-100"
                >
                  Download
                </button>
                <button
                  onClick={() => handleDelete(doc)}
                  className="text-xs font-bold px-3 py-1.5 rounded-full bg-red-50 text-red-600 hover:bg-red-100"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
