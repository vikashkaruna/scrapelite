// src/lib/engagement/prospectFiles.js — turn an uploaded / dropped / pasted
// FILE into the text the import checker already understands.
//
// Every format ends as CSV text and goes through analyzeProspectCsv(), so a
// file and a paste are validated by exactly the same rules — there is no second
// parser to drift. Excel is read with `read-excel-file`, loaded only when an
// .xlsx is actually picked (never in the main bundle).
//
// Refused with a message a person can act on: legacy .xls and .numbers (save
// as .xlsx or CSV), anything over MAX_FILE_BYTES, an unreadable or empty file.

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const ACCEPT = ".csv,.tsv,.txt,.xlsx,text/csv,text/tab-separated-values,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const TEXT_EXT = new Set(["csv", "tsv", "txt"]);
const REFUSED = {
  xls: "This is an older Excel file (.xls). Open it in Excel and save it as .xlsx or CSV, then try again.",
  numbers: "Apple Numbers files can't be read here. Export it as CSV (File → Export To → CSV), then try again.",
  ods: "OpenDocument spreadsheets can't be read here. Save it as .xlsx or CSV, then try again.",
};

/** File → text: `file.text()` where it exists, FileReader otherwise (older browsers, test DOMs). */
function readText(file) {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

export const fileExtension = (name = "") => (String(name).toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || "";

/** Cells from a spreadsheet → CSV text (quoted where needed; dates as YYYY-MM-DD). */
export function rowsToCsv(rows = []) {
  const cell = (v) => {
    if (v == null) return "";
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
    const s = String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows
    .filter((r) => Array.isArray(r) && r.some((v) => v != null && String(v).trim() !== ""))
    .map((r) => r.map(cell).join(","))
    .join("\n");
}

/**
 * @param {File} file
 * @param {{ readXlsx?: (file: File) => Promise<{sheet: string, data: any[][]}[]> }} [deps]  injectable for tests
 * @returns {Promise<{ ok: true, text: string, fileName: string, sheets?: {name: string, text: string, rows: number}[] }
 *                  | { ok: false, error: string }>}
 */
export async function readProspectFile(file, deps = {}) {
  if (!file) return { ok: false, error: "No file was selected." };
  const name = file.name || "file";
  const ext = fileExtension(name);
  if (REFUSED[ext]) return { ok: false, error: REFUSED[ext] };
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, error: `${name} is ${(file.size / 1024 / 1024).toFixed(1)} MB. Files up to 5 MB can be imported — split it, or import the first 1,000 rows.` };
  }
  if (file.size === 0) return { ok: false, error: `${name} is empty.` };

  if (ext === "xlsx") {
    let sheets;
    try {
      const read = deps.readXlsx || (await import("read-excel-file/browser")).default;
      sheets = await read(file);
    } catch {
      return { ok: false, error: `${name} couldn't be read as an Excel workbook. If it's password-protected or damaged, save it again as .xlsx or CSV.` };
    }
    const usable = (sheets || [])
      .map((s) => ({ name: s.sheet, text: rowsToCsv(s.data), rows: (s.data || []).length }))
      .filter((s) => s.text.trim());
    if (usable.length === 0) return { ok: false, error: `Every sheet in ${name} is empty.` };
    return { ok: true, fileName: name, text: usable[0].text, sheets: usable };
  }

  if (TEXT_EXT.has(ext) || /^text\//.test(file.type || "")) {
    let text;
    try { text = await readText(file); } catch { return { ok: false, error: `${name} couldn't be read.` }; }
    text = text.replace(/^\uFEFF/, ""); // Excel's "CSV UTF-8" starts with a byte-order mark
    if (!text.trim()) return { ok: false, error: `${name} is empty.` };
    return { ok: true, fileName: name, text };
  }

  return { ok: false, error: `${name} isn't a supported file. Use CSV, TSV, TXT or Excel (.xlsx) — or download the template.` };
}
