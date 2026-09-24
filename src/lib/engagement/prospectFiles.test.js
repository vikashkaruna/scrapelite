// src/lib/engagement/prospectFiles.test.js
import { describe, it, expect, vi } from "vitest";
import { readProspectFile, rowsToCsv, MAX_FILE_BYTES } from "./prospectFiles.js";
import { analyzeProspectCsv } from "./prospectImport.js";

const file = (name, content, type = "") => new File([content], name, { type });

describe("readProspectFile", () => {
  it("reads a CSV, dropping Excel's byte-order mark", async () => {
    const r = await readProspectFile(file("list.csv", "\uFEFFemail,first_name\nana@x.test,Ana\n", "text/csv"));
    expect(r).toMatchObject({ ok: true, fileName: "list.csv" });
    expect(r.text.startsWith("email")).toBe(true);
    expect(analyzeProspectCsv(r.text).counts.ready).toBe(1);
  });

  it("reads an Excel workbook through the (lazy) reader, every non-empty sheet offered", async () => {
    const readXlsx = vi.fn(async () => [
      { sheet: "Leads", data: [["email", "company"], ["ana@x.test", "Acme, Inc."], [null, null]] },
      { sheet: "Empty", data: [[null]] },
      { sheet: "More", data: [["email"], ["bo@x.test"]] },
    ]);
    const r = await readProspectFile(file("book.xlsx", "PK"), { readXlsx });
    expect(r.ok).toBe(true);
    expect(r.sheets.map((s) => s.name)).toEqual(["Leads", "More"]);
    expect(r.text).toBe('email,company\nana@x.test,"Acme, Inc."');
    expect(analyzeProspectCsv(r.text).rows[0]).toMatchObject({ email: "ana@x.test", company: "Acme, Inc." });
  });

  it("says so when a workbook can't be read", async () => {
    const r = await readProspectFile(file("bad.xlsx", "x"), { readXlsx: async () => { throw new Error("zip"); } });
    expect(r.error).toMatch(/couldn't be read as an Excel workbook/);
  });

  it("refuses the formats it cannot read, with what to do instead", async () => {
    expect((await readProspectFile(file("old.xls", "x"))).error).toMatch(/save it as \.xlsx or CSV/);
    expect((await readProspectFile(file("sheet.numbers", "x"))).error).toMatch(/Export it as CSV/);
    expect((await readProspectFile(file("photo.png", "x", "image/png"))).error).toMatch(/isn't a supported file/);
  });

  it("refuses empty and oversized files", async () => {
    expect((await readProspectFile(file("e.csv", ""))).error).toMatch(/is empty/);
    const big = { name: "big.csv", size: MAX_FILE_BYTES + 1, type: "text/csv", text: async () => "" };
    expect((await readProspectFile(big)).error).toMatch(/Files up to 5 MB/);
  });
});

describe("rowsToCsv", () => {
  it("quotes where needed, formats dates, drops blank rows", () => {
    expect(rowsToCsv([["a", 'say "hi"', new Date("2026-09-24T10:00:00Z")], [null, ""], ["x\ny", 3]]))
      .toBe('a,"say ""hi""",2026-09-24\n"x\ny",3');
  });
});
