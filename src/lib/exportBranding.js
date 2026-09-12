// exportBranding.js — the ONE shared header/footer model for every exported
// file (PDF, Markdown, CSV, JSON) and every report email, across both
// extraction exports and Discoverability audits.
//
// Before this module, each of pdfExport.js, discoverability/auditPdf.js,
// utils.js's markdown/CSV/JSON builders, and discoverability/auditReport.js
// hand-rolled its own header/footer strings independently — inconsistent,
// and in most formats (PDF, CSV) entirely absent. Same pattern as
// invoiceModel.js: one pure context object, computed once, consumed
// identically by every renderer, so the branding can't drift between
// formats the way four separate implementations inevitably would.
//
// PURE — no jsPDF/DOM import at module scope, browser- and Node-safe (the
// same discipline invoiceModel.js follows), so the exact same context object
// can be built in a Netlify function (server-side PDF for an email
// attachment) and in the browser (a Dashboard/Preview/Batch download).
//
// `generatedAt` is always caller-supplied (never Date.now() inside a pure
// function — see invoiceModel.js's own header comment for why: a pure
// builder that reads the clock itself cannot be tested deterministically and
// cannot be re-rendered identically later).

export const BRAND = "DatIQ";
export const SITE_URL = "https://datiq.app";
export const TAGLINE = "Intelligence, Connected.";
export const FAVICON_URL = `${SITE_URL}/favicon.png`;
export const DEFAULT_ACCENT = "#4f46e5"; // --accent, matches the brand
export const LOGO_URL = `${SITE_URL}/favicon.png`;

// The legal entity behind the product. DatIQ is the PRODUCT brand and leads
// every surface; Axiom Minds is the company and signs the footer. Kept as
// constants here — the one place the brand is defined — rather than typed into
// each of the six mail builders, which is how the tagline came to disagree
// with itself across five files.
export const COMPANY = "Axiom Minds Private Limited";
export const COMPANY_URL = "https://axiomminds.ai";

const KIND_TITLES = {
  extraction: "Extraction Report",
  batch: "Batch Extraction Report",
  discoverability: "Discoverability Audit",
};

/** Deterministic UTC formatting — a locale/timezone-dependent format would
 *  render differently on a Node server than in a reader's browser, and a
 *  "generated at" timestamp that disagrees with itself between two views of
 *  the same document is exactly the kind of drift this module exists to
 *  prevent. */
function formatGeneratedLabel(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const datePart = d.toISOString().slice(0, 10); // 2026-08-28
  const timePart = d.toISOString().slice(11, 16); // 14:32
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [y, m, day] = datePart.split("-");
  return `${Number(day)} ${months[Number(m) - 1]} ${y}, ${timePart} UTC`;
}

/**
 * One context object, computed once per export, consumed by every format
 * renderer below.
 *
 * @param {object} opts
 * @param {"extraction"|"batch"|"discoverability"} [opts.kind]
 * @param {string} [opts.title]        overrides the kind's default title
 * @param {string|string[]} [opts.sourceUrls]  what was extracted/audited
 * @param {string} opts.generatedAt    ISO timestamp — always caller-supplied
 * @param {string} [opts.accountLabel] e.g. "alice@example.com · Pro plan"
 * @param {object|null} [opts.brandKit]  a Phase 2 Brand Kit (see
 *   whiteLabelTemplate.js) — null renders the default DatIQ look
 */
export function buildBrandingContext({
  kind = "extraction",
  title = null,
  sourceUrls = null,
  generatedAt,
  accountLabel = null,
  brandKit = null,
} = {}) {
  const sources = Array.isArray(sourceUrls) ? sourceUrls.filter(Boolean) : sourceUrls ? [sourceUrls] : [];
  const kit = brandKit && typeof brandKit === "object" ? brandKit : null;

  return {
    kind,
    title: title || KIND_TITLES[kind] || "Report",
    brand: kit?.companyName?.trim() || BRAND,
    tagline: kit?.tagline?.trim() || (kit?.companyName ? "" : TAGLINE),
    accentColor: kit?.accentColor || DEFAULT_ACCENT,
    logoUrl: kit?.logo?.dataUrl || FAVICON_URL,
    logoIsCustom: Boolean(kit?.logo?.dataUrl),
    source: sources,
    generatedAtISO: generatedAt || null,
    generatedLabel: formatGeneratedLabel(generatedAt),
    accountLabel,
    // A Brand Kit's own footer text (if any) — separate from poweredByLine,
    // which is never suppressible. See the standardization rule below.
    footerText: kit?.footerText?.trim() || null,
    website: kit?.website || null,
    // ALWAYS present, regardless of Brand Kit — a customized/white-label
    // export is additive, never a full removal of DatIQ's own attribution.
    // No field in the Brand Kit schema can suppress this.
    poweredByLine: `Powered by ${BRAND} — ${SITE_URL}`,
  };
}

