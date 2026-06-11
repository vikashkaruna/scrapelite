// pdfExport.js — render one or more saved extractions to a downloadable PDF.
// Includes everything CSV does (meta, AI summary, headings, links, domain map,
// and every Quick-Enrichment capability), laid out as a readable report.

import { jsPDF } from "jspdf";
import { hostOf, pathOf, fmtDate, flattenJson } from "./utils.js";

const MARGIN = 48; // pt
const LINE = 14; // base line height

export function extractionsToPdf(items) {
  const list = Array.isArray(items) ? items : [items];
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const contentW = pageW - MARGIN * 2;
  let y = MARGIN;

  // Move down by `h`, adding a page if we'd run off the bottom.
  const advance = (h) => {
    if (y + h > pageH - MARGIN) {
      doc.addPage();
      y = MARGIN;
    }
  };

  // Write wrapped text in a given style; returns nothing, advances y.
  const write = (text, { size = 10, style = "normal", color = [40, 40, 50], gap = 4, indent = 0 } = {}) => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(String(text ?? ""), contentW - indent);
    const lh = size + 3;
    for (const line of lines) {
      advance(lh);
      doc.text(line, MARGIN + indent, y);
      y += lh;
    }
    y += gap;
  };

  const rule = () => {
    advance(10);
    doc.setDrawColor(225, 227, 233);
    doc.line(MARGIN, y, pageW - MARGIN, y);
    y += 10;
  };

  const sectionTitle = (label, count) => {
    advance(20);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(90, 70, 220);
    doc.text(count != null ? `${label}  (${count})` : label, MARGIN, y);
    y += LINE + 2;
  };

  list.forEach((e, idx) => {
    if (idx > 0) {
      doc.addPage();
      y = MARGIN;
    }

    // Header
    write(e.page_title || hostOf(e.url), { size: 17, style: "bold", color: [20, 20, 30], gap: 2 });
    write(e.url || "", { size: 9, color: [90, 95, 110], gap: 2 });
    write(`Extracted ${fmtDate(e.created_at)}`, { size: 8, color: [140, 145, 158], gap: 6 });
    rule();

    // AI summary
    if (e.ai_summary) {
      sectionTitle("AI summary");
      write(e.ai_summary, { size: 10, color: [55, 58, 70] });
    }

    // Domain map (when present, it replaces headings/links)
    if (Array.isArray(e.domain_map) && e.domain_map.length) {
      sectionTitle("Domain map", e.domain_map.length);
      e.domain_map.forEach((u) => write(`• ${u}`, { size: 9, color: [60, 64, 78], gap: 1, indent: 6 }));
    }

    // Headings
    if (e.headings?.length) {
      sectionTitle("Headings", e.headings.length);
      e.headings.forEach((h) =>
        write(`${h.tag}  ${h.text}`, { size: 9, color: [55, 58, 70], gap: 1, indent: 6 }),
      );
    }

    // Links
    if (e.links?.length) {
      sectionTitle("Links", e.links.length);
      e.links.forEach((l) =>
        write(`• ${l.text} — ${l.href}`, { size: 8.5, color: [60, 64, 78], gap: 1, indent: 6 }),
      );
    }

    // Every enrichment capability (or a bare custom_extraction)
    const entries = Object.values(e.enrichments || {});
    if (entries.length) {
      entries.forEach((en) => {
        sectionTitle(en.label || en.key);
        const flat = en.data == null ? [] : flattenJson(en.data);
        if (flat.length === 0) {
          write("No data returned for this capability.", { size: 9, color: [140, 145, 158], indent: 6 });
        } else {
          flat.forEach(({ path, value }) =>
            write(`${path}:  ${value}`, { size: 9, color: [55, 58, 70], gap: 1, indent: 6 }),
          );
        }
      });
    } else if (e.custom_extraction != null) {
      sectionTitle("Custom extraction");
      flattenJson(e.custom_extraction).forEach(({ path, value }) =>
        write(`${path}:  ${value}`, { size: 9, color: [55, 58, 70], gap: 1, indent: 6 }),
      );
    }
  });

  const name =
    list.length === 1
      ? `datiq-${hostOf(list[0].url)}-${list[0].id || "export"}.pdf`
      : `datiq-export-${list.length}-pages.pdf`;
  doc.save(name);
}
