"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import EmployeeTabBar from "@/components/EmployeeTabBar";
import HrDocumentViewer from "@/components/HrDocumentViewer";

interface DocumentRow {
  id: string;
  document_type: string;
  label: string;
  file_mime_type: string;
  created_at: string;
}

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  AADHAR: "Aadhar",
  PAN: "PAN",
  OFFER_LETTER: "Offer Letter",
  EXPERIENCE_LETTER: "Experience Letter",
  EDUCATIONAL: "Educational",
  OTHER: "Other"
};

// Own top-level route, mirrors app/tickets/page.tsx exactly (same
// inline auth-check block, no shared employee layout exists yet).
// View-only by construction, not just by convention -- the list below
// only ever renders a "View" button that opens HrDocumentViewer; there
// is no download affordance anywhere on this page, no href/src pointing
// at a real file. Documents were uploaded by HR, never self-uploaded
// (no upload UI exists here at all).
export default function DocumentsPage() {
  const router = useRouter();

  const [employee, setEmployee] = useState<any>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewingDoc, setViewingDoc] = useState<DocumentRow | null>(null);

  async function loadDocuments(employeeId: string) {
    const { data: docs } = await supabase
      .from("hr_documents")
      .select("id, document_type, label, file_mime_type, created_at")
      .eq("employee_id", employeeId)
      .order("created_at", { ascending: false });

    setDocuments(docs || []);
  }

  useEffect(() => {
    async function getLoggedInEmployee() {
      const {
        data: { user }
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace("/login");
        return;
      }

      const { data, error } = await supabase.from("employees").select("*").eq("auth_user_id", user.id).single();

      if (error || !data) {
        console.error("Employee not found");
        return;
      }

      if (!data.is_active) {
        await supabase.auth.signOut();
        router.replace("/login");
        return;
      }

      if (data.role === "admin") {
        router.replace("/admin");
        return;
      }

      setEmployee(data);
      setAuthChecked(true);

      await loadDocuments(data.id);
      setLoading(false);
    }

    getLoggedInEmployee();
  }, []);

  if (!authChecked) {
    return <div className="min-h-screen bg-white" />;
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-white via-blue-50 to-blue-100">
      <Header />
      <EmployeeTabBar role={employee?.role} department={employee?.department} />

      <div className="px-4 mt-4 space-y-3 pb-6">
        <div className="rounded-2xl bg-white border border-slate-100 shadow-md p-4">
          <p className="text-sm font-bold text-slate-800">My Documents</p>
          <p className="text-xs text-slate-500 mt-0.5">
            These are view-only — uploaded by HR, and cannot be downloaded from here.
          </p>
        </div>

        {loading ? (
          <p className="text-sm text-slate-400 px-1">Loading...</p>
        ) : documents.length === 0 ? (
          <p className="text-sm text-slate-400 px-1">No documents yet.</p>
        ) : (
          documents.map((doc) => (
            <div
              key={doc.id}
              className="rounded-2xl bg-white border border-slate-100 shadow-[0_2px_10px_rgba(15,23,42,0.05)] p-4 flex items-center justify-between gap-3"
            >
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-slate-800">{doc.label}</p>
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                    {DOCUMENT_TYPE_LABELS[doc.document_type] || doc.document_type}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  {new Date(doc.created_at).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}
                </p>
              </div>
              <button
                onClick={() => setViewingDoc(doc)}
                className="text-xs font-bold px-3 py-1.5 rounded-full bg-blue-50 text-blue-700 hover:bg-blue-100"
              >
                View
              </button>
            </div>
          ))
        )}
      </div>

      {viewingDoc && (
        <HrDocumentViewer
          documentId={viewingDoc.id}
          label={viewingDoc.label}
          fileMimeType={viewingDoc.file_mime_type}
          employeeName={employee?.name || ""}
          onClose={() => setViewingDoc(null)}
          onNotFound={() => employee?.id && loadDocuments(employee.id)}
        />
      )}

      <Footer />
    </main>
  );
}
