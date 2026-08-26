// auditPdf.js — the discoverability report as a PDF.
//
// ⚠️ NEVER static-import this module. jsPDF is ~350KB and belongs nowhere near
// the initial bundle; call sites use `await import("./auditPdf.js")` on the
// click, exactly as invoicePdf.js and pdfExport.js are consumed. The static
// `import { jsPDF }` below is inside THIS module, which is itself lazy.
//
// ── IT RENDERS FROM THE SAME MODEL AS EVERY OTHER FORMAT ───────────────────
// The input is the rehydrated audit that buildMarkdownReport, issuesToCsv and
// toJsonPayload all take. A PDF built from a second, parallel reading of the
// data is a PDF that disagrees with the CSV somebody exported ten seconds
// earlier, and that is a support ticket nobody can reproduce.
//
// ── SCORES ARE PRINTED WITH THEIR COVERAGE ─────────────────────────────────
// A PDF is the artefact that gets forwarded to a client, attached to a ticket,
// and read six months later with no access to the app that made it. So a score
// built on thin evidence must SAY it is thin on the page itself — the number
// alone outlives every caveat that was on screen beside it.

import { jsPDF } from "jspdf";
import { toPdfSafe } from "../invoicePdf.js";

const MARGIN = 44;
const RULE = [226, 232, 240];
const MUTED = [100, 116, 139];
const INK = [15, 23, 42];
const ACCENT = [79, 70, 229];

const SEVERITY_ORDER = ["critical", "high", "medium", "low"];
const SEVERITY_INK = {
  critical: [190, 24, 93],
  high: [217, 70, 39],
  medium: [180, 130, 20],
  low: [100, 116, 139],
};

const n1 = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 10) / 10 : null);
const scoreText = (v) => { const x = n1(v); return x === null ? "not measured" : String(x); };

/**
 * Render the report.
 *
 * @param {object} audit  the rehydrated audit (same shape buildMarkdownReport takes)
 * @param {object} [opts]
 * @param {boolean} [opts.includeConstructs]  append the copy-ready assets
 * @returns {jsPDF}
 */
