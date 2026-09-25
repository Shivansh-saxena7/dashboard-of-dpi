import { COMPANY_NAME, PDF_TABLE_STYLES, PDF_HEAD_STYLES, formatINR } from "@/lib/exportTable";

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

// Letterhead-mode vertical positions (2026-09-24) — tuned against the
// real letterhead image (1655x2340px @ 200dpi -> 595x842pt A4, so
// 2.779px/pt). Measured directly from that image: the header's own
// art (logo + company name + rule) ends around y=177pt; the footer
// chrome (a "HR SIGNATURE" line + rule + contact-info strip) starts
// around y=751pt. These values keep body content inside that ~180pt
// to ~720pt window, clear of both.
const LETTERHEAD_DATE_Y = 200;
const LETTERHEAD_TITLE_Y = 235;
const LETTERHEAD_BODY_START_Y = 265;
const LETTERHEAD_BOTTOM_MARGIN = 120;

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

// A full-res (1655x2340px) letterhead stored as PNG embeds near-
// losslessly in jsPDF -- that's what made every generated letter
// ~11MB (discovered 2026-09-25 when it crashed send-hr-email's base64
// step). Re-encoding to JPEG before addImage() gets real compression
// on the same visual content, no template re-upload needed. White
// fill first because JPEG has no alpha channel -- a transparent PNG
// region would otherwise render black instead of matching the page.
function convertToJpeg(dataUrl: string, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas 2D context unavailable"));
        return;
      }
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => reject(new Error("Could not load letterhead image for JPEG conversion"));
    img.src = dataUrl;
  });
}

function drawPlainPageNumber(doc: import("jspdf").jsPDF, pageNumber: number) {
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...SLATE_500);
  doc.text(`Page ${pageNumber}`, pw - 20, ph - 15, { align: "right" });
}

// Shared by every generated-PDF builder in this file (offer/appointment
// letters, salary slips) -- one owner for the PNG-to-JPEG compression
// decision so a new document type can't reintroduce the ~11MB bug fixed
// 2026-09-25.
async function prepareLetterhead(letterheadInput?: LetterheadImage): Promise<LetterheadImage | undefined> {
  return letterheadInput && detectImageFormat(letterheadInput.dataUrl) === "PNG"
    ? { dataUrl: await convertToJpeg(letterheadInput.dataUrl, 0.85) }
    : letterheadInput;
}