// ── PDF (jsPDF) ──────────────────────────────────────────────────────────────
// Both functions take the live jsPDF `doc` (already positioned at the current
// page) and return the new `y` cursor position, matching the `advance`-style
// layout helpers pdfExport.js/invoicePdf.js/auditPdf.js already use.

const PDF_MARGIN = 48;
const PDF_INK = [32, 34, 44];
const PDF_MUTED = [110, 116, 132];

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "");
  if (!m) return [79, 70, 229];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

/**
 * Paint the branded header (logo + wordmark + title + source + generated
 * date) at the top of the CURRENT page. Returns the y position body content
 * should start at.
 */
export function brandingPdfHeader(doc, ctx, { toPdfSafe = (s) => String(s ?? "") } = {}) {
  const pageW = doc.internal.pageSize.getWidth();
  const rightX = pageW - PDF_MARGIN;
  const accent = hexToRgb(ctx.accentColor);
  let y = PDF_MARGIN;

  // Logo, if embeddable (raster only — jsPDF cannot embed SVG). A custom
  // Brand Kit logo is trusted to already be a data URL PNG/JPEG (validated on
  // upload); the default DatIQ favicon always is (see exportBrandingAssets.js).
  try {
    doc.addImage(ctx.logoUrl, "PNG", PDF_MARGIN, y - 4, 16, 16);
  } catch {
    // A corrupt/unsupported logo image must never break the export — the
    // wordmark text alone still identifies the document.
  }

  doc.setFont("helvetica", "bold").setFontSize(15);
  doc.setTextColor(...PDF_INK);
  doc.text(toPdfSafe(ctx.brand), PDF_MARGIN + 20, y + 4);
  doc.setFont("helvetica", "bold").setFontSize(13);
  doc.text(toPdfSafe(ctx.title), rightX, y + 4, { align: "right" });
  y += 20;

  if (ctx.tagline) {
    doc.setFont("helvetica", "normal").setFontSize(8.5);
    doc.setTextColor(...PDF_MUTED);
    doc.text(toPdfSafe(ctx.tagline), PDF_MARGIN + 20, y);
  }
  if (ctx.generatedLabel) {
    doc.setFont("helvetica", "normal").setFontSize(8.5);
    doc.setTextColor(...PDF_MUTED);
    doc.text(toPdfSafe(`Generated ${ctx.generatedLabel}`), rightX, y, { align: "right" });
  }
  y += 13;

  if (ctx.source.length) {
    doc.setFont("helvetica", "normal").setFontSize(9);
    doc.setTextColor(...PDF_INK);
    const label = ctx.source.length === 1 ? "Source" : `Sources (${ctx.source.length})`;
    doc.text(toPdfSafe(`${label}: ${ctx.source.slice(0, 3).join(", ")}${ctx.source.length > 3 ? "…" : ""}`), PDF_MARGIN, y);
    y += 13;
  }

  doc.setDrawColor(...accent).setLineWidth(1.2);
  doc.line(PDF_MARGIN, y, rightX, y);
  y += 14;
  return y;
}

/** Paint the branded footer on the CURRENT page (call once per page, after
 *  all body content, or in a final per-page loop like auditPdf.js already
 *  does for its page-number footer). */
