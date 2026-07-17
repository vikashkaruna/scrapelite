// src/lib/provenanceService.js — Q9 (full per-field provenance).
//
// Wraps an extraction with provenance metadata:
//   - Per-record: source URL, total fields, average confidence, last-checked-at
//   - Per-field: source URL, confidence (0..1), last-checked-at, retrieval hint
//
// Pure logic — UI lives in components/ProvenanceBadge.jsx. The service is
// designed to be tolerant: missing fields get sensible defaults rather than
// throwing. Callers can re-run provenance on the same extraction to "refresh"
// the last-checked timestamp without changing the source data.

const CONFIDENCE_DEFAULTS = {
  // Headings / structural data: very high confidence (extracted directly from
  // the HTML by the scraping provider).
  heading: 0.95,
  link: 0.95,
  title: 0.95,
  // AI-generated data: lower confidence — it's an inference.
  ai_summary: 0.85,
  // Custom extractions: medium confidence — the AI interpreted the prompt.
  custom: 0.75,
  // Enrichments: similar to custom, may have been re-run.
  enrichment: 0.8,
  // Unknown / fallback
  default: 0.5,
};

function pickConfidence(field) {
  const n = String(field || "").toLowerCase();
  for (const [key, conf] of Object.entries(CONFIDENCE_DEFAULTS)) {
    if (n.includes(key)) return conf;
  }
  return CONFIDENCE_DEFAULTS.default;
}

function makeProvenanceField({ field, sourceUrl, confidence, lastCheckedAt, retrieval }) {
  return {
    field,
    source_url: sourceUrl,
    confidence: typeof confidence === "number" ? Math.max(0, Math.min(1, confidence)) : pickConfidence(field),
    last_checked_at: lastCheckedAt || new Date().toISOString(),
    retrieval: retrieval || "scraped", // "scraped" | "ai_inferred" | "user_provided"
  };
}

/**
 * Wrap an extraction with per-record + per-field provenance metadata.
 * Returns a new extraction object — does not mutate the input.
 *
 * @param {object} extraction - { id, url, title, headings, links, custom_extraction, ai_summary, enrichments, ... }
 * @param {object} [opts] - { now?: string, runId?: string }
 * @returns {object} the extraction with `_provenance` attached
 */
