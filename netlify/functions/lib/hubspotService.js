// netlify/functions/lib/hubspotService.js
//
// HubSpot CRM adapter (F-INT-2 — HubSpot integration).
//
// Pushing DatIQ extraction data into HubSpot. The two entity types that
// matter for DatIQ's customers are:
//   • Contacts — people found in the "Leadership & Board" / "Contacts"
//     enrichment. HubSpot stores them in the `contacts` object.
//   • Companies — the company the page describes. HubSpot's CRM schema
//     puts these in the `companies` object.
//
// API shape (HubSpot CRM v3):
//   POST   https://api.hubapi.com/crm/v3/objects/contacts
//   PATCH  https://api.hubapi.com/crm/v3/objects/contacts/{id}     (by idProperty)
//   POST   https://api.hubapi.com/crm/v3/objects/contacts/search   (dedup)
//   POST   https://api.hubapi.com/crm/v3/objects/companies
//   PATCH  https://api.hubapi.com/crm/v3/objects/companies/{id}
//   POST   https://api.hubapi.com/crm/v3/objects/companies/search
//
// Authentication: a HubSpot Private App access token (recommended; fine for
// server-to-server). The token is stored server-side in
// `integration_connections.access_token`; the user pastes it once in the
// Account UI, we encrypt it (TODO: pgcrypto envelope; for now store
// plaintext but flag for v1.1) and never expose it back.
//
// All functions in this file are pure with one exception: `pushToHubSpot`
// (which calls fetch). Tests can override fetchFn to mock.

const HUBSPOT_API_BASE = "https://api.hubapi.com";

// ── Field mappers (pure) ────────────────────────────────────────────────────

/**
 * Map a DatIQ extraction's enrichment (or a single person object) to a
 * HubSpot contact `properties` object. The default mapping handles the
 * fields HubSpot exposes by default; users can override per-field in the
 * Account UI by editing the JSON.
 */
export function extractionContactToHubSpotProperties(person, mapping = DEFAULT_CONTACT_MAPPING) {
  if (!person || typeof person !== "object") return {};
  const out = {};
  for (const [hubspotKey, sourceKey] of Object.entries(mapping || {})) {
    if (!sourceKey) continue;
    const v = person[sourceKey];
    if (v == null) continue;
    if (typeof v === "string") {
      out[hubspotKey] = v.slice(0, 500);
    } else if (typeof v === "number" || typeof v === "boolean") {
      out[hubspotKey] = v;
    } else {
      // Arrays / objects: drop to JSON string. HubSpot's contact properties
      // are flat strings, so this is the safest default.
      try { out[hubspotKey] = JSON.stringify(v).slice(0, 500); } catch { /* skip */ }
    }
  }
  return out;
}

export const DEFAULT_CONTACT_MAPPING = Object.freeze({
  email: "email",
  firstname: "first_name",
  lastname: "last_name",
  phone: "phone",
  company: "company",
  jobtitle: "role",
  website: "website",
  // Custom DatIQ metadata:
  datiq_source_url: "source_url",
  datiq_extraction_id: "extraction_id",
});

/**
 * Map a DatIQ extraction to a HubSpot company `properties` object.
 */
export function extractionToHubSpotCompanyProperties(extraction, mapping = DEFAULT_COMPANY_MAPPING) {
  if (!extraction || typeof extraction !== "object") return {};
  const out = {};
  for (const [hubspotKey, sourceKey] of Object.entries(mapping || {})) {
    if (!sourceKey) continue;
    const v = readPath(extraction, sourceKey);
    if (v == null) continue;
    if (typeof v === "string") {
      out[hubspotKey] = v.slice(0, 500);
    } else if (typeof v === "number" || typeof v === "boolean") {
      out[hubspotKey] = v;
    } else {
      try { out[hubspotKey] = JSON.stringify(v).slice(0, 500); } catch { /* skip */ }
    }
  }
  return out;
}

export const DEFAULT_COMPANY_MAPPING = Object.freeze({
  name: "page_title",
  domain: "host",
  description: "ai_summary",
  website: "url",
});

