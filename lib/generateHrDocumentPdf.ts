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
  // The existing internal unique employee id (employees.id) -- always
  // present, read-only, never HR-entered and never overwritten. A
  // genuinely separate field from employeeCode below: this is the
  // system's own identifier, that one is HR's short human-readable code.
  systemId: string;
  // Payroll master data (employee_payroll_details) -- employeeCode is
  // mandatory (enforced both by a DB CHECK constraint on the table and
  // by the caller before it ever gets here -- see
  // app/hr/salary/page.tsx), everything else is optional/free-text.
  employeeCode: string;
  gender?: string | null;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  bankIfscCode?: string | null;
  uanNumber?: string | null;
  pfAccountNumber?: string | null;
  esiNumber?: string | null;
  panNumber?: string | null;
  dateOfJoining?: string | null; // "YYYY-MM-DD"
  workLocation?: string | null;
  employmentType?: string | null;
  employeeGrade?: string | null;
  // Paid/LOP/Total-Working Days -- editable at generation time, default
  // Paid Days = Total Working Days = Days in Month and LOP Days = 0
  // (see app/hr/salary/page.tsx). Real attendance-derived LOP needs an
  // actual payroll policy decision (does a weekly-off count as paid,
  // does a half-day cost 0.5 LOP, there's no leave-balance concept yet)
  // this project doesn't have yet -- same deferred-scope class as
  // PF/ESI/TDS calculation, so this stays a manual override rather
  // than a guessed formula.
  paidDays: number;
  lopDays: number;
  totalWorkingDays: number;
  daysInMonth: number;
  // Pay Date (the actual salary-credit date) -- genuinely distinct
  // from the slip's own generation timestamp, and unlike Paid Days
  // there's no sensible auto-default for it, so it stays blank ("—")
  // until HR actively sets it.
  payDate?: string | null; // "YYYY-MM-DD"
  // Company-wide (not per-employee) registration numbers, from
  // hrms_settings -- shown in the header, blank/"—" until set.
  companyCin?: string | null;
  companyGstin?: string | null;
  // Company logo, pre-fetched by the caller as a data: URL (same
  // "caller resolves the image, this file just draws it" contract as
  // LetterheadImage above). Optional -- a slip renders fine without a
  // logo, just without the small mark next to the company name.
  logoDataUrl?: string;
}

// Indian-style (lakh/crore) number-to-words for "Net Pay in Words" --
// no existing utility in this codebase does this (checked), so this is
// a small, self-contained, pure addition. Only handles non-negative
// integers, which is all a Net Pay figure ever is.
const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigitWords(n: number): string {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const r = n % 10;
  return TENS[t] + (r ? ` ${ONES[r]}` : "");
}