export function attachProvenance(extraction, opts = {}) {
  if (!extraction || typeof extraction !== "object") return extraction;
  const now = opts.now || new Date().toISOString();
  const runId = opts.runId || `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const sourceUrl = extraction.url || null;
  const fieldProvenance = {};

  // Title (page title)
  if (extraction.title || extraction.page_title) {
    const f = extraction.title || extraction.page_title;
    fieldProvenance[f] = [makeProvenanceField({
      field: "title",
      sourceUrl,
      confidence: CONFIDENCE_DEFAULTS.title,
      lastCheckedAt: now,
      retrieval: "scraped",
    })];
  }

  // Headings
  if (Array.isArray(extraction.headings)) {
    for (const h of extraction.headings) {
      const key = h?.text;
      if (!key) continue;
      const prov = makeProvenanceField({
        field: "heading",
        sourceUrl,
        confidence: CONFIDENCE_DEFAULTS.heading,
        lastCheckedAt: now,
        retrieval: "scraped",
      });
      prov.level = h.level;
      if (!fieldProvenance[key]) fieldProvenance[key] = [];
      fieldProvenance[key].push(prov);
    }
  }

  // Links
  if (Array.isArray(extraction.links)) {
    for (const l of extraction.links) {
      const key = l?.text || l?.href || l?.url;
      if (!key) continue;
      const prov = makeProvenanceField({
        field: "link",
        sourceUrl,
        confidence: CONFIDENCE_DEFAULTS.link,
        lastCheckedAt: now,
        retrieval: "scraped",
      });
      prov.href = l.href || l.url;
      if (!fieldProvenance[key]) fieldProvenance[key] = [];
      fieldProvenance[key].push(prov);
    }
  }

  // AI summary
  if (extraction.ai_summary) {
    const key = "ai_summary";
    fieldProvenance[key] = [makeProvenanceField({
      field: "ai_summary",
      sourceUrl,
      confidence: CONFIDENCE_DEFAULTS.ai_summary,
      lastCheckedAt: now,
      retrieval: "ai_inferred",
    })];
  }

  // Custom extraction
  if (extraction.custom_extraction && typeof extraction.custom_extraction === "object") {
    for (const [k, v] of Object.entries(extraction.custom_extraction)) {
      const key = String(k);
      if (!fieldProvenance[key]) fieldProvenance[key] = [];
      fieldProvenance[key].push(makeProvenanceField({
        field: "custom",
        sourceUrl,
        confidence: CONFIDENCE_DEFAULTS.custom,
        lastCheckedAt: now,
        retrieval: "ai_inferred",
      }));
    }
  }

  // Enrichments
  if (extraction.enrichments && typeof extraction.enrichments === "object") {
    for (const [k, v] of Object.entries(extraction.enrichments)) {
      const key = String(k);
      if (!fieldProvenance[key]) fieldProvenance[key] = [];
      fieldProvenance[key].push(makeProvenanceField({
        field: "enrichment",
        sourceUrl,
        confidence: CONFIDENCE_DEFAULTS.enrichment,
        lastCheckedAt: now,
        retrieval: "ai_inferred",
      }));
    }
  }

  // Per-record aggregate provenance.
  const fields = Object.values(fieldProvenance).flat();
  const avgConfidence = fields.length > 0
    ? fields.reduce((sum, f) => sum + (f.confidence || 0), 0) / fields.length
    : 0;
  const lastChecked = fields.reduce((max, f) => (
    !max || (f.last_checked_at && f.last_checked_at > max) ? f.last_checked_at : max
  ), null);

  const _provenance = {
    run_id: runId,
    source_url: sourceUrl,
    extracted_at: now,
    last_checked_at: lastChecked || now,
    field_count: fields.length,
    avg_confidence: Math.round(avgConfidence * 100) / 100,
    fields: fieldProvenance,
  };

  return { ...extraction, _provenance };
}

/**
 * Refresh the last-checked-at timestamp on an existing provenance block
 * (re-verify the data without changing the source). Pure: returns a new object.
 */
export function refreshProvenance(extraction, opts = {}) {
  if (!extraction?._provenance) return attachProvenance(extraction, opts);
  const now = opts.now || new Date().toISOString();
  const fields = {};
  for (const [k, provs] of Object.entries(extraction._provenance.fields || {})) {
    fields[k] = provs.map((p) => ({ ...p, last_checked_at: now }));
  }
  return {
    ...extraction,
    _provenance: {
      ...extraction._provenance,
      last_checked_at: now,
      fields,
    },
  };
}

/**
 * Look up provenance for a specific field by its display label. Returns the
 * array of provenance records, or [] if none.
 */
export function getProvenanceForField(extraction, fieldLabel) {
  return extraction?._provenance?.fields?.[fieldLabel] || [];
}

/**
 * Summarise the provenance of an extraction as a small, human-readable string.
 * E.g. "Sourced from stripe.com · 12 fields · 91% confidence · checked 2h ago"
 */
export function summariseProvenance(extraction) {
  const p = extraction?._provenance;
  if (!p) return "No provenance recorded.";
  const source = p.source_url ? `Sourced from ${hostOfUrl(p.source_url)}` : "Unknown source";
  const fields = `${p.field_count} field${p.field_count === 1 ? "" : "s"}`;
  const conf = `${Math.round((p.avg_confidence || 0) * 100)}% confidence`;
  const checked = p.last_checked_at ? `checked ${timeAgoShort(p.last_checked_at)}` : "not yet checked";
  return `${source} · ${fields} · ${conf} · ${checked}`;
}

function hostOfUrl(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

function timeAgoShort(iso) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

export { pickConfidence, timeAgoShort, hostOfUrl };
