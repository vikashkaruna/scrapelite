// src/lib/engagement/prospectImport.test.js
import { describe, it, expect } from "vitest";
import { analyzeProspectCsv, parseCsv, detectDelimiter, importOutcome, TEMPLATE_CSV } from "./prospectImport.js";

const HEADER = "first_name,last_name,email,company,role,phone";

describe("analyzeProspectCsv — the cases that used to import nothing, silently", () => {
  it("accepts contact rows typed without a header, reading columns from their content", () => {
    const a = analyzeProspectCsv("Alice,Smith,alice@acme.com,Acme,VP,+15551234567\nBob,Jones,bob@apex.io,Apex,CEO,");
    expect(a.ok).toBe(true);
    expect(a.headerless).toBe(true);
    expect(a.columns.map((c) => c.field)).toEqual(["first_name", "last_name", "email", "company", "role", "phone"]);
    expect(a.counts).toMatchObject({ dataRows: 2, ready: 2 });
    expect(a.rows[0]).toMatchObject({ first_name: "Alice", email: "alice@acme.com", phone: "+15551234567", role: "VP" });
  });

  it("finds the email and phone wherever they sit in a header-less row", () => {
    const a = analyzeProspectCsv("ana@x.test,Ana,+44 20 7946 0000,Medisync");
    expect(a.columns.map((c) => c.field)).toEqual(["email", "first_name", "phone", "last_name"]);
    expect(a.rows[0]).toMatchObject({ email: "ana@x.test", first_name: "Ana", phone: "+442079460000" });
  });

  it("still reads a real header row as a header", () => {
    const a = analyzeProspectCsv("email,first_name\nana@x.test,Ana");
    expect(a.headerless).toBe(false);
    expect(a.counts.dataRows).toBe(1);
  });

  it("offers a template that imports cleanly", () => {
    const a = analyzeProspectCsv(TEMPLATE_CSV);
    expect(a.headerless).toBe(false);
    expect(a.counts).toMatchObject({ dataRows: 2, ready: 2, rejected: 0 });
    expect(a.rows[1].company).toBe("Apex, Inc.");
  });

  it("refuses a header with nothing under it", () => {
    const a = analyzeProspectCsv(HEADER);
    expect(a.ok).toBe(false);
    expect(a.error).toMatch(/Only a header row/);
  });

  it("refuses a header with no email or phone column, naming the columns it read", () => {
    const a = analyzeProspectCsv("name,company\nAlice,Acme");
    expect(a.error).toMatch(/No email or phone column found\. Columns read: name, company/);
  });

  it("refuses empty input", () => {
    expect(analyzeProspectCsv("   \n ").error).toMatch(/Paste a header row/);
  });
});

describe("analyzeProspectCsv — reading real-world CSV", () => {
  it("imports the documented format", () => {
    const a = analyzeProspectCsv(`${HEADER}\nAlice,Smith,Alice@Acme.com,Acme,VP,+1 555 123 4567`);
    expect(a.ok).toBe(true);
    expect(a.rows).toEqual([{
      first_name: "Alice", last_name: "Smith", email: "alice@acme.com", company: "Acme",
      role: "VP", phone: "+15551234567", source: "csv",
    }]);
  });

  it("understands common header spellings and a full-name column", () => {
    const a = analyzeProspectCsv("Name,Email Address,Job Title,Mobile\nAna Lopez,ana@x.test,CTO,+44 20 7946 0000");
    expect(a.columns.map((c) => c.field)).toEqual(["full_name", "email", "role", "phone"]);
    expect(a.rows[0]).toMatchObject({ first_name: "Ana", last_name: "Lopez", role: "CTO", phone: "+442079460000" });
  });

  it("keeps a quoted comma inside its field", () => {
    const a = analyzeProspectCsv(`${HEADER}\nBob,Jones,bob@apex.io,"Apex, Inc.",CEO,`);
    expect(a.rows[0].company).toBe("Apex, Inc.");
  });

  it("reads semicolon- and tab-separated pastes, and CRLF line endings", () => {
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a\tb\tc")).toBe("\t");
    const a = analyzeProspectCsv("email;company\r\nana@x.test;Acme\r\n");
    expect(a.rows).toEqual([{ email: "ana@x.test", company: "Acme", source: "csv" }]);
  });

  it("keeps unknown columns as custom attributes and lists them", () => {
    const a = analyzeProspectCsv("email,linkedin\nana@x.test,https://linkedin.com/in/ana");
    expect(a.customColumns).toEqual(["linkedin"]);
    expect(a.rows[0].custom_attributes).toEqual({ linkedin: "https://linkedin.com/in/ana" });
  });

  it("allows short rows (trailing values left empty)", () => {
    expect(analyzeProspectCsv(`${HEADER}\nCai,,cai@x.test`).rows).toHaveLength(1);
  });
});

