// src/lib/engagement/syncConnectors.js — Google Sheets, Airtable & DatIQ Ingest Connectors
//
// Ingests, normalizes, deduplicates, and mirrors prospect records across:
//   1. Google Sheets
//   2. Airtable
//   3. Native DatIQ Extractions & Account Lists
//
// Ensures deduplication against existing database records matching on email/phone.

/**
 * Normalizes email address (lowercase, trim).
 */
export function normalizeEmail(email) {
  if (!email || typeof email !== "string") return null;
  const clean = email.trim().toLowerCase();
  return clean.includes("@") ? clean : null;
}

/**
 * Normalizes phone number (strips non-digit characters except leading +).
 */
export function normalizePhone(phone) {
  if (!phone || typeof phone !== "string") return null;
  const digits = phone.replace(/[^\d+]/g, "");
  return digits.length >= 7 ? digits : null;
}

/**
 * Splits a full name into first and last name components.
 */
export function splitName(fullName) {
  if (!fullName || typeof fullName !== "string") {
    return { first_name: null, last_name: null };
  }
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { first_name: parts[0], last_name: null };
  return {
    first_name: parts[0],
    last_name: parts.slice(1).join(" "),
  };
}

/**
 * Deduplicates incoming prospect records against existing records and within the batch.
 *
 * @param {Array<object>} incoming New prospects to import
 * @param {Array<object>} existing Already stored prospects in the campaign
 * @returns {{ unique: Array<object>, duplicates: Array<object>, stats: { total: number, uniqueCount: number, dupCount: number } }}
 */
export function dedupeProspects(incoming = [], existing = []) {
  const seenEmails = new Set();
  const seenPhones = new Set();

  for (const ex of existing) {
    const e = normalizeEmail(ex.email);
    const p = normalizePhone(ex.phone);
    if (e) seenEmails.add(e);
    if (p) seenPhones.add(p);
  }

  const unique = [];
  const duplicates = [];

  for (const item of incoming) {
    const email = normalizeEmail(item.email);
    const phone = normalizePhone(item.phone);

    let isDup = false;
    let dupReason = null;

    if (email && seenEmails.has(email)) {
      isDup = true;
      dupReason = `Duplicate email: ${email}`;
    } else if (phone && seenPhones.has(phone)) {
      isDup = true;
      dupReason = `Duplicate phone: ${phone}`;
    }

    if (isDup) {
      duplicates.push({ ...item, dup_reason: dupReason });
    } else {
      if (email) seenEmails.add(email);
      if (phone) seenPhones.add(phone);
      unique.push({
        ...item,
        email: email || item.email || null,
        phone: phone || item.phone || null,
      });
    }
  }

  return {
    unique,
    duplicates,
    stats: {
      total: incoming.length,
      uniqueCount: unique.length,
      dupCount: duplicates.length,
    },
  };
}

/**
 * Maps raw rows from a Google Sheet into structured prospect records.
 *
 * @param {Array<object>} rows Raw row objects from sheet
 * @param {object} fieldMapping Custom mapping, e.g. { email: "Work Email", company: "Account" }
 * @returns {Array<object>}
 */
export function mapGoogleSheetRowsToProspects(rows = [], fieldMapping = {}) {
  if (!Array.isArray(rows)) return [];

  const defaultMapping = {
    name: "Name",
    firstName: "First Name",
    lastName: "Last Name",
    email: "Email",
    phone: "Phone",
    company: "Company",
    role: "Role",
    industry: "Industry",
    country: "Country",
  };

  const mapping = { ...defaultMapping, ...fieldMapping };

  return rows.map((row) => {
    // Find value by case-insensitive key lookup
    const getVal = (key) => {
      const target = mapping[key];
      if (!target) return null;
      for (const [k, v] of Object.entries(row)) {
        if (k.toLowerCase() === target.toLowerCase()) return v;
      }
      return null;
    };

    let firstName = getVal("firstName");
    let lastName = getVal("lastName");
    const fullName = getVal("name");

    if ((!firstName || !lastName) && fullName) {
      const split = splitName(fullName);
      firstName = firstName || split.first_name;
      lastName = lastName || split.last_name;
    }

    return {
      first_name: firstName || null,
      last_name: lastName || null,
      email: normalizeEmail(getVal("email")),
      phone: normalizePhone(getVal("phone")),
      company: getVal("company") || null,
      role: getVal("role") || null,
      industry: getVal("industry") || null,
      country: getVal("country") || null,
      source: "google_sheets",
      custom_attributes: { raw: row },
    };
  });
}

