// src/lib/engagement/prospectImport.js — turn pasted CSV into prospects, and
// say exactly what happened to every row.
//
// PURE. The Import dialog runs it on every keystroke to show a live check, and
// runs it once more to build the request. The server re-validates everything it
// receives; this module exists so a person learns about a problem BEFORE they
// press Import, with a line number, rather than seeing "Imported 0".
//
// What used to go wrong, silently:
//   - one pasted line with no header row → the line WAS the header, zero data
//     rows, and the dialog closed as if it had worked;
//   - "First Name,Email Address" headers → no column matched, every row dropped;
//   - a quoted value containing a comma ("Acme, Inc.") shifted every column after it;
//   - rows with no email and no phone were dropped in the browser and never counted.
//
// Rules:
//   - A header row is optional. When the first line is a contact (it holds an
//     email or a phone number), it is IMPORTED, and each column's meaning is
//     worked out from its content: the column holding an email is email, a
//     phone-shaped one is phone, the rest follow the template order
//     (first_name, last_name, company, role, industry, country). The dialog
//     shows the result at the top, so a guess is visible, never silent.
//     (The first version refused such a paste — owner asked for it to work,
//     2026-09-24, because people test by typing a row.)
//   - An email OR phone column is required; without one nothing is reachable.
//   - A row is rejected (with a reason) rather than half-imported: a bad email,
//     a bad phone, no contact detail, or MORE values than headers (the usual
//     sign of an unquoted comma — importing it would put data in wrong fields).
//   - Unrecognised columns are kept as custom attributes, and listed.

import { normalizeAddress } from "./suppressionModel.js";
import { splitName } from "./syncConnectors.js";

export const MAX_IMPORT_ROWS = 1000; // mirrors MAX_PROSPECTS_PER_IMPORT on the server
const MAX_ISSUES_LISTED = 50;

/** The downloadable template, and the column order a header-less paste is read in. */
export const TEMPLATE_COLUMNS = ["first_name", "last_name", "email", "company", "role", "phone", "industry", "country"];
export const TEMPLATE_CSV = [
  TEMPLATE_COLUMNS.join(","),
  "Alice,Smith,alice@acme.com,Acme Corp,VP Engineering,+15551234567,Software,United States",
  'Bob,Jones,bob@apex.io,"Apex, Inc.",CEO,,Healthcare,India',
].join("\n") + "\n";

/** header (normalised) → prospect field */
const ALIASES = {
  first_name: ["first_name", "firstname", "first", "given_name", "fname"],
  last_name: ["last_name", "lastname", "last", "surname", "family_name", "lname"],
  full_name: ["name", "full_name", "fullname", "contact_name", "contact"],
  email: ["email", "email_address", "e_mail", "mail", "work_email", "emailaddress"],
  phone: ["phone", "phone_number", "mobile", "mobile_number", "cell", "telephone", "tel", "whatsapp", "contact_number"],
  company: ["company", "company_name", "organization", "organisation", "org", "account", "account_name"],
  role: ["role", "title", "job_title", "position", "designation"],
  industry: ["industry", "sector"],
  country: ["country", "location_country"],
};
const FIELD_BY_ALIAS = Object.fromEntries(
  Object.entries(ALIASES).flatMap(([field, list]) => list.map((a) => [a, field])),
);

export const FIELD_LABELS = {
  first_name: "First name", last_name: "Last name", full_name: "Full name", email: "Email",
  phone: "Phone", company: "Company", role: "Role", industry: "Industry", country: "Country",
};