export function brandingPdfFooter(doc, ctx, page, totalPages, { toPdfSafe = (s) => String(s ?? "") } = {}) {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const rightX = pageW - PDF_MARGIN;
  const footY = pageH - 24;

  doc.setDrawColor(225, 227, 233).setLineWidth(0.6);
  doc.line(PDF_MARGIN, footY - 10, rightX, footY - 10);

  doc.setFont("helvetica", "normal").setFontSize(7.6);
  doc.setTextColor(...PDF_MUTED);
  const left = ctx.footerText
    ? `${ctx.footerText}  ·  ${ctx.poweredByLine}`
    : `Exported via ${ctx.brand} — ${SITE_URL}${ctx.brand !== BRAND ? `  ·  ${ctx.poweredByLine}` : ""}`;
  doc.text(toPdfSafe(left), PDF_MARGIN, footY);
  if (page && totalPages) {
    doc.text(`Page ${page} of ${totalPages}`, rightX, footY, { align: "right" });
  }
}

// ── Markdown ─────────────────────────────────────────────────────────────────

export function brandingMarkdownHeader(ctx) {
  const lines = [`# ${ctx.brand} ${ctx.title}`, ""];
  if (ctx.source.length) {
    const label = ctx.source.length === 1 ? "**Source:**" : "**Sources:**";
    lines.push(`${label} ${ctx.source.join(", ")}`);
  }
  if (ctx.generatedLabel) {
    lines.push(`**Generated:** ${ctx.generatedLabel} — by ${ctx.brand} (${ctx.website || SITE_URL})`);
  }
  if (ctx.accountLabel) lines.push(`**Prepared for:** ${ctx.accountLabel}`);
  lines.push("", "---", "");
  return lines.join("\n");
}

/**
 * @param {object} ctx
 * @param {string[]} [extraDisclaimers]  format-specific disclaimer lines
 *   (e.g. Discoverability's "scores are not a prediction of rankings…")
 *   appended after the shared attribution line.
 */
export function brandingMarkdownFooter(ctx, extraDisclaimers = []) {
  const lines = ["", "---", `*Exported via ${ctx.brand} — ${ctx.website || SITE_URL} · ${ctx.tagline || TAGLINE}*`];
  if (ctx.footerText) lines.push(`*${ctx.footerText}*`);
  if (ctx.brand !== BRAND) lines.push(`*${ctx.poweredByLine}*`);
  for (const d of extraDisclaimers) lines.push(`*${d}*`);
  return lines.join("\n");
}

// ── CSV ──────────────────────────────────────────────────────────────────────
// Leading/trailing `#`-prefixed comment rows — ignored by Excel/Sheets/
// Papa.parse and every real CSV consumer, kept OUT of the data rows
// entirely so nothing that actually parses the file breaks.

export function brandingCsvHeaderRows(ctx) {
  const rows = [`# ${ctx.brand} Export — ${ctx.title}`];
  if (ctx.source.length) rows.push(`# ${ctx.source.length === 1 ? "Source" : "Sources"}: ${ctx.source.join(", ")}`);
  if (ctx.generatedAtISO) rows.push(`# Generated: ${ctx.generatedAtISO}`);
  rows.push("#");
  return rows;
}

export function brandingCsvFooterRows(ctx) {
  const rows = ["#"];
  const attribution = ctx.footerText
    ? `# ${ctx.footerText} · ${ctx.poweredByLine}`
    : `# Exported via ${ctx.brand} — ${ctx.website || SITE_URL}${ctx.brand !== BRAND ? ` · ${ctx.poweredByLine}` : ""}`;
  rows.push(attribution);
  return rows;
}

// ── JSON ─────────────────────────────────────────────────────────────────────
// Merged into each format's existing envelope — additive, never breaking an
// existing consumer that only reads the payload's own top-level data key.

export function brandingJsonMeta(ctx) {
  const meta = {
    tool: ctx.brand,
    kind: ctx.kind,
    generatedAt: ctx.generatedAtISO,
    source: ctx.source,
    preparedBy: ctx.brand,
    poweredBy: SITE_URL,
  };
  if (ctx.accountLabel) meta.preparedFor = ctx.accountLabel;
  return meta;
}

// ── Email (HTML + text) ──────────────────────────────────────────────────────
// Generalizes netlify/functions/lib/invoiceEmail.js's invoiceEmailHtml/Text —
// same 560px, brand-band-then-bordered-card shell, so a report email and an
// invoice email read as the same product rather than two different ones.

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * @param {object} ctx
 * @param {object} opts
 * @param {string} opts.heading       e.g. "Your extraction report is ready"
 * @param {string} [opts.bodyHtml]    inner HTML — summary preview, etc.
 * @param {string} [opts.attachmentLabel]  e.g. "lumio-io-extraction.pdf attached"
 * @param {string} [opts.ctaUrl]
 * @param {string} [opts.ctaLabel]    defaults to "View in {brand}"
 */
