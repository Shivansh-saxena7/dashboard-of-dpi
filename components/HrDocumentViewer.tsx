"use client";

import { useEffect, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface HrDocumentViewerProps {
  documentId: string;
  label: string;
  fileMimeType: string;
  employeeName: string;
  onClose: () => void;
  // Fired when the view-url call fails specifically because the
  // document no longer exists (deleted since the caller's list was
  // last loaded) -- lets the parent page refetch its list so the now-
  // stale entry disappears instead of lingering until a manual reload.
  onNotFound?: () => void;
}

// View-only rendering -- the signed URL from /api/hr-documents/view-url
// never touches an href/src/download attribute here, only pdf.js's/the
// canvas's internal fetch. PDFs render via pdf.js's CORE API (not its
// bundled viewer UI, which has its own download button) onto a
// <canvas>; a canvas has no built-in "save as" affordance the way an
// <img> does. Images go through an off-screen Image -> drawImage for
// the same reason. A watermark is burned into the canvas pixels
// themselves, not overlaid as a separate DOM element, so it survives
// any screenshot. Right-click is disabled on the canvas as a further
// deterrent -- honestly not a 100% guarantee (nothing client-side ever
// is), same limitation already documented for the Project Asset
// Library's own watermark protections, just raising the bar
// significantly against casual/accidental download.
export default function HrDocumentViewer({ documentId, label, fileMimeType, employeeName, onClose, onNotFound }: HrDocumentViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfDocRef = useRef<any>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const [numPages, setNumPages] = useState(1);

  function drawWatermark(ctx: CanvasRenderingContext2D, width: number, height: number) {
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = "#1e293b";
    ctx.font = "bold 20px sans-serif";
    ctx.textAlign = "center";
    ctx.translate(width / 2, height / 2);
    ctx.rotate(-Math.PI / 6);
    ctx.fillText(`${employeeName} · View Only · ${new Date().toLocaleString()}`, 0, 0);
    ctx.restore();
  }

  async function renderPdfPage(page: number) {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !pdfDocRef.current) return;

    const pdfPage = await pdfDocRef.current.getPage(page);
    const viewport = pdfPage.getViewport({ scale: 1.5 });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await pdfPage.render({ canvasContext: ctx, viewport }).promise;
    drawWatermark(ctx, canvas.width, canvas.height);
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const {
          data: { session }
        } = await supabase.auth.getSession();

        if (!session) {
          if (!cancelled) {
            setError("Not logged in.");
            setLoading(false);
          }
          return;
        }

        const res = await fetch("/api/hr-documents/view-url", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ documentId })
        });

        const body = await res.json();

        if (!res.ok || !body.url) {
          if (!cancelled) {
            const isNotFound = typeof body.error === "string" && body.error.includes("not found");
            setError(isNotFound ? "This document is no longer available." : body.error || "Could not load this document.");
            setLoading(false);
            if (isNotFound) onNotFound?.();
          }
          return;
        }

        if (cancelled) return;

        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx) return;

        if (fileMimeType === "application/pdf") {
          const pdfjsLib = await import("pdfjs-dist");
          pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

          // pdf.js v6's getDocument() reads src.url/src.data/src.range as
          // OBJECT PROPERTIES -- it no longer auto-treats a bare string
          // as the url (confirmed by reading node_modules/pdfjs-dist's
          // own source: `function getDocument(src = {})` immediately
          // reads src.docBaseUrl etc.). Passing the string directly was
          // the exact root cause of "expected either data, range, or
          // url parameter" -- the API response itself was already
          // correct (verified separately), this was purely this call's
          // parameter shape.
          const pdf = await pdfjsLib.getDocument({ url: body.url }).promise;
          if (cancelled) return;

          pdfDocRef.current = pdf;
          setNumPages(pdf.numPages);
          setPageNum(1);
          await renderPdfPage(1);
        } else {
          const img = new Image();
          img.crossOrigin = "anonymous";
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error("Could not load image."));
            img.src = body.url;
          });

          if (cancelled) return;

          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          ctx.drawImage(img, 0, 0);
          drawWatermark(ctx, canvas.width, canvas.height);
        }

        if (!cancelled) setLoading(false);
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || "Could not load this document.");
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId, fileMimeType]);

  async function goToPage(next: number) {
    if (next < 1 || next > numPages) return;
    setPageNum(next);
    await renderPdfPage(next);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl max-h-[90vh] w-full overflow-auto p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-bold text-slate-800">{label}</p>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        {loading && <p className="text-sm text-slate-400 py-10 text-center">Loading...</p>}
        {error && <p className="text-sm text-red-600 py-10 text-center">{error}</p>}

        <canvas
          ref={canvasRef}
          onContextMenu={(e) => e.preventDefault()}
          className={`w-full h-auto rounded-lg border border-slate-100 select-none ${loading || error ? "hidden" : ""}`}
        />

        {!loading && !error && numPages > 1 && (
          <div className="flex items-center justify-center gap-3 mt-3">
            <button
              onClick={() => goToPage(pageNum - 1)}
              disabled={pageNum <= 1}
              className="p-1.5 rounded-lg bg-slate-100 text-slate-600 disabled:opacity-40"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-xs text-slate-500">
              Page {pageNum} of {numPages}
            </span>
            <button
              onClick={() => goToPage(pageNum + 1)}
              disabled={pageNum >= numPages}
              className="p-1.5 rounded-lg bg-slate-100 text-slate-600 disabled:opacity-40"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}

        <p className="text-[10px] text-slate-400 mt-2 text-center">View only — this document cannot be downloaded here.</p>
      </div>
    </div>
  );
}