const normHeader = (h) => String(h || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const looksLikeEmail = (v) => /[^\s@]+@[^\s@]+\.[^\s@]+/.test(v);
const looksLikePhone = (v) => /^[+\d\s().-]+$/.test(v) && v.replace(/\D/g, "").length >= 7;

/**
 * Column meanings for a paste whose first line is a contact, from content.
 * Email and phone are recognised wherever they sit; every other column takes
 * the next unused template name, in order; any left over are custom.
 */
export function inferColumns(firstRow = []) {
  const fields = new Array(firstRow.length).fill(null);
  const emailAt = firstRow.findIndex((v) => looksLikeEmail(String(v).trim()));
  if (emailAt >= 0) fields[emailAt] = "email";
  const phoneAt = firstRow.findIndex((v, i) => fields[i] === null && looksLikePhone(String(v).trim()));
  if (phoneAt >= 0) fields[phoneAt] = "phone";
  const rest = TEMPLATE_COLUMNS.filter((f) => f !== "email" && f !== "phone");
  let next = 0;
  return fields.map((f, i) => {
    if (f) return { header: f, field: f };
    const name = rest[next++];
    return name ? { header: name, field: name } : { header: `column_${i + 1}`, field: null };
  });
}

/** Pick the delimiter the header line uses most: comma, semicolon or tab. */
export function detectDelimiter(text) {
  const firstLine = String(text || "").split(/\r?\n/, 1)[0] || "";
  let best = ",";
  let bestCount = 0;
  for (const d of [",", ";", "\t"]) {
    const n = firstLine.split(d).length - 1;
    if (n > bestCount) { best = d; bestCount = n; }
  }
  return best;
}

/**
 * RFC 4180-style parse: quoted fields, "" escapes, delimiters and newlines
 * inside quotes, CRLF. Returns records with the physical line each started on.
 */
export function parseCsv(text, delimiter = ",") {
  const src = String(text || "");
  const records = [];
  let field = "";
  let row = [];
  let inQuotes = false;
  let line = 1;
  let rowLine = 1;
  let rowHasContent = false;

  const endField = () => { row.push(field); field = ""; };
  const endRow = () => {
    endField();
    if (rowHasContent || row.some((v) => v.trim() !== "")) records.push({ line: rowLine, values: row });
    row = [];
    rowHasContent = false;
  };

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1; } else inQuotes = false;
      } else {
        if (ch === "\n") line += 1;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field.trim() === "") { inQuotes = true; field = ""; rowHasContent = true; continue; }
    if (ch === delimiter) { endField(); rowHasContent = true; continue; }
    if (ch === "\r") continue;
    if (ch === "\n") { endRow(); line += 1; rowLine = line; continue; }
    field += ch;
  }
  if (field !== "" || row.length) endRow();
  return records;
}

function fatal(error, extra = {}) {
  return {
    ok: false, error, delimiter: ",", headerless: false, columns: [], customColumns: [], rows: [], issues: [],
    counts: { dataRows: 0, ready: 0, rejected: 0, repeated: 0 }, ...extra,
  };
}

/**
 * @returns {{
 *   ok: boolean, error: string|null, delimiter: string,
 *   headerless: boolean,                              // true = column meanings were inferred
 *   columns: {header: string, field: string|null}[], customColumns: string[],
 *   rows: object[],                                   // ready to send
 *   issues: {line: number, reason: string}[],          // rejected or skipped rows
 *   issuesTruncated: number,
 *   counts: { dataRows, ready, rejected, repeated },
 * }}
 */