/**
 * Formats prospects for Google Sheet export.
 */
export function formatProspectsForGoogleSheet(prospects = []) {
  return prospects.map((p) => ({
    "ID": p.id,
    "First Name": p.first_name || "",
    "Last Name": p.last_name || "",
    "Email": p.email || "",
    "Phone": p.phone || "",
    "Company": p.company || "",
    "Role": p.role || "",
    "Industry": p.industry || "",
    "Status": p.status || "new",
    "Engagement Score": p.engagement_score || 0,
    "Channel Preference": p.channel_preference || "auto",
    "Last Contacted": p.last_contacted_at || "",
  }));
}

/**
 * Maps Airtable record objects to structured prospects.
 */
export function mapAirtableRecordsToProspects(records = [], fieldMapping = {}) {
  if (!Array.isArray(records)) return [];

  return records.map((rec) => {
    const fields = rec.fields || rec;
    const name = fields[fieldMapping.name || "Name"] || "";
    const split = splitName(name);

    return {
      source_id: rec.id || null,
      first_name: fields[fieldMapping.first_name || "First Name"] || split.first_name || null,
      last_name: fields[fieldMapping.last_name || "Last Name"] || split.last_name || null,
      email: normalizeEmail(fields[fieldMapping.email || "Email"]),
      phone: normalizePhone(fields[fieldMapping.phone || "Phone"]),
      company: fields[fieldMapping.company || "Company"] || null,
      role: fields[fieldMapping.role || "Title"] || fields[fieldMapping.role || "Role"] || null,
      industry: fields[fieldMapping.industry || "Industry"] || null,
      country: fields[fieldMapping.country || "Country"] || null,
      source: "airtable",
      custom_attributes: { airtable_record_id: rec.id },
    };
  });
}

/**
 * Formats prospects for Airtable record updates.
 */
export function formatProspectsForAirtable(prospects = []) {
  return prospects.map((p) => ({
    id: p.source_id || undefined,
    fields: {
      "Name": [p.first_name, p.last_name].filter(Boolean).join(" "),
      "Email": p.email || "",
      "Phone": p.phone || "",
      "Company": p.company || "",
      "Role": p.role || "",
      "Status": p.status || "new",
      "Engagement Score": p.engagement_score || 0,
    },
  }));
}

/**
 * Maps native DatIQ Extractions or enriched contact data into prospects.
 * This directly integrates DatIQ's web extraction outputs into outreach!
 *
 * @param {Array<object>|object} extractions Single extraction or list of extractions
 * @returns {Array<object>} Structured prospects ready to be queued
 */
export function mapDatIQExtractionsToProspects(extractions) {
  const list = Array.isArray(extractions) ? extractions : [extractions];
  const prospects = [];

  for (const item of list) {
    if (!item) continue;
    const company = item.page_title?.split(/[|\-–]/)[0]?.trim() || item.url?.replace(/^https?:\/\/(www\.)?/, "").split("/")[0] || null;

    // Check if extraction has contacts enrichment
    const contacts = item.enrichments?.contacts?.data?.contacts || item.custom_extraction?.contacts || [];

    if (Array.isArray(contacts) && contacts.length > 0) {
      for (const c of contacts) {
        const split = splitName(c.name || c.full_name);
        prospects.push({
          first_name: split.first_name || null,
          last_name: split.last_name || null,
          email: normalizeEmail(c.email),
          phone: normalizePhone(c.phone),
          company: company,
          role: c.role || c.title || "Leadership",
          industry: item.custom_extraction?.industry || "Technology",
          source: "datiq_extraction",
          source_id: item.id || null,
          custom_attributes: {
            source_url: item.url,
            linkedin: c.linkedin || null,
            ai_summary: item.ai_summary || null,
          },
        });
      }
    } else {
      // Fallback: create a single domain/account prospect if no named contacts found
      prospects.push({
        first_name: null,
        last_name: null,
        email: null,
        phone: null,
        company: company,
        role: "Management",
        industry: "General",
        source: "datiq_extraction",
        source_id: item.id || null,
        custom_attributes: {
          source_url: item.url,
          ai_summary: item.ai_summary || null,
        },
      });
    }
  }

  return prospects;
}
