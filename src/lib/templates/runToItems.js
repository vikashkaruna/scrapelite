// src/lib/templates/runToItems.js — workflow run → the shape every exporter reads.
//
// ── WHY AN ADAPTER AND NOT NEW EXPORTERS ────────────────────────────────────
// `extractionsToCsv/Markdown/Json`, `extractionsToExcel` and the PDF renderer
// all consume one shape, built by `extractionRows()`: { url, page_title,
// ai_summary, headings, links, domain_map, enrichments }. A workflow run is a
// different shape entirely — { output: { summary, talking_points, comparison,
// fields }, sources, input }.
//
// Writing a second set of exporters for runs would be six more code paths that
// must agree with the first six forever. Mapping once, here, means a template
// export is byte-for-byte the same machinery as a Dashboard export — including
// the Brand Kit header, the CSV escaping and the PDF layout.
//
// ── WHAT IS DELIBERATELY NOT INVENTED ───────────────────────────────────────
// A block the run does not carry is OMITTED, never emitted empty. An export
// that shows "Talking points: (none)" for a template that never produces them
// reads as a failed run rather than a different template.

const humanKey = (k) =>
  String(k || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Convert one workflow run into a single extraction-shaped item.
 * @param {object} run
 * @returns {object|null} null when there is nothing worth exporting.
 */
export function runToItem(run) {
  if (!run || typeof run !== "object") return null;

  const output = run.output || {};
  const input = run.input || {};
  const target = input.domain || input.url || output.target || "";
  // The exporters key their "page" column off a URL, so give them a real one
  // when the template ran against a bare domain.
  const url = /^https?:\/\//i.test(target) ? target : target ? `https://${target}` : "";

  // Three shapes reach this adapter: a stored run row (`output_summary`), a
  // run's own output object (`output.summary`), and the live result the
  // Templates page holds, which carries the blocks at the TOP level. Reading
  // only one of them exports a blank file from whichever screen uses another.
  const summary = run.output_summary || output.summary || run.summary || "";
  const sources = Array.isArray(run.sources) ? run.sources
                : Array.isArray(output.sources) ? output.sources
                : [];

  const enrichments = {};
  const add = (key, label, data) => {
    if (data == null) return;
    if (Array.isArray(data) && data.length === 0) return;
    if (typeof data === "object" && !Array.isArray(data) && Object.keys(data).length === 0) return;
    enrichments[key] = { key, label, data };
  };

  // The declared output blocks, each flattened by the exporters themselves.
  add("facts", "Extracted facts", output.fields ?? output.data ?? run.fields ?? null);
  add("talking_points", "Talking points", output.talking_points ?? run.talking_points ?? null);
  add("comparison", "Comparison", output.comparison ?? run.comparison ?? null);

  // Anything else the template declared travels too, rather than being lost
  // because this adapter did not know its name.
  for (const [k, v] of Object.entries(output)) {
    if (["summary", "talking_points", "comparison", "fields", "data", "sources", "target"].includes(k)) continue;
    add(k, humanKey(k), v);
  }

  return {
    id: run.id || run.run_id || null,
    url,
    page_title: run.template_name || humanKey(run.template_key) || "Workflow run",
    ai_summary: summary || undefined,
    // Sources are the run's evidence — the closest thing it has to links, and
    // the part a reader most often wants to check.
    links: sources
      .map((s) => (typeof s === "string" ? { href: s, text: s } : s))
      .filter((s) => s && (s.url || s.href))
      .map((s) => ({ category: "source", text: s.title || s.canonical_url || s.url || s.href, href: s.url || s.href })),
    enrichments,
    _run: true,
  };
}

/** Convert one run, or a list of them, into exportable items. */
export function runsToItems(runs) {
  const list = Array.isArray(runs) ? runs : [runs];
  return list.map(runToItem).filter(Boolean);
}
