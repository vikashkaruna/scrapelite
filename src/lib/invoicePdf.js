// invoicePdf.js — render an invoice document model to a PDF.
//
// Runs in BOTH runtimes from one implementation:
//   • browser — doc.save(filename) for the download button
//   • Node    — doc.output("arraybuffer") for the Resend attachment
// jsPDF 4.x ships a real Node build (its package exports declare
// "node": "./dist/jspdf.node.min.js"), so no second renderer is needed. Two
// renderers would inevitably drift, and a PDF that disagrees with the emailed
// copy of the same invoice is a support problem on a document people file with
// their accountant.
//
// Keep the lazy `await import("./invoicePdf.js")` at browser call sites so
// jsPDF stays out of the main bundle — same pattern as pdfExport.js.
//
// Layout helpers (advance / write / rule) intentionally mirror pdfExport.js so
// the two read alike.
import { jsPDF } from "jspdf";
import { buildInvoiceDoc } from "./invoiceModel.js";

const MARGIN = 48;
const INK = [32, 34, 44];
const MUTED = [110, 116, 132];
const ACCENT = [79, 70, 229]; // --accent, matches the brand
const HAIRLINE = [225, 227, 233];

// Cache so we don't re-encode the template bytes once per page.
const _invBgCache = new Map();

/** Paint a white-label template (Uint8Array) on the current page. */
function paintTemplateBackground(pdf, templateBytes) {
  if (!templateBytes || !templateBytes.length) return;
  try {
    const id = templateBytes.length + "_" + templateBytes[0] + "_" + templateBytes[templateBytes.length - 1];
    let dataUrl = _invBgCache.get(id);
    if (!dataUrl) {
      let bin = "";
      const chunk = 0x8000;
      for (let i = 0; i < templateBytes.length; i += chunk) {
        bin += String.fromCharCode.apply(null, templateBytes.subarray(i, i + chunk));
      }
      dataUrl = "data:application/pdf;base64," + btoa(bin);
      _invBgCache.set(id, dataUrl);
    }
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    pdf.addImage(dataUrl, "PDF", 0, 0, pageW, pageH);
  } catch {
    // Swallow — a bad template must never break a routine export.
  }
}

/**
 * Make a string safe for jsPDF's built-in helvetica.
 *
 * The base-14 fonts are Type1 with WinAnsi (cp1252) encoding. Anything outside
 * that repertoire does not merely fall back to a placeholder — it corrupts the
 * text run's metrics, so an entire line renders with broken letter-spacing.
 * A rupee sign (U+20B9) and an arrow (U+2192) both did exactly that during
 * development, and neither is visible to a string-equality test: you only see
 * it by rendering the page.
 *
 * Common typography is transliterated rather than dropped so copy still reads
 * naturally; anything else unknown becomes "?" so it is obvious in review.
 */
export function toPdfSafe(text) {
  return String(text ?? "")
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[→➡]/g, "->")
    .replace(/[←]/g, "<-")
    .replace(/₹/g, "INR ")
    .replace(/[   ]/g, " ")
    .replace(/•/g, "-")
    .replace(/[^\x00-\xFF]/g, "?");
}

/**
 * @param {object} model  result of buildInvoiceDoc()
 * @param {object} [opts]
 * @param {Uint8Array} [opts.template]  white-label PDF template bytes; when
 *   present, the template's first page is rendered as the background of
 *   every page in the invoice. Falls back to a no-op on any jsPDF error.
 * @returns {jsPDF}
 */