export async function buildHrDocumentBlob(title: string, bodyText: string, letterheadInput?: LetterheadImage): Promise<Blob> {
  const { jsPDF } = await import("jspdf");

  const letterhead = await prepareLetterhead(letterheadInput);

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

export interface SalarySlipInput {
  employeeName: string;
  department: string | null;
  role: string;
  periodLabel: string; // e.g. "September 2026"
  basicPay: number;
}

// Plain payslip form (2026-09-25) -- deliberately NOT letterhead-based,
// unlike the other generated documents in this file: HR wants this one
// printed, hand-signed by Accounts and the employee, then the signed
// scan uploaded back in as the real record (see the upload flow in
// app/hr/salary/page.tsx). A full-bleed letterhead image would fight
// with that physical-signature workflow, so this stays a plain bordered
// form instead. Named allowance/deduction rows are shown at Rs. 0
// rather than omitted, because this company has no allowance system
// yet -- Basic Pay is the whole of Gross Salary (see
// HRMS_MASTER_PLAN.md's Salary Slip scope note). A real allowance
// later only ever changes these two body arrays, never the layout.
export async function buildSalarySlipBlob(input: SalarySlipInput): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(...SLATE_900);
  doc.text(COMPANY_NAME, pageWidth / 2, 55, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...SLATE_500);
  doc.text("Real Estate Consultancy", pageWidth / 2, 70, { align: "center" });

  doc.setDrawColor(...SLATE_200);
  doc.setLineWidth(1);
  doc.line(MARGIN, 82, pageWidth - MARGIN, 82);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...SLATE_900);
  doc.text(`SALARY SLIP — ${input.periodLabel.toUpperCase()}`, pageWidth / 2, 104, { align: "center" });

  let y = 132;
  doc.setFontSize(10);
  const infoRows: [string, string, string, string][] = [
    ["Employee Name", input.employeeName, "Pay Period", input.periodLabel],
    ["Designation", input.role, "Date of Issue", new Date().toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" })],
    ["Department", input.department || "—", "", ""]
  ];
  const col2X = MARGIN + 260;
  for (const [label1, value1, label2, value2] of infoRows) {
    doc.setFont("helvetica", "bold");
    doc.text(`${label1}:`, MARGIN, y);
    doc.setFont("helvetica", "normal");
    doc.text(value1, MARGIN + 90, y);
    if (label2) {
      doc.setFont("helvetica", "bold");
      doc.text(`${label2}:`, col2X, y);
      doc.setFont("helvetica", "normal");
      doc.text(value2, col2X + 90, y);
    }
    y += LINE_HEIGHT + 4;
  }
  y += 8;

  const earnings: [string, string][] = [
    ["Basic Pay", formatINR(input.basicPay)],
    ["House Rent Allowance (HRA)", formatINR(0)],
    ["Conveyance Allowance", formatINR(0)],
    ["Special Allowance", formatINR(0)],
    ["Other Allowance", formatINR(0)]
  ];
  const grossEarnings = input.basicPay;

  const deductions: [string, string][] = [
    ["Provident Fund (PF)", formatINR(0)],
    ["Professional Tax", formatINR(0)],
    ["TDS", formatINR(0)],
    ["Other Deductions", formatINR(0)]
  ];
  const totalDeductions = 0;

  // Earnings and Deductions side by side in one grid, the standard
  // payslip layout -- padded to equal length so the two columns line
  // up row-for-row rather than trailing off independently.
  const rowCount = Math.max(earnings.length, deductions.length);
  const body: string[][] = [];
  for (let i = 0; i < rowCount; i++) {
    const [eLabel, eAmt] = earnings[i] || ["", ""];
    const [dLabel, dAmt] = deductions[i] || ["", ""];
    body.push([eLabel, eAmt, dLabel, dAmt]);
  }
  body.push(["Gross Earnings", formatINR(grossEarnings), "Total Deductions", formatINR(totalDeductions)]);

  autoTable(doc, {
    startY: y,
    theme: "grid",
    head: [["Earnings", "Amount (Rs.)", "Deductions", "Amount (Rs.)"]],
    body,
    styles: PDF_TABLE_STYLES,
    headStyles: PDF_HEAD_STYLES,
    columnStyles: {
      0: { halign: "left" },
      1: { halign: "right", cellWidth: 80 },
      2: { halign: "left" },
      3: { halign: "right", cellWidth: 80 }
    },
    margin: { left: MARGIN, right: MARGIN },
    didParseCell: (data) => {
      if (data.section === "body" && data.row.index === rowCount) data.cell.styles.fontStyle = "bold";
    }
  });

  const netPayY = (doc as any).lastAutoTable.finalY + 24;
  const netPay = grossEarnings - totalDeductions;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11.5);
  doc.setTextColor(...SLATE_900);
  doc.text(`Net Pay: Rs. ${formatINR(netPay)}`, MARGIN, netPayY);

  // Signature boxes -- this form is meant to be printed and physically
  // signed (Accounts + employee), then the signed scan uploaded back in
  // as the real record via app/hr/salary/page.tsx's upload flow.
  const boxY = pageHeight - 130;
  const boxWidth = (pageWidth - MARGIN * 2 - 30) / 2;
  const boxHeight = 60;

  doc.setDrawColor(...SLATE_200);
  doc.setLineWidth(1);
  doc.rect(MARGIN, boxY, boxWidth, boxHeight);
  doc.rect(MARGIN + boxWidth + 30, boxY, boxWidth, boxHeight);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...SLATE_500);
  doc.text("Accounts Signature", MARGIN, boxY + boxHeight + 14);
  doc.text("Employee Signature", MARGIN + boxWidth + 30, boxY + boxHeight + 14);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...SLATE_500);
  doc.text("This is a system-generated salary slip.", MARGIN, pageHeight - 40);

  drawPlainPageNumber(doc, 1);

  return doc.output("blob");
}