export function brandingEmailHtml(ctx, { heading, bodyHtml = "", attachmentLabel = null, ctaUrl = null, ctaLabel = null } = {}) {
  const accent = ctx.accentColor || DEFAULT_ACCENT;
  const logoImg = `<img src="${escapeHtml(ctx.logoUrl)}" width="22" height="22" alt="${escapeHtml(ctx.brand)}" style="vertical-align:middle;border-radius:4px;margin-right:8px">`;

  return `<!doctype html><html><body style="margin:0;background:#f6f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:${escapeHtml(accent)};border-radius:12px 12px 0 0;padding:20px 24px">
      <div style="color:#fff;font-size:18px;font-weight:700">${logoImg}${escapeHtml(ctx.brand)}</div>
      ${ctx.tagline ? `<div style="color:#e0e2ff;font-size:12px;margin-top:2px">${escapeHtml(ctx.tagline)}</div>` : ""}
    </div>
    <div style="background:#fff;border:1px solid #e1e3e9;border-top:none;border-radius:0 0 12px 12px;padding:24px">
      <h1 style="margin:0 0 14px;font-size:17px;color:#20222c">${escapeHtml(heading)}</h1>
      ${ctx.source.length ? `<p style="margin:0 0 4px;font-size:13px;color:#6e7484"><strong>Source:</strong> ${escapeHtml(ctx.source.join(", "))}</p>` : ""}
      ${ctx.generatedLabel ? `<p style="margin:0 0 16px;font-size:13px;color:#6e7484"><strong>Generated:</strong> ${escapeHtml(ctx.generatedLabel)}</p>` : ""}
      ${bodyHtml}
      ${attachmentLabel ? `<p style="margin:16px 0 0;font-size:13px;color:#20222c">📎 ${escapeHtml(attachmentLabel)}</p>` : ""}
      ${ctaUrl ? `<div style="margin-top:20px"><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:${escapeHtml(accent)};color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600">${escapeHtml(ctaLabel || `View in ${ctx.brand}`)}</a></div>` : ""}
      <p style="margin:20px 0 0;font-size:11px;color:#9aa0af;line-height:1.6">
        ${escapeHtml(`Exported via ${ctx.brand}`)}<br>
        ${ctx.footerText ? `${escapeHtml(ctx.footerText)}<br>` : ""}
        ${ctx.brand !== BRAND ? `${escapeHtml(ctx.poweredByLine)}<br>` : ""}
        This email was sent from your ${escapeHtml(BRAND)} account.
      </p>
      <!-- The legal entity signs every email we send, white-labelled or not.
           A Brand Kit can replace the PRODUCT brand in the header; it cannot
           remove the company that sent the mail, for the same reason
           poweredByLine is hard-coded into buildBrandingContext. -->
      <p style="margin:14px 0 0;padding-top:12px;border-top:1px solid #eceef3;font-size:11px;color:#9aa0af;line-height:1.6">
        <span style="color:#5b6070;font-weight:600">${escapeHtml(COMPANY)}</span><br>
        <a href="${escapeHtml(COMPANY_URL)}" style="color:#9aa0af">${escapeHtml(COMPANY_URL.replace(/^https?:\/\//, ""))}</a>
      </p>
    </div>
  </div></body></html>`;
}

export function brandingEmailText(ctx, { heading, bodyText = "", attachmentLabel = null } = {}) {
  const lines = [heading, ""];
  if (ctx.source.length) lines.push(`Source: ${ctx.source.join(", ")}`);
  if (ctx.generatedLabel) lines.push(`Generated: ${ctx.generatedLabel}`);
  lines.push("");
  if (bodyText) lines.push(bodyText, "");
  if (attachmentLabel) lines.push(`(attached: ${attachmentLabel})`, "");
  lines.push(`Exported via ${ctx.brand} — ${ctx.website || SITE_URL}`);
  if (ctx.footerText) lines.push(ctx.footerText);
  if (ctx.brand !== BRAND) lines.push(ctx.poweredByLine);
  lines.push("", "—", COMPANY, COMPANY_URL);
  return lines.join("\n");
}