export function renderInvoicePdf(model, { template = null } = {}) {
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const contentW = pageW - MARGIN * 2;
  const rightX = pageW - MARGIN;
  let y = MARGIN;

  // Paint the white-label template on the first page before any body text.
  if (template) paintTemplateBackground(pdf, template);

  const advance = (h) => {
    if (y + h > pageH - MARGIN) {
      pdf.addPage();
      if (template) paintTemplateBackground(pdf, template);
      y = MARGIN;
    }
  };

  const write = (text, { size = 10, style = "normal", color = INK, gap = 3, x = MARGIN, w = contentW } = {}) => {
    pdf.setFont("helvetica", style);
    pdf.setFontSize(size);
    pdf.setTextColor(...color);
    const lines = pdf.splitTextToSize(toPdfSafe(text), w);
    const lh = size + 3;
    for (const line of lines) {
      advance(lh);
      pdf.text(line, x, y);
      y += lh;
    }
    y += gap;
  };

  const rule = (gap = 10) => {
    advance(gap);
    pdf.setDrawColor(...HAIRLINE);
    pdf.line(MARGIN, y, rightX, y);
    y += gap;
  };

  const textAt = (text, x, yy, { size = 10, style = "normal", color = INK, align = "left" } = {}) => {
    pdf.setFont("helvetica", style);
    pdf.setFontSize(size);
    pdf.setTextColor(...color);
    pdf.text(toPdfSafe(text), x, yy, { align });
  };

  // ── Header ─────────────────────────────────────────────────────────────────
  textAt("DatIQ", MARGIN, y + 4, { size: 18, style: "bold", color: ACCENT });
  textAt(model.title, rightX, y + 4, { size: 15, style: "bold", align: "right" });
  y += 22;
  textAt("DatIQ — Intelligence from Web", MARGIN, y, { size: 9, color: MUTED });
  textAt(model.invoiceNo, rightX, y, { size: 10, style: "bold", align: "right" });
  y += 14;
  rule();

  // ── Parties, side by side ──────────────────────────────────────────────────
  const colW = (contentW - 24) / 2;
  const partyTop = y;
  textAt("From", MARGIN, y, { size: 8, style: "bold", color: MUTED });
  textAt("Billed to", MARGIN + colW + 24, y, { size: 8, style: "bold", color: MUTED });
  y += 13;

  const leftLines = model.supplier.lines;
  const rightLines = model.buyer.lines;
  const rows = Math.max(leftLines.length, rightLines.length);
  for (let i = 0; i < rows; i += 1) {
    advance(12);
    if (leftLines[i]) {
      textAt(leftLines[i], MARGIN, y, { size: 9, style: i === 0 ? "bold" : "normal" });
    }
    if (rightLines[i]) {
      textAt(rightLines[i], MARGIN + colW + 24, y, { size: 9, style: i === 0 ? "bold" : "normal" });
    }
    y += 12;
  }
  y = Math.max(y, partyTop + 40) + 6;
  rule();

  // ── Metadata ───────────────────────────────────────────────────────────────
  for (const m of model.meta) {
    advance(13);
    textAt(m.label, MARGIN, y, { size: 9, color: MUTED });
    textAt(m.value, MARGIN + 130, y, { size: 9 });
    y += 13;
  }
  y += 4;
  rule();

  // ── Line items ─────────────────────────────────────────────────────────────
  // Column x-positions. HSN/SAC only exists on a tax invoice, so the layout
  // shifts rather than leaving an empty column on a receipt.
  const showSac = model.isTaxInvoice;
  const xDesc = MARGIN;
  const xSac = MARGIN + contentW - 210;
  const xQty = MARGIN + contentW - 110;
  const xAmt = rightX;

  advance(16);
  textAt("Description", xDesc, y, { size: 8, style: "bold", color: MUTED });
  if (showSac) textAt("SAC", xSac, y, { size: 8, style: "bold", color: MUTED });
  textAt("Qty", xQty, y, { size: 8, style: "bold", color: MUTED });
  textAt("Amount", xAmt, y, { size: 8, style: "bold", color: MUTED, align: "right" });
  y += 6;
  rule(6);

  for (const line of model.lines) {
    advance(16);
    const descW = (showSac ? xSac : xQty) - xDesc - 12;
    const wrapped = pdf.splitTextToSize(toPdfSafe(line.description), descW);
    const startY = y;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9.5);
    pdf.setTextColor(...(line.isCredit ? MUTED : INK));
    wrapped.forEach((w, i) => {
      pdf.text(w, xDesc, startY + i * 12);
    });
    if (showSac && line.hsnSac) textAt(line.hsnSac, xSac, startY, { size: 9, color: MUTED });
    textAt(String(line.qty), xQty, startY, { size: 9 });
    textAt(line.amountText, xAmt, startY, {
      size: 9.5,
      align: "right",
      color: line.isCredit ? MUTED : INK,
    });
    y = startY + wrapped.length * 12 + 4;
  }

  rule(8);

  // ── Totals, right-aligned ──────────────────────────────────────────────────
  for (const t of model.totals) {
    advance(t.emphasis ? 20 : 14);
    if (t.emphasis) y += 4;
    textAt(t.label, xQty - 40, y, {
      size: t.emphasis ? 11 : 9.5,
      style: t.emphasis ? "bold" : "normal",
      color: t.emphasis ? INK : MUTED,
    });
    textAt(t.value, xAmt, y, {
      size: t.emphasis ? 11 : 9.5,
      style: t.emphasis ? "bold" : "normal",
      align: "right",
    });
    y += t.emphasis ? 18 : 14;
  }

  y += 8;
  rule();

  // ── Notes ──────────────────────────────────────────────────────────────────
  for (const note of model.notes) {
    write(note, { size: 8.5, color: MUTED, gap: 2 });
  }

  return pdf;
}

/** Filename-safe form of an invoice number: DTQ/26-27/000123 → DTQ-26-27-000123. */
export function invoiceFilename(invoiceNo) {
  return `${String(invoiceNo || "invoice").replace(/[^\w-]+/g, "-")}.pdf`;
}

/** Browser: trigger a download. */
export function downloadInvoicePdf(invoice, lines, opts = {}) {
  const model = buildInvoiceDoc(invoice, lines);
  renderInvoicePdf(model, opts).save(invoiceFilename(invoice.invoice_no));
}

/** Server: raw bytes for an email attachment. */
export function invoicePdfBuffer(invoice, lines, opts = {}) {
  const model = buildInvoiceDoc(invoice, lines);
  return renderInvoicePdf(model, opts).output("arraybuffer");
}
