import { COMPANY_NAME } from "@/lib/exportTable";

// Renders a generated HR document (offer letter, experience letter,
// etc.) as a clean, official-looking PDF -- deliberately NOT reusing
// exportTable.ts's drawPdfWatermarkAndPageNumber, mirroring the exact
// reasoning that function's own Cost-Sheet PDF neighbor already
// documents: every other export in this app is an internal/admin
// report, but this document is handed directly TO the employee (and
// an experience letter is often shown to a future employer) -- a
// diagonal repeated-company-name watermark would read as an internal
// audit document, not the clean official letter it actually is. Still
// reuses the same jsPDF lazy-import idiom and plain page-number footer
// style as the Cost-Sheet PDF, just not its watermark.

const SLATE_900: [number, number, number] = [15, 23, 42];
const SLATE_500: [number, number, number] = [100, 116, 139];
const SLATE_200: [number, number, number] = [226, 232, 240];

const MARGIN = 50;
const LINE_HEIGHT = 16;

// Letterhead-mode vertical positions (2026-09-21) — deliberately more
// generous than the plain-header defaults above, to clear whatever
// header artwork (logo/address/contact strip) HR's own letterhead
// image carries. These are a reasonable starting guess, not measured
// against a real letterhead yet — the first one-line change to make
// once HR's actual image is in hand and something visibly collides.
const LETTERHEAD_DATE_Y = 140;
const LETTERHEAD_TITLE_Y = 175;
const LETTERHEAD_BODY_START_Y = 205;
const LETTERHEAD_BOTTOM_MARGIN = 90;

export interface LetterheadImage {
  // A data: URL (image/png or image/jpeg) — jsPDF's addImage() takes
  // the image bytes directly, not a URL it fetches itself, so the
  // caller is responsible for having already turned the uploaded
  // file into a data URL (e.g. via FileReader / fetch + base64).
  dataUrl: string;
}

function detectImageFormat(dataUrl: string): "PNG" | "JPEG" {
  return dataUrl.startsWith("data:image/png") ? "PNG" : "JPEG";
}

function drawPlainPageNumber(doc: import("jspdf").jsPDF, pageNumber: number) {
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...SLATE_500);
  doc.text(`Page ${pageNumber}`, pw - 20, ph - 15, { align: "right" });
}

export async function buildHrDocumentBlob(title: string, bodyText: string, letterhead?: LetterheadImage): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - MARGIN * 2;

  const letterheadFormat = letterhead ? detectImageFormat(letterhead.dataUrl) : null;

  // Drawn first, before any text, on every page — a real letterhead
  // reads consistently only if it's on every page, not just page 1.
  // Must happen before that page's own text calls below, since jsPDF
  // draws in call order and a background image added after text would
  // paint over it.
  function drawLetterheadBackground() {
    if (letterhead && letterheadFormat) {
      doc.addImage(letterhead.dataUrl, letterheadFormat, 0, 0, pageWidth, pageHeight);
    }
  }

  drawLetterheadBackground();

  if (letterhead) {
    const dateLabel = new Date().toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...SLATE_500);
    doc.text(dateLabel, pageWidth - MARGIN, LETTERHEAD_DATE_Y, { align: "right" });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(...SLATE_900);
    doc.text(title, MARGIN, LETTERHEAD_TITLE_Y);
  } else {
    // Plain text header — unchanged from before letterhead support
    // existed, used whenever a template has no letterhead image set.
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(...SLATE_900);
    doc.text(COMPANY_NAME, MARGIN, 55);

    const dateLabel = new Date().toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...SLATE_500);
    doc.text(dateLabel, pageWidth - MARGIN, 55, { align: "right" });

    doc.setDrawColor(...SLATE_200);
    doc.setLineWidth(1);
    doc.line(MARGIN, 68, pageWidth - MARGIN, 68);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(...SLATE_900);
    doc.text(title, MARGIN, 100);
  }

  let y = letterhead ? LETTERHEAD_BODY_START_Y : 130;
  const bottomMargin = letterhead ? LETTERHEAD_BOTTOM_MARGIN : MARGIN;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.setTextColor(...SLATE_900);

  // Blank lines in the template body (paragraph breaks) are preserved
  // as-is -- splitTextToSize on an empty string collapses to nothing,
  // so each source paragraph is wrapped independently rather than
  // wrapping the whole body as one block, which is what keeps blank
  // lines meaningful in the output.
  const paragraphs = bodyText.split("\n");
  for (const paragraph of paragraphs) {
    const lines = paragraph.trim() === "" ? [""] : doc.splitTextToSize(paragraph, contentWidth);
    for (const line of lines) {
      if (y > pageHeight - bottomMargin) {
        doc.addPage();
        drawLetterheadBackground();
        y = (letterhead ? LETTERHEAD_BODY_START_Y : MARGIN + 20);
      }
      doc.text(line, MARGIN, y);
      y += LINE_HEIGHT;
    }
  }

  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    drawPlainPageNumber(doc, p);
  }

  return doc.output("blob");
}