describe("analyzeProspectCsv — per-row rejection with line numbers", () => {
  const text = [
    HEADER,
    "Ok,One,ok1@x.test,,,",               // line 2 — fine
    "Bad,Email,not-an-email,,,",          // line 3 — invalid email
    "No,Contact,,Acme,,",                 // line 4 — no email/phone
    "Too,Many,t@x.test,Acme,CEO,+15550001111,extra", // line 5 — shifted columns
    "Dup,One,OK1@x.test,,,",              // line 6 — repeat of line 2
    "Bad,Phone,,,,12",                    // line 7 — invalid phone
  ].join("\n");
  const a = analyzeProspectCsv(text);

  it("counts every outcome", () => {
    expect(a.counts).toEqual({ dataRows: 6, ready: 1, rejected: 4, repeated: 1 });
  });

  it("gives each problem its line and a reason", () => {
    expect(a.issues.map((i) => i.line)).toEqual([3, 4, 5, 6, 7]);
    expect(a.issues[0].reason).toMatch(/not a valid email/);
    expect(a.issues[1].reason).toMatch(/No email or phone/);
    expect(a.issues[2].reason).toMatch(/7 values but the header has 6 columns/);
    expect(a.issues[3].reason).toMatch(/Same email as line 2/);
    expect(a.issues[4].reason).toMatch(/not a valid phone/);
  });

  it("is not ok when no row survives, and says so", () => {
    const none = analyzeProspectCsv(`${HEADER}\nBad,Email,nope,,,`);
    expect(none.ok).toBe(false);
    expect(none.error).toMatch(/None of the rows can be imported/);
    expect(none.issues).toHaveLength(1);
  });

  it("refuses more rows than one import allows", () => {
    const big = [HEADER, ...Array.from({ length: 1001 }, (_, i) => `a,b,u${i}@x.test,,,`)].join("\n");
    expect(analyzeProspectCsv(big).error).toMatch(/at most 1000/);
  });
});

describe("parseCsv", () => {
  it("records the physical line each record starts on, across quoted newlines", () => {
    const recs = parseCsv('a,b\n"multi\nline",x\n\nlast,y');
    expect(recs.map((r) => r.line)).toEqual([1, 2, 5]);
    expect(recs[1].values[0]).toBe("multi\nline");
  });
  it("unescapes doubled quotes", () => {
    expect(parseCsv('"say ""hi""",b')[0].values).toEqual(['say "hi"', "b"]);
  });
});

describe("importOutcome", () => {
  it("combines the browser's and the server's counts", () => {
    const analysis = { counts: { dataRows: 6, ready: 3, rejected: 2, repeated: 1 } };
    expect(importOutcome(analysis, { prospects: [{}, {}], stats: { dupCount: 1, invalidCount: 0 } })).toEqual({
      added: 2, alreadyInCampaign: 1, rejectedByServer: 0, rejectedBeforeSending: 2, repeatedInPaste: 1, totalRows: 6,
    });
  });
});
