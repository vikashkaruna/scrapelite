// utils.js — small pure helpers shared across screens.

import {
  buildBrandingContext,
  brandingMarkdownHeader,
  brandingMarkdownFooter,
  brandingCsvHeaderRows,
  brandingCsvFooterRows,
  brandingJsonMeta,
} from "./exportBranding.js";

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return String(url).replace(/^https?:\/\/(www\.)?/, "").split("/")[0];
  }
}

export function pathOf(url) {
  try {
    const u = new URL(url);
    return (u.pathname + u.search).replace(/\/$/, "") || "/";
  } catch {
    return "";
  }
}

export function isExternal(href, base) {
  try {
    return new URL(href).hostname.replace(/^www\./, "") !== hostOf(base);
  } catch {
    return false;
  }
}

export function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  const day = 86400;
  if (diff < 3600) return Math.max(1, Math.round(diff / 60)) + "m ago";
  if (diff < day) return Math.round(diff / 3600) + "h ago";
  if (diff < day * 7) return Math.round(diff / day) + "d ago";
  return fmtDate(iso);
}

// deterministic hue from a string — used for favicon dots
export function hueOf(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return h;
}

export function snippet(text, n = 130) {
  if (!text) return "";
  return text.length > n ? text.slice(0, n).replace(/\s+\S*$/, "") + "…" : text;
}

export function uid() {
  return "ex_" + Math.random().toString(36).slice(2, 6) + Date.now().toString(36).slice(-3);
}

// Validate a user-typed URL (scheme optional) and normalize it to include https://.
export function isValidUrl(value) {
  return /^(https?:\/\/)?([\w-]+\.)+[\w-]{2,}(\/.*)?$/i.test(String(value).trim());
}

export function normalizeUrl(value) {
  let u = String(value).trim();
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  return u;
}

// ── Input classification (single URL · multi-URL · raw text) ─────────────────
// The Home composer accepts anything: a single URL, a list of URLs, or raw
// text / HTML pasted in. These helpers decide how to route the input.

// True only when the whole trimmed string is a single bare URL (no spaces, one token).
export function looksLikeUrl(value) {
  const s = String(value).trim();
  if (!s || /\s/.test(s)) return false;
  return isValidUrl(s);
}