function threeDigitWords(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${ONES[h]} Hundred`);
  if (r) parts.push(twoDigitWords(r));
  return parts.join(" ");
}

function numberToIndianWords(amount: number): string {
  const n = Math.round(Math.max(0, amount));
  if (n === 0) return "Zero";

  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;

  const parts: string[] = [];
  if (crore) parts.push(`${threeDigitWords(crore)} Crore`);
  if (lakh) parts.push(`${twoDigitWords(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigitWords(thousand)} Thousand`);
  if (rest) parts.push(threeDigitWords(rest));
  return parts.join(" ");
}

// Diagonal "DIVYA PADMA INFOSYSTEM" watermark -- same technique as
// exportTable.ts's drawPdfWatermarkAndPageNumber (45deg, low-opacity
// GState, font scaled so the full run fits within 85% of the band's
// shorter dimension, manually-computed center since jsPDF's align:
// "center" doesn't account for rotation correctly). Not a call to that
// function directly: it also draws a page-number footer this compact
// slip doesn't want, and its text is the full "...LLP" company name,
// not the shorter mark requested for this document specifically.
//
// Takes an explicit band (bandY/bandHeight/bandWidth) rather than
// reading doc.internal.pageSize -- a single slip's band IS the whole
// page in buildSalarySlipBlob, but in buildBulkSalarySlipPdf it's one
// of 2 stacked bands on a real A4 page, and the watermark must center
// within just that slip, not smear across the whole sheet.
function drawSalarySlipWatermark(doc: import("jspdf").jsPDF, GState: any, bandY: number, bandHeight: number, bandWidth: number) {
  const angleDeg = 45;
  const angleRad = (angleDeg * Math.PI) / 180;
  const text = "DIVYA PADMA INFOSYSTEM";

  doc.saveGraphicsState();
  doc.setGState(new GState({ opacity: 0.12 }));
  doc.setFont("helvetica", "bold");
  doc.setFontSize(60);
  const referenceWidth = doc.getTextWidth(text);
  const maxWidth = (Math.min(bandWidth, bandHeight) * 0.85) / Math.sin(angleRad);
  const fontSize = Math.min(60, 60 * (maxWidth / referenceWidth));
  doc.setFontSize(fontSize);

  const textWidth = doc.getTextWidth(text);
  const cx = bandWidth / 2;
  const cy = bandY + bandHeight / 2;
  const startX = cx - (textWidth / 2) * Math.cos(angleRad);
  const startY = cy + (textWidth / 2) * Math.sin(angleRad);

  doc.setTextColor(...SLATE_500);
  doc.text(text, startX, startY, { angle: angleDeg });
  doc.restoreGraphicsState();
}

// Fixed proportions for one slip (2026-09-27, corrected back from the
// side-by-side portrait attempt) -- A4 portrait page split HORIZONTALLY
// into a top slip and a bottom slip, not vertically into left/right
// columns. Each slip is therefore full A4 width x half A4 height --
// landscape-shaped as its own rectangle (wider than tall), same
// tradeoff the very first version of this layout had. Explicitly
// accepted: keeping the page portrait and the cut horizontal was the
// actual requirement; individual-slip "portraitness" was not. The
// extra height this gives per slip (420.9pt vs the old 3-per-page
// 280.6pt) is spent on more breathing room in the proven 3-column
// grid + side-by-side table layout below, not on a redesign.
// Shared by buildSalarySlipBlob (one slip = the whole page) and
// buildBulkSalarySlipPdf (two stacked slips per A4 page) so the two
// can never drift on size -- an individually-generated slip and a
// bulk-printed one stay pixel-identical.
const SLIP_WIDTH = 595.28;
const SLIPS_PER_PAGE = 2;
const SLIP_HEIGHT = 841.89 / SLIPS_PER_PAGE;
// A real signature box on a printed payslip is a short line/box, not a
// tall block -- ~20pt (~7mm) is enough to actually sign in.
const SIGNATURE_BOX_HEIGHT = 20;

// Draws one complete slip into `doc` at vertical offset `bandY` --
// single owner for the actual slip content/layout, called once (at
// bandY=0, on its own small page) by buildSalarySlipBlob and twice (at
// bandY=0 and SLIP_HEIGHT) per A4 page by buildBulkSalarySlipPdf.
// Every Y coordinate here is bandY-relative, same numbers either
// caller uses, so the two outputs are pixel-identical per slip.
function drawOneSlip(doc: import("jspdf").jsPDF, autoTable: any, GState: any, input: SalarySlipInput, bandY: number) {
  // Print-safe margins -- a real printer's unprintable border
  // (commonly 3-6mm/~8-17pt on consumer inkjet/laser hardware) clips
  // anything drawn too close to the physical page edge, even though it
  // renders fully visible in a PDF viewer, which shows the whole page
  // including that border.
  const M = 18;
  const TOP_MARGIN = 20;

  // Header -- logo (if provided) + company name/address/CIN-GSTIN on
  // the left, "Payslip For the Month of ..." on the right, same
  // baseline pair so the top line stays tight.
  // 28pt still read as small -- the actual drawn image size (the
  // addImage width/height below) is what controls the visible graphic,
  // not surrounding space, so this bumps that directly to 40pt: a real
  // letterhead-scale mark, clearly the dominant header element rather
  // than a small icon next to the text.
  const logoSize = 40;
  let textX = M;
  if (input.logoDataUrl) {
    const format = detectImageFormat(input.logoDataUrl);
    doc.addImage(input.logoDataUrl, format, M, bandY + 4, logoSize, logoSize);
    textX = M + logoSize + 8;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(...SLATE_900);
  doc.text(COMPANY_NAME, textX, bandY + TOP_MARGIN);
  doc.text(`Payslip For the Month of ${input.periodLabel}`, SLIP_WIDTH - M, bandY + TOP_MARGIN, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(...SLATE_500);
  // Same address used in send-hr-email/index.ts's own signature block.
  doc.text("F-417, 4th Floor, Artha Mart, Techzone IV, Greater Noida West", textX, bandY + TOP_MARGIN + 9);

  const cinGstinLine = [input.companyCin ? `CIN: ${input.companyCin}` : null, input.companyGstin ? `GSTIN: ${input.companyGstin}` : null]
    .filter(Boolean)
    .join("   ");
  if (cinGstinLine) {
    doc.text(cinGstinLine, textX, bandY + TOP_MARGIN + 17);
  }

  doc.setDrawColor(...SLATE_200);
  doc.setLineWidth(0.75);
  const headerRuleY = bandY + TOP_MARGIN + (cinGstinLine ? 26 : 18);
  doc.line(M, headerRuleY, SLIP_WIDTH - M, headerRuleY);

  // Employee info grid -- three columns (identity/IDs, employment
  // context, bank/statutory), deliberately uneven length -- there's no
  // requirement every column holds the same number of fields, only
  // that the tallest one sets the grid's height. A/C # and IFSC share
  // one row (label "A/C # / IFSC") rather than each getting their own
  // -- they're conventionally read together on a real payslip anyway.
  doc.setFontSize(6.5);
  const col1X = M;
  const col2X = M + 185;
  const col3X = M + 372;
  const valueOffset = 54;
  const rowStep = 9;
  let infoY = headerRuleY + 12;

  const col1Rows: [string, string][] = [
    ["System ID", input.systemId],
    ["Employee Code", input.employeeCode || "—"],
    ["Employee Name", input.employeeName],
    ["Department", input.department || "—"],
    ["Designation", input.role],
    ["Gender", input.gender || "—"]
  ];
  const col2Rows: [string, string][] = [
    ["Emp. Type", input.employmentType || "—"],
    ["Grade", input.employeeGrade || "—"],
    ["Work Location", input.workLocation || "—"],
    [
      "Date of Joining",
      input.dateOfJoining ? new Date(input.dateOfJoining).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" }) : "—"
    ]
  ];
  const acIfsc = [input.bankAccountNumber, input.bankIfscCode ? `IFSC ${input.bankIfscCode}` : null].filter(Boolean).join("  ") || "—";
  const col3Rows: [string, string][] = [
    ["Bank Name", input.bankName || "—"],
    ["A/C # / IFSC", acIfsc],
    ["UAN #", input.uanNumber || "—"],
    ["PF A/C #", input.pfAccountNumber || "—"],
    ["ESI #", input.esiNumber || "—"],
    ["PAN #", input.panNumber || "—"]
  ];

  const columns = [
    { x: col1X, rows: col1Rows, maxWidth: col2X - col1X - valueOffset - 6 },
    { x: col2X, rows: col2Rows, maxWidth: col3X - col2X - valueOffset - 6 },
    { x: col3X, rows: col3Rows, maxWidth: SLIP_WIDTH - M - col3X - valueOffset }
  ];
  const infoRowCount = Math.max(col1Rows.length, col2Rows.length, col3Rows.length);

  for (const col of columns) {
    for (let i = 0; i < col.rows.length; i++) {
      const rowY = infoY + i * rowStep;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.5);
      doc.text(`${col.rows[i][0]}:`, col.x, rowY);
      doc.setFont("helvetica", "normal");
      // System ID is a full UUID (~36 chars) -- smaller font than the
      // rest of the grid so it fits on one line instead of wrapping
      // and colliding with the row below.
      doc.setFontSize(col.rows[i][0] === "System ID" ? 5 : 6.5);
      doc.text(col.rows[i][1], col.x + valueOffset, rowY, { maxWidth: col.maxWidth });
    }
  }
  infoY += infoRowCount * rowStep + 5;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  const payDateLabel = input.payDate
    ? new Date(input.payDate).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" })
    : "—";
  doc.text(`Paid Days: ${input.paidDays}`, col1X, infoY);
  doc.text(`LOP Days: ${input.lopDays}`, col1X + 90, infoY);
  doc.text(`Working Days: ${input.totalWorkingDays}`, col1X + 175, infoY);
  doc.text(`Days in Month: ${input.daysInMonth}`, col1X + 290, infoY);
  doc.text(`Pay Date: ${payDateLabel}`, col1X + 410, infoY);

  doc.setDrawColor(...SLATE_200);
  doc.setLineWidth(0.5);
  const infoRuleY = infoY + 7;
  doc.line(M, infoRuleY, SLIP_WIDTH - M, infoRuleY);

  const tableStartY = infoRuleY + 6;

  // Earnings/Deductions -- real reference-template field list. Only
  // Basic carries the real employee_compensation figure; every other
  // row is a hardcoded 0 (no PF/ESI/TDS calculation logic -- deferred,
  // real-world-spec-needed work, same as the commission/arrears logic
  // already deferred). Basic = the whole of Gross/Total Earnings until
  // a real allowance system exists. Reimbursements and LWF get the
  // exact same treatment as every other non-Basic row -- a real
  // amount for either needs a real policy/expense-tracking source
  // this project doesn't have yet, same as the rest.
  const earnings: [string, string][] = [
    ["Basic", formatINR(input.basicPay)],
    ["HRA", formatINR(0)],
    ["Special Allowance", formatINR(0)],
    ["Other Earnings", formatINR(0)],
    ["Incentives", formatINR(0)],
    ["Bonus", formatINR(0)],
    ["Over Time Pay", formatINR(0)],
    ["Reimbursements", formatINR(0)]
  ];
  const totalEarnings = input.basicPay;

  const deductions: [string, string][] = [
    ["Provident Fund", formatINR(0)],
    ["ESI", formatINR(0)],
    ["Professional Tax", formatINR(0)],
    ["Salary Advance", formatINR(0)],
    ["TDS", formatINR(0)],
    ["LWF", formatINR(0)],
    ["Other Deduction", formatINR(0)]
  ];
  const totalDeductions = 0;

  // Earnings and Deductions side by side in one grid -- padded to
  // equal length so the two columns line up row-for-row rather than
  // trailing off independently. All 4 columns get an explicit
  // cellWidth -- leaving the label columns at 'auto' width, tried
  // earlier, collapsed them to ~25pt ('auto' sizes to a minimal
  // content guess, not "fill remaining space").
  const rowCount = Math.max(earnings.length, deductions.length);
  const body: string[][] = [];
  for (let i = 0; i < rowCount; i++) {
    const [eLabel, eAmt] = earnings[i] || ["", ""];
    const [dLabel, dAmt] = deductions[i] || ["", ""];
    body.push([eLabel, eAmt, dLabel, dAmt]);
  }
  body.push(["Total Earnings", formatINR(totalEarnings), "Total Deductions", formatINR(totalDeductions)]);

  autoTable(doc, {
    startY: tableStartY,
    theme: "grid",
    head: [["Earnings", "Amount", "Deductions", "Amount"]],
    body,
    styles: { ...PDF_TABLE_STYLES, fontSize: 6.5, cellPadding: 2.5 },
    headStyles: { ...PDF_HEAD_STYLES, fontSize: 6.5 },
    columnStyles: {
      0: { halign: "left", cellWidth: 212 },
      1: { halign: "right", cellWidth: 70 },
      2: { halign: "left", cellWidth: 212 },
      3: { halign: "right", cellWidth: 70 }
    },
    margin: { left: M, right: M },
    didParseCell: (data: any) => {
      if (data.section === "body" && data.row.index === rowCount) data.cell.styles.fontStyle = "bold";
    }
  });

  const grossSalary = totalEarnings;
  const netPay = totalEarnings - totalDeductions;

  let summaryY = (doc as any).lastAutoTable.finalY + 11;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...SLATE_900);
  doc.text(`Gross Salary: Rs. ${formatINR(grossSalary)}`, M, summaryY);

  summaryY += 11;
  doc.setFontSize(9.5);
  doc.text(`Net Pay: Rs. ${formatINR(netPay)}`, M, summaryY);

  summaryY += 9;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...SLATE_500);
  doc.text(`Net Pay in Words: ${numberToIndianWords(netPay)} Rupees Only`, M, summaryY, { maxWidth: SLIP_WIDTH - M * 2 });

  // Signature boxes sit directly below the Net Pay summary, sized like
  // a real signature box (SIGNATURE_BOX_HEIGHT) rather than stretched
  // to fill whatever space happens to be left in the band.
  const boxY = summaryY + 10;
  const boxWidth = (SLIP_WIDTH - M * 2 - 16) / 2;
  const boxHeight = SIGNATURE_BOX_HEIGHT;

  doc.setDrawColor(...SLATE_200);
  doc.setLineWidth(0.5);
  doc.rect(M, boxY, boxWidth, boxHeight);
  doc.rect(M + boxWidth + 16, boxY, boxWidth, boxHeight);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(...SLATE_500);
  doc.text("Accounts Signature", M, boxY + boxHeight + 9);
  doc.text("Employee Signature", M + boxWidth + 16, boxY + boxHeight + 9);

  // Watermark drawn LAST, on top of everything else in this band --
  // real bug fix (2026-09-27): drawing it first meant the table's own
  // opaque header fill and body cell backgrounds, painted afterward,
  // covered whatever part of the diagonal watermark text fell under
  // them. Its own low GState opacity means drawing it on top still
  // leaves the table/grid beneath fully readable.
  drawSalarySlipWatermark(doc, GState, bandY, SLIP_HEIGHT, SLIP_WIDTH);
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
//
// Page size (2026-09-27, corrected back to horizontal stacking) -- the
// A4 sheet stays portrait, but is split HORIZONTALLY into a top slip
// and a bottom slip (not vertically into side-by-side columns, which
// an intermediate pass here briefly tried). Each slip is its own
// full-width x half-height band as a result -- landscape-shaped as a
// standalone rectangle, a deliberately accepted tradeoff for keeping
// the page-level cut horizontal. Isolated to this function (and
// drawOneSlip) only: its own local margin/font-size constants, never
// the shared MARGIN/LINE_HEIGHT/SLATE_* used by buildHrDocumentBlob
// (Offer/Appointment Letter stay A4 portrait, untouched).
//
// `orientation: "landscape"` is required even though a custom [w, h]
// array is passed -- without it jsPDF silently falls back to a tall
// portrait page and ignores the array's proportions (SLIP_WIDTH >
// SLIP_HEIGHT here, same reason this was needed the first time this
// layout existed).
export async function buildSalarySlipBlob(input: SalarySlipInput): Promise<Blob> {
  const { jsPDF, GState } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: [SLIP_WIDTH, SLIP_HEIGHT] });
  drawOneSlip(doc, autoTable, GState, input, 0);

  return doc.output("blob");
}

// Bulk Print -- a separate, print-only convenience layered on top of
// the individual flow above, per the approved design: it does NOT
// touch hr_documents (no upload, no register_hr_document_atomic call
// anywhere in this function) and does NOT change how an individually-
// generated slip is stored or viewed. It exists purely to lay several
// employees' slips onto shared, directly-printable A4 sheets instead
// of HR handling one page per employee. Reuses drawOneSlip verbatim,
// so a slip drawn here is pixel-identical to the same employee's
// individually archived one -- bulk printing can never silently drift
// into a different-looking document.
//
// Two slips stacked top/bottom per A4 page, separated by a horizontal
// dashed cut-line.
export async function buildBulkSalarySlipPdf(slips: SalarySlipInput[]): Promise<Blob> {
  const { jsPDF, GState } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });

  slips.forEach((input, i) => {
    const bandIndex = i % SLIPS_PER_PAGE;
    if (i > 0 && bandIndex === 0) doc.addPage();

    const bandY = bandIndex * SLIP_HEIGHT;
    drawOneSlip(doc, autoTable, GState, input, bandY);

    // Cut-line between the two stacked slips (not above the first one,
    // which is the sheet's own top edge) -- a dashed rule so HR can
    // cut the sheet into individual slips cleanly.
    if (bandIndex > 0) {
      doc.setDrawColor(...SLATE_200);
      doc.setLineWidth(0.5);
      doc.setLineDashPattern([2, 2], 0);
      doc.line(0, bandY, SLIP_WIDTH, bandY);
      doc.setLineDashPattern([], 0);
    }
  });

  return doc.output("blob");
}
