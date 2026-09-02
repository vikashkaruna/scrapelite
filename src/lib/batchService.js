// batchService.js — parallel batch URL extraction with concurrency control.
// Each URL is extracted independently; results stream back via onProgress.
import { extractStructure } from "./firecrawlService.js";
import { summarize, categorizeLinks, generateContent } from "./aiService.js";
import { enrichMetaForIntent } from "./extractionPresets.js";
import { uid } from "./utils.js";

// Max simultaneous in-flight requests to avoid hammering the API.
const CONCURRENCY = 3;

// Attach the exact capability key (pricing/contacts/leadership/custom) to the
// extract() options BEFORE the request goes out, using the same lookup
// buildBatchEnrichments uses to label the result — so the server's related-
// page scanning (see extract.js) gets the precise key instead of guessing
// one from the prompt text.
function withEnrichKey(options) {
  // `deep: false` opts OUT of the server's related-page gathering. A single
  // extraction happily spends 2-3 extra fetches to find pricing on /pricing;
  // a 200-URL batch would spend 400-600, and latency per row is what the user
  // actually feels there. The capability key still travels, so a batch row
  // whose base page DOES carry the data is unaffected.
  const base = { deep: false, ...options };
  if (!base.customPrompt || base.enrichKey) return base;
  const meta = enrichMetaForIntent(base.intent, base.customPrompt);
  return meta ? { ...base, enrichKey: meta.key } : base;
}

// Build the SAME { [capabilityKey]: entry } tab map that a single-URL
// extraction builds in ExtractionProvider.extract(). Batch previously only
// spread the raw `custom_extraction` / `generated_content` fields onto the
// result — real data, but with nowhere to live: Preview only ever renders
// `result.enrichments`, so a batch-run "Pricing & Plans" or "Competitor
// Summary" selection produced data that was saved to the row and then never
// shown as a tab anywhere, on any device. Centralizing this here (instead of
// in BatchRunProvider, which only handled the customPrompt half and dropped
// generateContent entirely) means runBatch AND the per-row Retry path
// (extractOne) both produce identically-shaped, correctly-labeled tabs.
function buildBatchEnrichments({ options, structure, generatedContentText, createdAt }) {
  const enrichments = {};
  let activeTab = null;

  if (options.customPrompt) {
    const meta = enrichMetaForIntent(options.intent, options.customPrompt);
    if (meta) {
      const entry = {
        key: meta.key,
        label: meta.label,
        icon: meta.icon,
        prompt: options.customPrompt,
        data: structure.custom_extraction ?? null,
        ...(structure.custom_extraction_reason
          ? { reason: structure.custom_extraction_reason }
          : {}),
        // Same provenance a single-URL run records — provider, model, whether
        // the schema was enforced natively, and which pages were read. Batch
        // rows are the ones most likely to be exported straight into a CRM,
        // so they are the LAST place that should lose their evidence trail.
        ...(structure.enrichment_meta ? { meta: structure.enrichment_meta } : {}),
        ...(structure.related_pages_scanned ? { pages: structure.related_pages_scanned } : {}),
        created_at: createdAt,
      };
      enrichments[meta.key] = entry;
      activeTab = meta.key;
    }
  }

  if (options.generateContent && generatedContentText) {
    const f = options.generateContent;
    const entry = {
      key: f.key,
      label: f.label,
      icon: f.icon,
      prompt: f.instruction || f.desc || "",
      data: { text: generatedContentText },
      kind: "content",
      created_at: createdAt,
    };
    enrichments[f.key] = entry;
    activeTab = activeTab || f.key;
  }

  return { enrichments, activeTab };
}

/**
 * Run batch extraction on an array of URLs.
 *
 * @param {string[]} urls - list of fully-qualified URLs
 * @param {object} options - passed to extractStructure (renderJs, customPrompt, mapMode)
 *   options.generateContent - one of CONTENT_FORMATS: {key,label,instruction,...} or null
 * @param {(completed: number, total: number, result: object) => void} onProgress
 * @param {AbortSignal} [signal] - optional abort signal
 * @returns {Promise<object[]>} array of results in input order, each with a _status field
 */