// Split a blob into the URLs it contains (newline / comma / semicolon / whitespace
// separated), deduped and normalized to https://. Returns { valid, invalid }.
// Trailing punctuation that belongs to the surrounding sentence, not the URL.
// Only matters once URLs can come from prose ("…see https://figma.com/pricing.")
// — in a one-URL-per-line list there is nothing to strip. Left alone: a
// trailing "/" (a real path) and a ")" that closes a "(" inside the URL itself,
// as in Wikipedia links.
function trimUrlPunctuation(token) {
  let t = token;
  // Leading wrappers: "(https://x)", "<https://x>", quotes, markdown brackets.
  while (t.length > 1 && /^[([<'"«“‘]/.test(t)) t = t.slice(1);
  while (t.length > 1 && /[.,;:!?'"»”’>\]]$/.test(t)) t = t.slice(0, -1);
  // A ")" only closes the URL when it has no matching "(" inside it — so
  // en.wikipedia.org/wiki/Foo_(bar) keeps its paren, but "(https://b.com)"
  // does not (its "(" was already stripped above).
  while (t.length > 1 && t.endsWith(")") && (t.match(/\(/g) || []).length < (t.match(/\)/g) || []).length) {
    t = t.slice(0, -1);
  }
  return t;
}

export function extractUrls(text) {
  const raw = String(text)
    .split(/[\n,;\s]+/)
    .map((s) => trimUrlPunctuation(s.trim()))
    .filter(Boolean);
  const valid = [];
  const invalid = [];
  const seen = new Set();
  for (const r of raw) {
    if (!isValidUrl(r)) { invalid.push(r); continue; }
    const n = normalizeUrl(r);
    const key = n.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    valid.push(n);
  }
  return { valid, invalid };
}

// Classify what the user typed/pasted into the composer.
//   "single"   — exactly one URL
//   "multi"    — two or more URLs and little/no other prose
//   "csv"      — a CSV-shaped input (header row + data rows) — needs to go to /batch
//   "embedded" — prose/HTML/markdown that CONTAINS two or more URLs
//   "text"     — raw text / HTML to extract directly (paste-anything)
//   "empty"    — nothing meaningful
//
// Every result also carries `urls`, `urlCount`, `tokenCount` and `density`
// (urls ÷ tokens, 0–1). The verdict alone was not enough: "multi" requires
// nearly every token to be a URL, so pasting an email, a Slack thread or a
// markdown list that happens to contain eight links fell through to "text" and
// the whole blob was extracted as ONE pasted document. The URLs were already
// found and returned — nothing on the text path read them. `embedded` names
// that case so the composer can offer the choice instead of silently picking.
export function classifyInput(value) {
  const s = String(value).trim();
  if (!s) return { kind: "empty", urls: [], urlCount: 0, tokenCount: 0, density: 0 };

  const tokenCount = s.split(/[\n,;\s]+/).map((t) => t.trim()).filter(Boolean).length;

  if (looksLikeUrl(s)) {
    const urls = [normalizeUrl(s)];
    return { kind: "single", urls, urlCount: 1, tokenCount, density: 1 };
  }

  const { valid } = extractUrls(s);
  const density = tokenCount === 0 ? 0 : valid.length / tokenCount;
  const base = { urls: valid, urlCount: valid.length, tokenCount, density };

  // Treat as a URL list when the input is essentially a set of links: every
  // whitespace/line/comma token resolves to a URL (allow a couple of stray tokens).
  if (valid.length >= 2 && valid.length >= tokenCount - 1) {
    return { ...base, kind: "multi" };
  }
  if (valid.length === 1 && tokenCount === 1) {
    return { ...base, kind: "single" };
  }
  // Q1 — CSV detection. A CSV has a header line with column names + at least
  // one data row. We treat as CSV when the first line is non-URL text with
  // multiple comma-separated values and the second line is a comma-separated
  // record (URLs or otherwise).
  if (looksLikeCsv(s)) {
    return { ...base, kind: "csv" };
  }
  // Prose that carries a usable set of links. Checked before "text" so the
  // composer can ask, but deliberately NOT auto-routed: a newsletter with ten
  // links is genuinely ambiguous — extract the ten pages, or summarise the
  // newsletter? Only the reader knows.
  if (valid.length >= EMBEDDED_MIN_URLS) {
    return { ...base, kind: "embedded" };
  }
  // Anything else is raw content (a pricing table, an email thread, newsletter HTML…).
  return { ...base, kind: "text" };
}

// Below this, prose with a stray link is just prose — one link in an article is
// far more likely to be a citation than a request to extract that page.
export const EMBEDDED_MIN_URLS = 2;

// CSV detection heuristic for Q1 smart composer.
//   - Multi-line input
//   - At least 2 lines
//   - First line has ≥ 2 commas
//   - First line is not a URL itself
//   - Second line is not a URL itself (so we don't false-positive on
//     paste-anything that has a stray comma)
//   - We intentionally do NOT require the first line to have a "url" header
//     word — even a "Name,Website,Description" CSV counts as CSV.
//     (Note: the composer forwards the EXTRACTED URLs, not the CSV body, so
//     /batch never sees the columns and there is no column picker there. The
//     detected column name is surfaced on Home instead.)
export function looksLikeCsv(text) {
  const s = String(text).trim();
  if (!s.includes("\n")) return false;
  const lines = s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return false;
  const headerCells = lines[0].split(",").map((c) => c.trim());
  if (headerCells.length < 2) return false;
  if (looksLikeUrl(lines[0])) return false;
  // Second line: must be a comma-separated record, but not a single URL
  const secondCells = lines[1].split(",").map((c) => c.trim());
  if (secondCells.length < 2) return false;
  if (looksLikeUrl(lines[1])) return false;
  return true;
}

// Looks like an HTML fragment/document rather than plain prose.
export function looksLikeHtml(text) {
  return /<\/?[a-z][\s\S]*>/i.test(String(text));
}

// Lightweight, stable string hash (FNV-1a, hex) — used for change detection on
// scheduled "track changes" runs. Not cryptographic; just a content fingerprint.
export function hashContent(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// ── Email helpers (for emailing selected extractions) ────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value) {
  return EMAIL_RE.test(String(value).trim());
}

// Split a free-text field (commas, spaces, semicolons, newlines) into unique
// valid / invalid email lists. Used by the "Send email" recipient input.
export function parseEmails(value) {
  const parts = String(value)
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set();
  const valid = [];
  const invalid = [];
  for (const p of parts) {
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    (isValidEmail(p) ? valid : invalid).push(p);
  }
  return { valid, invalid };
}

// Recursively flatten arbitrary JSON into [{ path, value }] leaf rows, so any
// enrichment/custom-extraction shape can be written to a flat CSV/PDF.
export function flattenJson(value, prefix = "") {
  const out = [];
  const walk = (v, path) => {
    if (v === null || v === undefined) {
      out.push({ path, value: "" });
    } else if (Array.isArray(v)) {
      if (v.length === 0) out.push({ path, value: "" });
      else v.forEach((item, i) => walk(item, path ? `${path}[${i}]` : `[${i}]`));
    } else if (typeof v === "object") {
      const keys = Object.keys(v);
      if (keys.length === 0) out.push({ path, value: "" });
      else keys.forEach((k) => walk(v[k], path ? `${path}.${k}` : k));
    } else {
      out.push({ path, value: String(v) });
    }
  };
  walk(value, prefix);
  return out;
}

// All exportable rows for ONE extraction: meta + structure + every capability's
// data. Each row is [type, name, text, value]. This is the single source of
// truth for both CSV and (indirectly) the PDF export.
export function extractionRows(e) {
  const rows = [];
  rows.push(["meta", "url", e.url || "", ""]);
  rows.push(["meta", "title", e.page_title || "", ""]);
  if (e.ai_summary) rows.push(["meta", "summary", e.ai_summary, ""]);

  (e.headings || []).forEach((h) => rows.push(["heading", h.tag, h.text, ""]));
  (e.links || []).forEach((l) => rows.push(["link", l.category || "", l.text, l.href]));
  (e.domain_map || []).forEach((u) => rows.push(["mapped-url", "", "", u]));

  // Every enrichment capability, fully flattened. Fall back to a bare
  // custom_extraction if the row predates the enrichments map.
  const entries = Object.values(e.enrichments || {});
  if (entries.length) {
    for (const en of entries) {
      if (en?.data == null) continue;
      flattenJson(en.data).forEach(({ path, value }) =>
        rows.push(["enrichment", en.label || en.key, path, value]),
      );
    }
  } else if (e.custom_extraction != null) {
    flattenJson(e.custom_extraction).forEach(({ path, value }) =>
      rows.push(["custom", "Custom extraction", path, value]),
    );
  }
  return rows;
}

const csvEsc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

// Build a CSV string from an extraction (kept for single-item callers).
export function extractionToCsv(extraction) {
  const rows = [["type", "name", "text", "value"], ...extractionRows(extraction)];
  return rows.map((r) => r.map(csvEsc).join(",")).join("\r\n");
}

// Build one combined CSV across one or more extractions, with a leading "page"
// column so rows from different extractions stay distinguishable. Branded
// with leading/trailing "#"-prefixed comment rows (see exportBranding.js) —
// ignored by Excel/Sheets/Papa.parse and every real CSV consumer, so the
// data rows themselves stay exactly as before.
export function extractionsToCsv(items, { generatedAt = null, brandKit = null } = {}) {
  const list = Array.isArray(items) ? items : [items];
  const ctx = buildBrandingContext({
    kind: list.length > 1 ? "batch" : "extraction",
    sourceUrls: list.map((e) => e.url).filter(Boolean),
    generatedAt: generatedAt || new Date().toISOString(),
    brandKit,
  });
  const rows = [["page", "type", "name", "text", "value"]];
  for (const e of list) {
    const page = hostOf(e.url) + (pathOf(e.url) !== "/" ? pathOf(e.url) : "");
    for (const r of extractionRows(e)) rows.push([page, ...r]);
  }
  const dataCsv = rows.map((r) => r.map(csvEsc).join(",")).join("\r\n");
  return [...brandingCsvHeaderRows(ctx), dataCsv, ...brandingCsvFooterRows(ctx)].join("\r\n");
}

// Trigger a browser file download from a Blob.
function triggerDownload(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/**
 * Download a string the caller has already rendered.
 *
 * csvDownload / markdownDownload / jsonDownload all take EXTRACTION ROWS and
 * build the document themselves. The Discoverability reports arrive from the
 * server already rendered — the server owns that formatting so an exported
 * report and the screen it came from can never disagree — so they need a helper
 * that takes finished text rather than rows to format.
 *
 * @param {string} content
 * @param {string} filename
 * @param {string} mime
 */
export function downloadTextFile(content, filename, mime = "text/plain;charset=utf-8;") {
  const blob = new Blob([String(content ?? "")], { type: mime });
  triggerDownload(blob, filename);
  return { name: filename, blob };
}

// Download one or more extractions as a single CSV (all capabilities included).
export function csvDownload(items, opts = {}) {
  const list = Array.isArray(items) ? items : [items];
  const csv = extractionsToCsv(list, opts);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const name =
    list.length === 1
      ? `datiq-${hostOf(list[0].url)}-${list[0].id || "export"}.csv`
      : `datiq-export-${list.length}-pages.csv`;
  triggerDownload(blob, name);
  return { csv, name, blob };
}

// Build one combined TSV (Tab-Separated Values) across one or more extractions.
// When copied to clipboard, TSV pastes cleanly into Google Sheets and Microsoft Excel
// across rows and columns in 1 keystroke (Cmd+V / Ctrl+V in cell A1).
export function extractionsToTsv(items) {
  const list = Array.isArray(items) ? items : [items];
  const rows = [["page", "type", "name", "text", "value"]];
  for (const e of list) {
    const page = hostOf(e.url) + (pathOf(e.url) !== "/" ? pathOf(e.url) : "");
    for (const r of extractionRows(e)) rows.push([page, ...r]);
  }
  return rows
    .map((r) =>
      r
        .map((cell) =>
          String(cell ?? "")
            .replace(/\t/g, " ")
            .replace(/[\r\n]+/g, " ")
        )
        .join("\t")
    )
    .join("\r\n");
}

// Build an Excel XML Spreadsheet (Worksheet) document compatible with Microsoft Excel,
// Apple Numbers, Google Drive, and LibreOffice Calc.
export function extractionsToExcel(items) {
  const list = Array.isArray(items) ? items : [items];
  const rows = [["page", "type", "name", "text", "value"]];
  for (const e of list) {
    const page = hostOf(e.url) + (pathOf(e.url) !== "/" ? pathOf(e.url) : "");
    for (const r of extractionRows(e)) rows.push([page, ...r]);
  }
  const xmlEscape = (val) =>
    String(val ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");

  const rowXml = rows
    .map(
      (r) =>
        `   <Row>\n` +
        r
          .map((cell) => `    <Cell><Data ss:Type="String">${xmlEscape(cell)}</Data></Cell>`)
          .join("\n") +
        `\n   </Row>`
    )
    .join("\n");

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<?mso-application progid="Excel.Sheet"?>\n` +
    `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"\n` +
    ` xmlns:o="urn:schemas-microsoft-com:office:office"\n` +
    ` xmlns:x="urn:schemas-microsoft-com:office:excel"\n` +
    ` xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n` +
    ` <Worksheet ss:Name="DatIQ Extraction">\n` +
    `  <Table>\n` +
    rowXml +
    `\n  </Table>\n` +
    ` </Worksheet>\n` +
    `</Workbook>`
  );
}

// Download one or more extractions as an Excel Worksheet (.xls).
export function excelDownload(items) {
  const list = Array.isArray(items) ? items : [items];
  const xls = extractionsToExcel(list);
  const blob = new Blob([xls], { type: "application/vnd.ms-excel;charset=utf-8;" });
  const name =
    list.length === 1
      ? `datiq-${hostOf(list[0].url)}-${list[0].id || "export"}.xls`
      : `datiq-export-${list.length}-pages.xls`;
  triggerDownload(blob, name);
  return { xls, name, blob };
}

// DeepSeq QW#3 — "Open in Google Sheets" workflow:
//   1. Downloads the CSV locally so the user has the physical file.
//   2. Copies tabular data (TSV) to the user's clipboard automatically so that
//      pressing Cmd+V / Ctrl+V in cell A1 instantly fills the new Google Sheet.
//   3. Opens Google Sheets in a new tab.
export const GOOGLE_SHEETS_NEW_URL = "https://docs.google.com/spreadsheets/create?usp=datiq_sheet";

export function openInGoogleSheets(items) {
  const meta = csvDownload(items);
  const tsv = extractionsToTsv(items);
  copyTextToClipboard(tsv).catch(() => {});
  if (typeof window !== "undefined" && window.open) {
    window.open(GOOGLE_SHEETS_NEW_URL, "_blank", "noopener,noreferrer");
  }
  return { ...meta, tsv, copied: true };
}

// ── Clipboard copy (F01 — Export dropdown "Copy as …" option) ──────────────
//
// Each format produces the same string that the matching file-download
// function would, but instead of triggering a download we put the text on
// the clipboard. Falls back to a hidden <textarea> + execCommand for
// browsers without `navigator.clipboard` (older Safari, non-secure contexts).
//
// Returns `{ ok: true, text, chars }` on success or `{ ok: false, reason }`
// when the write is blocked (caller decides what to show).

const CLIPBOARD_FORMATS = new Set(["csv", "tsv", "json", "markdown", "summary"]);

function summarizeText(extraction) {
  const e = extraction || {};
  return String(e.ai_summary || e.summary || e.description || "").trim();
}

export function buildClipboardPayload(items, format = "csv") {
  const list = Array.isArray(items) ? items : [items];
  switch (format) {
    case "csv":      return { text: extractionsToCsv(list),       mime: "text/csv" };
    case "tsv":      return { text: extractionsToTsv(list),       mime: "text/tab-separated-values" };
    case "json":     return { text: extractionsToJson(list), mime: "application/json" };
    case "markdown": return { text: extractionsToMarkdown(list),  mime: "text/markdown" };
    case "summary":  return { text: list.map(summarizeText).filter(Boolean).join("\n\n---\n\n"), mime: "text/plain" };
    default:
      throw new Error(`buildClipboardPayload: unknown format "${format}"`);
  }
}

export function listClipboardFormats() {
  return Array.from(CLIPBOARD_FORMATS);
}

async function writeViaExecCommand(text) {
  if (typeof document === "undefined") return false;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand && document.execCommand("copy");
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

/**
 * Write a raw string to the clipboard.
 *
 * The two-path fallback (navigator.clipboard, then execCommand) is shared with
 * copyToClipboard rather than duplicated: some browsers reject a clipboard
 * write outside a user gesture or in an unfocused window, and a second copy of
 * that handling is a second copy to keep working.
 *
 * copyToClipboard() takes EXTRACTION ROWS and a format. This takes text that is
 * already text — a generated JSON-LD block, a markdown answer block — which is
 * what the Discoverability constructs are.
 *
 * @returns {Promise<boolean>} whether the text reached the clipboard
 */
export async function copyTextToClipboard(text) {
  const str = String(text ?? "");
  if (!str) return false;
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(str);
      return true;
    } catch (err) {
      if (typeof console !== "undefined") {
        console.warn("[DatIQ] clipboard.writeText failed, trying execCommand:", err);
      }
    }
  }
  return Boolean(await writeViaExecCommand(str));
}

export async function copyToClipboard(items, format = "csv") {
  if (!CLIPBOARD_FORMATS.has(format)) {
    return { ok: false, reason: `unsupported_format:${format}` };
  }
  let payload;
  try {
    payload = buildClipboardPayload(items, format);
  } catch (err) {
    return { ok: false, reason: `payload_error:${err?.message || err}` };
  }
  const text = payload.text;
  if (!text || !text.length) {
    return { ok: false, reason: "empty_payload" };
  }

  // Modern path
  if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    try {
      await navigator.clipboard.writeText(text);
      return { ok: true, text, chars: text.length, format };
    } catch (err) {
      // Some browsers reject clipboard writes inside an unfocused window or
      // outside a user gesture. Fall through to the legacy path.
      if (typeof console !== "undefined") {
        console.warn("[DatIQ] clipboard.writeText failed, trying execCommand:", err);
      }
    }
  }

  // Legacy fallback
  const ok = await writeViaExecCommand(text);
  return ok
    ? { ok: true, text, chars: text.length, format }
    : { ok: false, reason: "execCommand_failed" };
}

// ── Markdown export ──────────────────────────────────────────────────────────

function mdEsc(text) {
  return String(text ?? "").replace(/[\\`*_{}[\]()#+\-.!|]/g, "\\$&");
}

export function extractionsToMarkdown(items, { generatedAt = null, brandKit = null } = {}) {
  const list = Array.isArray(items) ? items : [items];
  const generatedAtISO = generatedAt || new Date().toISOString();
  const ctx = buildBrandingContext({
    kind: list.length > 1 ? "batch" : "extraction",
    sourceUrls: list.map((e) => e.url).filter(Boolean),
    generatedAt: generatedAtISO,
    brandKit,
  });
  const lines = [brandingMarkdownHeader(ctx)];

  list.forEach((e, idx) => {
    // The header block above already ends with a "---" rule, so only insert
    // one before items after the first (avoids a doubled rule).
    if (idx > 0) lines.push(`---`, ``);
    lines.push(`## ${idx + 1}. ${mdEsc(e.page_title || hostOf(e.url))}`, ``);
    lines.push(`**URL:** <${e.url}>  `);
    if (e.created_at) {
      lines.push(`**Extracted:** ${fmtDate(e.created_at)}  `);
    }
    lines.push(``);

    if (e.ai_summary) {
      lines.push(`### AI Summary`, ``, e.ai_summary, ``);
    }

    if (e.headings?.length) {
      lines.push(`### Headings (${e.headings.length})`, ``);
      e.headings.forEach((h) => lines.push(`- **${h.tag}** ${mdEsc(h.text)}`));
      lines.push(``);
    }

    if (e.links?.length) {
      lines.push(`### Links (${e.links.length})`, ``);
      e.links.slice(0, 50).forEach((l) => {
        const label = mdEsc(l.text || l.href);
        const cat = l.category ? ` — ${l.category}` : "";
        lines.push(`- [${label}](${l.href})${cat}`);
      });
      if (e.links.length > 50) lines.push(`- *…and ${e.links.length - 50} more*`);
      lines.push(``);
    }

    if (e.domain_map?.length) {
      lines.push(`### Mapped URLs (${e.domain_map.length})`, ``);
      e.domain_map.slice(0, 100).forEach((u) => lines.push(`- <${u}>`));
      if (e.domain_map.length > 100) lines.push(`- *…and ${e.domain_map.length - 100} more*`);
      lines.push(``);
    }

    const enrichEntries = Object.values(e.enrichments || {});
    if (enrichEntries.length) {
      enrichEntries.forEach((en) => {
        if (en?.data == null) return;
        lines.push(`### ${mdEsc(en.label || en.key)}`, ``);
        flattenJson(en.data).forEach(({ path, value }) => {
          if (value) lines.push(`**${mdEsc(path)}:** ${mdEsc(value)}  `);
        });
        lines.push(``);
      });
    } else if (e.custom_extraction != null) {
      lines.push(`### Custom Extraction`, ``);
      flattenJson(e.custom_extraction).forEach(({ path, value }) => {
        if (value) lines.push(`**${mdEsc(path)}:** ${mdEsc(value)}  `);
      });
      lines.push(``);
    }
  });

  lines.push(brandingMarkdownFooter(ctx));
  return lines.join("\n");
}

export function markdownDownload(items, opts = {}) {
  const list = Array.isArray(items) ? items : [items];
  const md = extractionsToMarkdown(list, opts);
  const blob = new Blob([md], { type: "text/markdown;charset=utf-8;" });
  const name =
    list.length === 1
      ? `datiq-${hostOf(list[0].url)}-${list[0].id || "export"}.md`
      : `datiq-export-${list.length}-pages.md`;
  triggerDownload(blob, name);
}

// ── JSON export ──────────────────────────────────────────────────────────────

export function extractionsToJson(items, { generatedAt = null, brandKit = null } = {}) {
  const list = Array.isArray(items) ? items : [items];
  const generatedAtISO = generatedAt || new Date().toISOString();
  const ctx = buildBrandingContext({
    kind: list.length > 1 ? "batch" : "extraction",
    sourceUrls: list.map((e) => e.url).filter(Boolean),
    generatedAt: generatedAtISO,
    brandKit,
  });
  const payload = {
    export: {
      ...brandingJsonMeta(ctx),
      version: "2.0",
      date: generatedAtISO,
      count: list.length,
    },
    pages: list.map((e) => {
      const page = {
        url: e.url,
        page_title: e.page_title || null,
        ai_summary: e.ai_summary || null,
        extracted_at: e.created_at || null,
        headings: (e.headings || []).map((h) => ({ tag: h.tag, text: h.text })),
        links: (e.links || []).map((l) => ({
          text: l.text,
          href: l.href,
          category: l.category || null,
        })),
      };
      if (e.domain_map?.length) page.domain_map = e.domain_map;
      const enrichEntries = Object.values(e.enrichments || {});
      if (enrichEntries.length) {
        page.enrichments = {};
        enrichEntries.forEach((en) => {
          if (en) page.enrichments[en.key || en.label] = en.data;
        });
      } else if (e.custom_extraction != null) {
        page.custom_extraction = e.custom_extraction;
      }
      return page;
    }),
  };
  return JSON.stringify(payload, null, 2);
}

export function jsonDownload(items, opts = {}) {
  const list = Array.isArray(items) ? items : [items];
  const json = extractionsToJson(list, opts);
  const blob = new Blob([json], { type: "application/json;charset=utf-8;" });
  const name =
    list.length === 1
      ? `datiq-${hostOf(list[0].url)}-${list[0].id || "export"}.json`
      : `datiq-export-${list.length}-pages.json`;
  triggerDownload(blob, name);
}
// touched Sun Jul 19 01:12:41 IST 2026