export function analyzeProspectCsv(text) {
  if (!String(text || "").trim()) return fatal("Paste a header row and at least one contact.");

  const delimiter = detectDelimiter(text);
  const records = parseCsv(text, delimiter);
  if (records.length === 0) return fatal("Paste a header row and at least one contact.");

  const headerCells = records[0].values.map((h) => h.trim());
  const headerless = headerCells.some((v) => looksLikeEmail(v) || looksLikePhone(v));

  const seenFields = new Set();
  const columns = headerless
    ? inferColumns(headerCells)
    : headerCells.map((header) => {
      const field = FIELD_BY_ALIAS[normHeader(header)] || null;
      // A second column mapping to the same field is kept as custom, never merged.
      if (field && seenFields.has(field)) return { header, field: null };
      if (field) seenFields.add(field);
      return { header, field };
    });
  if (headerless) columns.forEach((c) => c.field && seenFields.add(c.field));
  const customColumns = columns.filter((c) => !c.field && c.header).map((c) => c.header);

  if (!seenFields.has("email") && !seenFields.has("phone")) {
    return fatal(
      `No email or phone column found. Columns read: ${headerCells.filter(Boolean).join(", ") || "(none)"}. Name one of them "email" or "phone".`,
      { delimiter, columns, customColumns },
    );
  }

  const dataRecords = headerless ? records : records.slice(1);
  if (dataRecords.length === 0) {
    return fatal("Only a header row was found. Add at least one contact on the lines below it.", { delimiter, columns, customColumns });
  }
  if (dataRecords.length > MAX_IMPORT_ROWS) {
    return fatal(`This paste has ${dataRecords.length} contacts. Import at most ${MAX_IMPORT_ROWS} at a time.`, { delimiter, columns, customColumns });
  }

  const rows = [];
  const issues = [];
  let rejected = 0;
  let repeated = 0;
  const seenEmail = new Map();
  const seenPhone = new Map();

  for (const rec of dataRecords) {
    const reject = (reason) => { rejected += 1; issues.push({ line: rec.line, reason }); };
    const values = rec.values;
    if (values.length > columns.length) {
      reject(`${values.length} values but the header has ${columns.length} columns. A value containing "${delimiter === "\t" ? "tab" : delimiter}" must be wrapped in double quotes.`);
      continue;
    }

    const p = {};
    const custom = {};
    columns.forEach((col, idx) => {
      const v = (values[idx] ?? "").trim();
      if (!v) return;
      if (col.field) p[col.field] = v;
      else if (col.header) custom[col.header] = v;
    });

    if (p.full_name && !p.first_name && !p.last_name) {
      const { first_name, last_name } = splitName(p.full_name);
      p.first_name = first_name;
      if (last_name) p.last_name = last_name;
    }
    delete p.full_name;

    const email = p.email ? normalizeAddress("email", p.email) : null;
    const phone = p.phone ? normalizeAddress("sms", p.phone) : null;
    if (p.email && !email) { reject(`"${p.email}" is not a valid email address.`); continue; }
    if (p.phone && !phone) { reject(`"${p.phone}" is not a valid phone number (use digits, optionally starting with +).`); continue; }
    if (!email && !phone) { reject("No email or phone on this row."); continue; }

    const firstSeen = (email && seenEmail.get(email)) || (phone && seenPhone.get(phone));
    if (firstSeen) {
      repeated += 1;
      issues.push({ line: rec.line, reason: `Same ${email && seenEmail.get(email) ? "email" : "phone"} as line ${firstSeen} — skipped.` });
      continue;
    }
    if (email) seenEmail.set(email, rec.line);
    if (phone) seenPhone.set(phone, rec.line);

    const out = { ...p, source: "csv" };
    if (email) out.email = email; else delete out.email;
    if (phone) out.phone = phone; else delete out.phone;
    if (Object.keys(custom).length) out.custom_attributes = custom;
    rows.push(out);
  }

  return {
    ok: rows.length > 0,
    error: rows.length > 0 ? null : "None of the rows can be imported — see the problems listed below.",
    delimiter,
    headerless,
    columns,
    customColumns,
    rows,
    issues: issues.slice(0, MAX_ISSUES_LISTED),
    issuesTruncated: Math.max(0, issues.length - MAX_ISSUES_LISTED),
    counts: { dataRows: dataRecords.length, ready: rows.length, rejected, repeated },
  };
}

/**
 * Combine what the browser skipped with what the server reported into the one
 * summary the dialog shows after an import.
 */
export function importOutcome(analysis, response = {}) {
  const stats = response.stats || {};
  const added = Array.isArray(response.prospects) ? response.prospects.length : 0;
  return {
    added,
    alreadyInCampaign: stats.dupCount || 0,
    rejectedByServer: stats.invalidCount || 0,
    rejectedBeforeSending: analysis?.counts?.rejected || 0,
    repeatedInPaste: analysis?.counts?.repeated || 0,
    totalRows: analysis?.counts?.dataRows || 0,
  };
}