export function renderAuditPdf(audit, { includeConstructs = false } = {}) {
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const contentW = pageW - MARGIN * 2;
  let y = MARGIN;

  const room = (h) => {
    if (y + h > pageH - MARGIN - 18) { pdf.addPage(); y = MARGIN; return true; }
    return false;
  };
  const text = (s, x, opts) => pdf.text(toPdfSafe(s), x, y, opts);
  const setInk = (rgb) => pdf.setTextColor(rgb[0], rgb[1], rgb[2]);

  const heading = (label) => {
    room(40);
    y += 10;
    pdf.setFont("helvetica", "bold").setFontSize(12);
    setInk(INK); text(label, MARGIN);
    y += 6;
    pdf.setDrawColor(RULE[0], RULE[1], RULE[2]).setLineWidth(0.8)
      .line(MARGIN, y, pageW - MARGIN, y);
    y += 14;
  };

  /** Wrapped body text. Returns the height consumed. */
  const para = (s, { size = 9.5, style = "normal", ink = INK, indent = 0, gap = 4 } = {}) => {
    if (!s) return;
    pdf.setFont("helvetica", style).setFontSize(size);
    setInk(ink);
    const lines = pdf.splitTextToSize(toPdfSafe(s), contentW - indent);
    for (const line of lines) {
      room(size + 3);
      pdf.text(line, MARGIN + indent, y);
      y += size + 2.5;
    }
    y += gap;
  };

  // ── Title block ──────────────────────────────────────────────────────────
  const url = audit?.target?.url || audit?.url || "";
  pdf.setFont("helvetica", "bold").setFontSize(19);
  setInk(INK); text("Discoverability report", MARGIN);
  y += 22;
  pdf.setFont("helvetica", "normal").setFontSize(10.5);
  setInk(ACCENT); text(url, MARGIN);
  y += 15;

  const created = audit?.created_at || audit?.meta?.startedAt;
  const stamp = created ? new Date(created).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "";
  const profile = audit?.target?.audit_profile || "balanced";
  const device = audit?.target?.device_profile || "mobile";
  const pageType = audit?.target?.page_type_label || audit?.target?.page_type || "";
  pdf.setFontSize(8.6); setInk(MUTED);
  text([stamp, `profile: ${profile}`, `device: ${device}`, pageType && `page type: ${pageType}`]
    .filter(Boolean).join("   |   "), MARGIN);
  y += 18;

  // ── Scores ───────────────────────────────────────────────────────────────
  heading("Scores");

  const coverage = n1(audit?.coverage);
  const tiles = [
    ["Overall", audit?.finalScore],
    ["SEO", audit?.seoScore],
    ["AEO", audit?.aeoScore],
    ["GEO", audit?.geoScore],
  ];
  const tileW = contentW / tiles.length;
  room(56);
  const tileTop = y;
  tiles.forEach(([label, value], i) => {
    const x = MARGIN + i * tileW;
    pdf.setFont("helvetica", "normal").setFontSize(8.2); setInk(MUTED);
    pdf.text(toPdfSafe(label.toUpperCase()), x, tileTop);
    pdf.setFont("helvetica", "bold").setFontSize(21); setInk(INK);
    pdf.text(toPdfSafe(scoreText(value)), x, tileTop + 24);
  });
  y = tileTop + 38;

  // Coverage travels WITH the score, never in a footnote. A 92 built on 40% of
  // the intended evidence is not a 92, and this page will be read long after
  // whatever the screen said beside it.
  if (coverage !== null) {
    pdf.setFont("helvetica", "normal").setFontSize(8.6); setInk(MUTED);
    text(`Evidence coverage: ${coverage}%${coverage < 70
      ? "  -  this audit is THIN. Signals that could not be measured were excluded and their weight redistributed, not scored as zero."
      : ""}`, MARGIN);
    y += 14;
  }

  const skipped = (audit?.stageErrors || []).filter((e) => e?.signal);
  if (skipped.length) {
    para(`Not measured: ${skipped.map((e) => e.signal).join(", ")}.`,
      { size: 8.4, ink: MUTED, gap: 2 });
  }

  // ── Issues ───────────────────────────────────────────────────────────────
  const issues = audit?.issues || [];
  heading(`Issues (${issues.length})`);
  if (!issues.length) {
    para("No issues were raised for this page.", { ink: MUTED });
  } else {
    const ordered = [...issues].sort((a, b) =>
      SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
    for (const issue of ordered) {
      room(30);
      pdf.setFont("helvetica", "bold").setFontSize(7.6);
      setInk(SEVERITY_INK[issue.severity] || MUTED);
      pdf.text(toPdfSafe(String(issue.severity || "").toUpperCase()), MARGIN, y);
      pdf.setFont("helvetica", "bold").setFontSize(9.6); setInk(INK);
      pdf.text(toPdfSafe(`${issue.code}  ${issue.title || ""}`), MARGIN + 52, y);
      y += 12;
      if (issue.evidence) para(issue.evidence, { size: 8.8, ink: MUTED, indent: 52, gap: 6 });
      else y += 4;
    }
  }

  // ── Recommendations ──────────────────────────────────────────────────────
  const recs = audit?.recommendations || [];
  heading(`What to fix, in order (${recs.length})`);
  if (!recs.length) {
    para("No recommendations were generated.", { ink: MUTED });
  } else {
    const lift = n1(audit?.estimatedTotalLift);
    const unblocked = n1(audit?.estimatedUnblockedLift);
    if (lift !== null) {
      // Presenting only the total promises work that cannot pay off yet on a
      // page whose blockers gate it.
      para(unblocked !== null && unblocked !== lift
        ? `Estimated total lift ${lift} points, of which ${unblocked} is realisable now - the remainder is gated behind the blocking fixes below.`
        : `Estimated total lift: ${lift} points.`,
      { size: 8.8, ink: MUTED });
    }
    recs.forEach((rec, i) => {
      room(34);
      pdf.setFont("helvetica", "bold").setFontSize(9.6); setInk(INK);
      pdf.text(toPdfSafe(`${i + 1}. ${rec.title || rec.code}`), MARGIN, y);
      y += 12;
      const bits = [
        rec.priority && `priority ${rec.priority}`,
        Number.isFinite(rec.estimatedLift) && `+${n1(rec.estimatedLift)} pts`,
        rec.owner && `owner: ${rec.owner}`,
        rec.blockedBy && `BLOCKED BY ${rec.blockedBy}`,
      ].filter(Boolean).join("   |   ");
      if (bits) para(bits, { size: 8.2, ink: rec.blockedBy ? SEVERITY_INK.high : MUTED, indent: 14, gap: 3 });
      if (rec.rationale) para(rec.rationale, { size: 8.8, indent: 14, gap: 8 });
    });
  }

  // ── Copy-ready constructs ────────────────────────────────────────────────
  if (includeConstructs) {
    const withAssets = recs.filter((r) => r.implementationAsset?.content);
    if (withAssets.length) {
      heading("Ready-to-paste assets");
      para("Anything the audit could not observe is left as an explicit TODO. Review before publishing - a generated block with an invented value is worse than no block at all.",
        { size: 8.4, ink: MUTED });
      for (const rec of withAssets) {
        room(28);
        pdf.setFont("helvetica", "bold").setFontSize(9); setInk(INK);
        pdf.text(toPdfSafe(rec.title || rec.code), MARGIN, y);
        y += 12;
        pdf.setFont("courier", "normal").setFontSize(7.6); setInk(INK);
        for (const line of pdf.splitTextToSize(toPdfSafe(rec.implementationAsset.content), contentW - 12)) {
          room(10);
          pdf.text(line, MARGIN + 12, y);
          y += 9.2;
        }
        y += 10;
      }
    }
  }

  // ── Footer on every page ─────────────────────────────────────────────────
  const total = pdf.internal.getNumberOfPages();
  for (let p = 1; p <= total; p += 1) {
    pdf.setPage(p);
    pdf.setFont("helvetica", "normal").setFontSize(7.6);
    pdf.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    pdf.text(toPdfSafe(`DatIQ discoverability - ${url}`), MARGIN, pageH - 22);
    pdf.text(`${p} / ${total}`, pageW - MARGIN, pageH - 22, { align: "right" });
  }

  return pdf;
}

/** `discoverability-<host>.pdf`, matching the other export filenames. */
export function auditPdfFilename(audit) {
  const url = audit?.target?.url || audit?.url || "";
  let host = "audit";
  try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { /* keep default */ }
  return `discoverability-${host.replace(/[^a-z0-9]+/gi, "-")}.pdf`;
}

export function downloadAuditPdf(audit, opts = {}) {
  renderAuditPdf(audit, opts).save(auditPdfFilename(audit));
}
