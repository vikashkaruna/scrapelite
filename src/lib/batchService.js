// batchService.js — parallel batch URL extraction with concurrency control.
// Each URL is extracted independently; results stream back via onProgress.
import { extractStructure } from "./firecrawlService.js";
import { summarize, categorizeLinks } from "./aiService.js";
import { uid } from "./utils.js";

// Max simultaneous in-flight requests to avoid hammering the API.
const CONCURRENCY = 3;

/**
 * Run batch extraction on an array of URLs.
 *
 * @param {string[]} urls - list of fully-qualified URLs
 * @param {object} options - passed to extractStructure (renderJs, customPrompt)
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
        const structure = await extractStructure(url, options);
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
            summarize(structure),
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