function readPath(obj, path) {
  if (obj == null || !path) return undefined;
  // Support dotted paths: "host" or "links[0].href"
  const m = String(path).match(/^([^\[]+)(?:\[(\d+)\])?(?:\.(.+))?$/);
  if (!m) return obj[path];
  const [, head, idx, rest] = m;
  let cur = obj[head];
  if (idx != null) cur = Array.isArray(cur) ? cur[Number(idx)] : undefined;
  if (rest) cur = readPath(cur, rest);
  return cur;
}

// ── Dedup (search) ──────────────────────────────────────────────────────────

/**
 * Build a HubSpot search request to find a contact by email. Used as a
 * dedup key — push to an existing contact rather than creating a duplicate.
 */
export function buildContactSearchByEmail(email) {
  if (!email) throw new Error("buildContactSearchByEmail: email is required");
  return {
    filterGroups: [
      { filters: [{ propertyName: "email", operator: "EQ", value: email }] },
    ],
    properties: ["email", "firstname", "lastname"],
    limit: 1,
  };
}

export function buildCompanySearchByDomain(domain) {
  if (!domain) throw new Error("buildCompanySearchByDomain: domain is required");
  return {
    filterGroups: [
      { filters: [{ propertyName: "domain", operator: "EQ", value: domain }] },
    ],
    properties: ["name", "domain"],
    limit: 1,
  };
}

// ── Request builders (pure) ────────────────────────────────────────────────

export function buildContactCreateBody(properties) {
  return { properties: properties || {} };
}

export function buildContactUpdateBody(properties) {
  return { properties: properties || {} };
}

export function buildContactUrl(id) {
  return `${HUBSPOT_API_BASE}/crm/v3/objects/contacts${id ? `/${encodeURIComponent(id)}` : ""}`;
}

export function buildContactSearchUrl() {
  return `${HUBSPOT_API_BASE}/crm/v3/objects/contacts/search`;
}

export function buildCompanyCreateUrl() {
  return `${HUBSPOT_API_BASE}/crm/v3/objects/companies`;
}

export function buildCompanySearchUrl() {
  return `${HUBSPOT_API_BASE}/crm/v3/objects/companies/search`;
}

// ── Side-effecting: do the push ────────────────────────────────────────────

/**
 * Push a single contact to HubSpot. If the contact already exists (by
 * email), the existing record is updated; otherwise a new contact is
 * created. Returns { ok, id, created, error? }.
 */
export async function pushContactToHubSpot(properties, { accessToken, fetchFn } = {}) {
  const f = fetchFn || (typeof fetch !== "undefined" ? fetch : null);
  if (!f) return { ok: false, error: "No fetch available (SSR?)" };
  if (!accessToken) return { ok: false, error: "HUBSPOT_ACCESS_TOKEN is required" };
  if (!properties?.email) return { ok: false, error: "Contact properties.email is required" };

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  // 1. Search for an existing contact with this email
  let existingId = null;
  try {
    const searchRes = await f(buildContactSearchUrl(), {
      method: "POST",
      headers,
      body: JSON.stringify(buildContactSearchByEmail(properties.email)),
    });
    if (searchRes.ok) {
      const data = await searchRes.json();
      existingId = data?.results?.[0]?.id || null;
    }
  } catch { /* fall through to create */ }

  // 2. Create or update
  try {
    if (existingId) {
      const res = await f(buildContactUrl(existingId), {
        method: "PATCH",
        headers,
        body: JSON.stringify(buildContactUpdateBody(properties)),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        return { ok: false, error: `hubspot_${res.status}: ${txt.slice(0, 200)}` };
      }
      const data = await res.json();
      return { ok: true, id: data.id, created: false };
    }
    const res = await f(buildContactUrl(), {
      method: "POST",
      headers,
      body: JSON.stringify(buildContactCreateBody(properties)),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return { ok: false, error: `hubspot_${res.status}: ${txt.slice(0, 200)}` };
    }
    const data = await res.json();
    return { ok: true, id: data.id, created: true };
  } catch (err) {
    return { ok: false, error: err?.message || "network" };
  }
}

/**
 * Push a single company to HubSpot. Dedup is by `domain`. Returns the
 * HubSpot company id.
 */
export async function pushCompanyToHubSpot(properties, { accessToken, fetchFn } = {}) {
  const f = fetchFn || (typeof fetch !== "undefined" ? fetch : null);
  if (!f) return { ok: false, error: "No fetch available (SSR?)" };
  if (!accessToken) return { ok: false, error: "HUBSPOT_ACCESS_TOKEN is required" };
  if (!properties?.domain) return { ok: false, error: "Company properties.domain is required" };

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  let existingId = null;
  try {
    const searchRes = await f(buildCompanySearchUrl(), {
      method: "POST",
      headers,
      body: JSON.stringify(buildCompanySearchByDomain(properties.domain)),
    });
    if (searchRes.ok) {
      const data = await searchRes.json();
      existingId = data?.results?.[0]?.id || null;
    }
  } catch { /* fall through */ }

  try {
    if (existingId) {
      const res = await f(`${HUBSPOT_API_BASE}/crm/v3/objects/companies/${existingId}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ properties }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        return { ok: false, error: `hubspot_${res.status}: ${txt.slice(0, 200)}` };
      }
      const data = await res.json();
      return { ok: true, id: data.id, created: false };
    }
    const res = await f(buildCompanyCreateUrl(), {
      method: "POST",
      headers,
      body: JSON.stringify({ properties }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return { ok: false, error: `hubspot_${res.status}: ${txt.slice(0, 200)}` };
    }
    const data = await res.json();
    return { ok: true, id: data.id, created: true };
  } catch (err) {
    return { ok: false, error: err?.message || "network" };
  }
}

/**
 * Push a DatIQ extraction's enrichment to HubSpot: the company record plus
 * every contact in the leadership/contacts enrichment. Returns a per-row
 * result list.
 */
export async function pushExtractionToHubSpot(extraction, { accessToken, contactMapping, companyMapping, fetchFn } = {}) {
  if (!extraction) return { ok: false, error: "extraction is required" };
  const f = fetchFn || (typeof fetch !== "undefined" ? fetch : null);
  if (!f) return { ok: false, error: "No fetch available (SSR?)" };
  if (!accessToken) return { ok: false, error: "HUBSPOT_ACCESS_TOKEN is required" };

  // 1. Company
  const companyProps = extractionToHubSpotCompanyProperties(extraction, companyMapping);
  let companyResult = null;
  if (companyProps.domain) {
    companyResult = await pushCompanyToHubSpot(companyProps, { accessToken, fetchFn: f });
  }

  // 2. Contacts — derive from the extraction's enrichment. The v1
  //    enrichment shape is `{ contacts: { data: { people: [...] } } }` or
  //    `{ leadership: { data: { people: [...] } } }`. We walk both.
  const people = collectPeopleFromEnrichments(extraction);
  const contactResults = [];
  for (const person of people) {
    if (!person.email) continue; // HubSpot requires an email for dedup
    const props = extractionContactToHubSpotProperties(person, contactMapping);
    if (!props.email) continue;
    const r = await pushContactToHubSpot(props, { accessToken, fetchFn: f });
    contactResults.push({ name: person.name || person.email, ...r });
  }

  return {
    ok: true,
    company: companyResult,
    contacts: contactResults,
    counts: {
      contacts_attempted: contactResults.length,
      contacts_created: contactResults.filter((r) => r.created).length,
      contacts_updated: contactResults.filter((r) => r.ok && !r.created).length,
    },
  };
}

function collectPeopleFromEnrichments(extraction) {
  const out = [];
  const enrichments = extraction?.enrichments;
  if (!enrichments || typeof enrichments !== "object") return out;
  for (const value of Object.values(enrichments)) {
    const data = value?.data;
    if (!data || typeof data !== "object") continue;
    if (Array.isArray(data.people)) {
      for (const p of data.people) {
        if (p && typeof p === "object") out.push(p);
      }
    }
    if (Array.isArray(data.contacts)) {
      for (const p of data.contacts) {
        if (p && typeof p === "object") out.push(p);
      }
    }
  }
  return out;
}

export const _internal = {
  HUBSPOT_API_BASE,
  DEFAULT_CONTACT_MAPPING,
  DEFAULT_COMPANY_MAPPING,
  collectPeopleFromEnrichments,
};