export async function runBatch(urls, options = {}, onProgress, signal) {
  const total = urls.length;
  const results = new Array(total).fill(null);
  let completed = 0;
  let cancelled = false;

  if (signal) {
    if (signal.aborted) return results;
    signal.addEventListener("abort", () => { cancelled = true; });
  }

  // Use a shared index to pull work from in FIFO order.
  let nextIndex = 0;

  async function worker() {
    while (!cancelled) {
      const index = nextIndex++;
      if (index >= total) break;
      const url = urls[index];

      let result;
      try {
        const structure = await extractStructure(url, withEnrichKey(options));
        if (cancelled) return;

        if (structure.domain_map) {
          result = {
            ...structure,
            ai_summary: `Mapped ${structure.domain_map.length} URL${structure.domain_map.length === 1 ? "" : "s"} on ${url}.`,
            id: uid(),
            created_at: new Date().toISOString(),
            _status: "success",
          };
        } else {
          const [ai_summary, links] = await Promise.all([
            summarize(structure, { personaId: options.personaId, intent: options.intent }),
            categorizeLinks(structure.links, structure.url),
          ]);
          if (cancelled) return;
          result = {
            ...structure,
            links,
            ai_summary,
            id: uid(),
            created_at: new Date().toISOString(),
            _status: "success",
          };
          // Optional per-URL content generation (seo-outline / competitor-summary / social-posts).
          if (options.generateContent) {
            try {
              result.generated_content = await generateContent(result, options.generateContent);
            } catch (err) {
              console.warn("[DatIQ] Batch content generation failed for", url, err?.message);
              // Non-fatal: extraction still succeeds without generated content.
            }
            if (cancelled) return;
          }
          // Turn the raw custom_extraction / generated_content fields into
          // the tab map Preview actually renders — see buildBatchEnrichments.
          const { enrichments, activeTab } = buildBatchEnrichments({
            options,
            structure,
            generatedContentText: result.generated_content,
            createdAt: result.created_at,
          });
          if (Object.keys(enrichments).length > 0) {
            result.enrichments = enrichments;
            result.activeTab = activeTab;
          }
        }
      } catch (err) {
        result = {
          url,
          page_title: url,
          headings: [],
          links: [],
          ai_summary: null,
          id: uid(),
          created_at: new Date().toISOString(),
          _status: "error",
          _error: err?.message || "Extraction failed",
        };
      }

      results[index] = result;
      completed++;
      onProgress?.(completed, total, result);
    }
  }

  // Spawn CONCURRENCY workers; each pulls URLs from the shared queue.
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, () => worker()));
  return results;
}

/**
 * Parse a CSV file string and extract URLs from it.
 * Looks for a 'url' column header first; falls back to the first column.
 *
 * @param {string} csvText - raw CSV file contents
 * @returns {{ urls: string[], column: string, errors: string[] }}
 */
export function parseUrlsFromCsv(csvText) {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { urls: [], column: "", errors: ["CSV is empty or has no data rows."] };

  const parseRow = (line) => {
    const cells = [];
    let cur = "";
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = !inQuote;
      } else if (ch === "," && !inQuote) {
        cells.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    cells.push(cur.trim());
    return cells;
  };

  const headers = parseRow(lines[0]).map((h) => h.toLowerCase().trim());
  const urlColIdx = headers.findIndex((h) => h === "url" || h === "urls" || h === "website" || h === "link");
  const colIndex = urlColIdx >= 0 ? urlColIdx : 0;
  const colName = headers[colIndex] || `column ${colIndex + 1}`;

  const urls = [];
  const errors = [];

  for (let i = 1; i < lines.length; i++) {
    const row = parseRow(lines[i]);
    const raw = (row[colIndex] || "").trim();
    if (!raw) continue;
    let normalized = raw;
    if (!/^https?:\/\//i.test(normalized)) normalized = "https://" + normalized;
    try {
      new URL(normalized);
      urls.push(normalized);
    } catch {
      errors.push(`Row ${i + 1}: invalid URL — "${raw}"`);
    }
  }

  return { urls, column: colName, errors };
}

// Groke QW#4 (ba-4) — single-URL extraction that mirrors the per-row logic in
// runBatch. Used by the "Retry" button on failed batch rows. Returns a
// { _status, _error, ...item } object in the same shape as runBatch results.
export async function extractOne(url, options = {}) {
  try {
    const structure = await extractStructure(url, withEnrichKey(options));
    if (structure.domain_map) {
      return {
        ...structure,
        ai_summary: `Mapped ${structure.domain_map.length} URL${structure.domain_map.length === 1 ? "" : "s"} on ${url}.`,
        id: uid(),
        created_at: new Date().toISOString(),
        _status: "success",
      };
    }
    const [ai_summary, links] = await Promise.all([
      summarize(structure, { personaId: options.personaId, intent: options.intent }),
      categorizeLinks(structure.links, structure.url),
    ]);
    const result = {
      ...structure,
      links,
      ai_summary,
      id: uid(),
      created_at: new Date().toISOString(),
      _status: "success",
    };
    if (options.generateContent) {
      try {
        result.generated_content = await generateContent(result, options.generateContent);
      } catch (err) {
        console.warn("[DatIQ] Retry content generation failed for", url, err?.message);
      }
    }
    const { enrichments, activeTab } = buildBatchEnrichments({
      options,
      structure,
      generatedContentText: result.generated_content,
      createdAt: result.created_at,
    });
    if (Object.keys(enrichments).length > 0) {
      result.enrichments = enrichments;
      result.activeTab = activeTab;
    }
    return result;
  } catch (err) {
    return {
      url,
      id: uid(),
      created_at: new Date().toISOString(),
      _status: "error",
      _error: err?.message || "Extraction failed",
    };
  }
}
