// urlIngest.js — pure text → URL-list ingestion used by the Home composer's
// drag-drop, file-import, and text-paste flows (QW#1 from the MetaAI Quick Wins).
//
// Extracted out of HeroComposer.jsx so the logic is unit-testable. The composer
// only wires up the FileReader + dataTransfer glue and delegates here.
//
// Strategy:
//   1. If the text looks like a CSV (header row contains 'url' / 'urls' /
//      'website' / 'link' OR there's at least one comma), try parseUrlsFromCsv.
//   2. If that yields nothing OR the CSV parser errors, fall through to the
//      generic extractUrls which handles newlines, commas, semicolons, and
//      whitespace as separators, dedupes case-insensitively, and normalises to
//      https://.
//   3. Returns the canonical list of URLs plus a 'source' label for telemetry.
import { parseUrlsFromCsv } from "./batchService.js";
import { extractUrls } from "./utils.js";

const CSV_HEADER_HINT = /\b(url|urls|website|link)\b/i;

function looksLikeCsv(text) {
  if (!text) return false;
  const firstLine = text.split(/\r?\n/)[0] || "";
  // The only reliable signal that a payload is a CSV is a known column header
  // on the first line ("url" / "urls" / "website" / "link"). Without that we
  // can't distinguish a comma-separated URL list from a real CSV, and the URL
  // list is far more common in user-pasted content.
  return CSV_HEADER_HINT.test(firstLine);
}

/**
 * Ingest arbitrary text (CSV file body, plain text file body, or text/plain
 * drag payload) into a deduplicated, normalised list of URLs.
 *
 * @param {string} text
 * @returns {{ urls: string[], source: "csv" | "text" | "none" }}
 */
export function ingestUrls(text) {
  if (!text || !text.trim()) return { urls: [], source: "none" };

  // 1) CSV path
  if (looksLikeCsv(text)) {
    try {
      const csv = parseUrlsFromCsv(text);
      if (csv && Array.isArray(csv.urls) && csv.urls.length) {
        return { urls: csv.urls, source: "csv" };
      }
    } catch {
      // fall through
    }
  }

  // 2) Generic URL extraction (newline / comma / semicolon / whitespace sep)
  const { valid } = extractUrls(text);
  if (valid.length) return { urls: valid, source: "text" };

  return { urls: [], source: "none" };
}
