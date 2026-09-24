// @vitest-environment node
// src/lib/engagement/prospectFiles.xlsx.test.js — a REAL .xlsx through the real
// read-excel-file parser (node build; the browser build shares its code) and our
// converter, so the lazy-loaded path is exercised end to end, not only mocked.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import readXlsxFile from "read-excel-file/node";
import { readProspectFile } from "./prospectFiles.js";
import { analyzeProspectCsv } from "./prospectImport.js";

const fixture = fileURLToPath(new URL("./__fixtures__/prospects.xlsx", import.meta.url));

describe("a real Excel workbook", () => {
  it("becomes rows the import checker understands, problems included", async () => {
    const bytes = readFileSync(fixture);
    const file = { name: "prospects.xlsx", size: bytes.length, type: "" };
    const r = await readProspectFile(file, { readXlsx: () => readXlsxFile(bytes) });
    expect(r.ok).toBe(true);
    expect(r.sheets.map((s) => s.name)).toEqual(["Leads"]);
    const a = analyzeProspectCsv(r.text);
    expect(a.rows).toEqual([{ first_name: "Ana", email: "ana@acme.test", company: "Acme, Inc.", source: "csv" }]);
    expect(a.issues).toEqual([{ line: 3, reason: '"not-an-email" is not a valid email address.' }]);
  });
});
