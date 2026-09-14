// netlify/functions/api-v1.js
//
// Public REST API router (F-INT-1 — API Access, Business/Enterprise plans).
//
// This single function handles every endpoint documented in
// docs/DatIQ-Developer-API.md. Routing is internal: the `splat` query
// parameter carries the path after `/api/v1` (see netlify.toml redirect
// `/api/v1/*` → `/.netlify/functions/api-v1?splat=:splat`).
//
// Endpoints implemented:
//   POST   /v1/extractions              — extract a single page
//   GET    /v1/extractions              — list extractions (paginated)
//   GET    /v1/extractions/{id}         — retrieve one
//   DELETE /v1/extractions/{id}         — delete one
//   POST   /v1/extractions/{id}/enrichments
//   POST   /v1/extractions/{id}/content
//   POST   /v1/batches                  — submit a batch
//   GET    /v1/batches/{id}             — get status + results
//   GET    /v1/schedules                — list
//   POST   /v1/schedules                — create
//   GET    /v1/schedules/{id}
//   PATCH  /v1/schedules/{id}
//   DELETE /v1/schedules/{id}
//   POST   /v1/schedules/{id}/run       — run once immediately
//   POST   /v1/extractions/{id}/share   — public report (v1.0 preview)
//   DELETE /v1/extractions/{id}/share
//   GET    /v1/gallery
//   POST   /v1/extractions/{id}/feedback
//
// Most of these are thin re-exports of the existing /api/* handlers, with
// the difference that the caller is identified by an API key (not a
// Supabase JWT) and the response is the Developer-API-shaped envelope
// (camelCase extraction object, ISO timestamps, no Supabase metadata).
//
// ── KEEPING THE TWO PATHS IN SYNC ───────────────────────────────────────────
// The internal /api/* functions (used by the SPA) return rows in the raw
// Supabase shape. The public API returns the same data, reshaped into the
// Developer API contract. Any change to either side needs to be reflected
// here; the contract is the source of truth, not the other way around.

import { authenticateApiRequest, errorResponse, okResponse } from "./lib/apiAuth.js";
import { callInternalExtract, callInternalAi } from "./lib/apiV1Internals.js";
import { notifyExtractionComplete } from "./lib/notify.js";
import { createHash } from "node:crypto";

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Parse the `splat` query param into a path array. Examples:
 *   "extractions"                   → ["extractions"]
 *   "extractions/abc/enrichments"   → ["extractions", "abc", "enrichments"]
 *   ""                              → []
 */
export function parsePath(splat) {
  if (!splat) return [];
  return String(splat)
    .split("/")
    .map((s) => decodeURIComponent(s))
    .filter(Boolean);
}

/**
 * Resolve the sub-path from event.queryStringParameters.splat, falling back
 * to event.path when the query param is empty. See the matching helper in
 * discoverability.js for the full story: the query-string form of
 * Netlify's `:splat` substitution was already found to be unreliable on an
 * explicit-prefix wildcard rule — the same shape this route uses — so
 * netlify.toml now forwards the splat as a path segment instead.
 *
 * Two markers, not one: the function is named `api-v1` (hyphen), but the
 * public route is `/api/v1/*` (slash) — a DIFFERENT string — so unlike
 * discoverability.js (where the function name and the route segment are
 * the identical literal "discoverability"), this can't rely on a single
 * marker matching both the destination-path and original-request-path
 * shapes event.path might actually be. Try both explicitly.
 */
function resolveSplat(event) {
  const fromQuery = event.queryStringParameters?.splat || "";
  if (fromQuery) return fromQuery;
  const p = event.path || "";
  for (const marker of ["/api-v1/", "/api/v1/"]) {
    const idx = p.lastIndexOf(marker);
    if (idx !== -1) return p.slice(idx + marker.length);
  }
  return "";
}

function badRequest(message, extra = {}) {
  return errorResponse(400, "invalid_request", message, extra);
}

function notFound(message = "Resource not found.") {
  return errorResponse(404, "not_found", message);
}

function serverError(message = "Unexpected server error.", extra = {}) {
  return errorResponse(500, "server_error", message, extra);
}

function forbidden(message = "Your plan does not include this capability.") {
  return errorResponse(403, "forbidden", message);
}

async function readJsonBody(event) {
  if (!event.body) return {};
  if (event.isBase64Encoded) {
    try { return JSON.parse(Buffer.from(event.body, "base64").toString("utf8")); }
    catch { throw new Error("invalid_json"); }
  }
  try { return JSON.parse(event.body); }
  catch { throw new Error("invalid_json"); }
}

// ── Reshape helpers (raw row → public-API contract) ────────────────────────

/**
 * Convert a raw extractions row (Supabase) to the public-API extraction
 * object. This is the contract documented in DatIQ-Developer-API.md.
 */
export function reshapeExtraction(row) {
  if (!row) return null;
  return {
    id: row.id,
    url: row.url,
    title: row.page_title || row.title || "",
    intent: row.intent || "summary",
    summary: row.ai_summary || row.summary || "",
    headings: Array.isArray(row.headings) ? row.headings : [],
    links: Array.isArray(row.links) ? row.links : [],
    enrichments: row.enrichments && typeof row.enrichments === "object" ? row.enrichments : {},
    site_map: Array.isArray(row.domain_map) ? row.domain_map : undefined,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
  };
}

export function reshapeBatch(row) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status || "queued",
    intent: row.intent || "summary",
    total: Number(row.total) || 0,
    succeeded: Number(row.succeeded) || 0,
    failed: Number(row.failed) || 0,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    results: Array.isArray(row.results) ? row.results : [],
  };
}

export function reshapeSchedule(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name || row.label || null,
    url: row.url || (Array.isArray(row.target) ? row.target[0] : row.target) || null,
    intent: row.intent || "summary",
    cadence: row.cadence || row.schedule || "daily",
    status: row.status || "active",
    alert_email: row.alert_email || null,
    last_run_at: row.last_run_at ? new Date(row.last_run_at).toISOString() : null,
    last_status: row.last_status || null,
    next_run_at: row.next_run_at ? new Date(row.next_run_at).toISOString() : null,
    created_at: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
  };
}

// ── Downstream-call helper (so handlers can hit internal /api/* functions) ──
// We use the service-key Supabase REST handle directly, which is what the
// existing internal /api/extractions does internally. The router has access
// to the SERVICE key (env), so it can perform CRUD as the authenticated user
// by passing `user_id` filters.
function getServiceDb() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return {
    base: `${url}/rest/v1`,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
  };
}

async function dbSelect(db, table, query) {
  const qs = new URLSearchParams(query).toString();
  const res = await fetch(`${db.base}/${table}?${qs}`, { headers: db.headers });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    const e = new Error(`db_select_${res.status}: ${txt.slice(0, 200)}`);
    e.status = res.status;
    throw e;
  }
  return res.json();
}

async function dbInsert(db, table, row) {
  const res = await fetch(`${db.base}/${table}`, {
    method: "POST",
    headers: db.headers,
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    const e = new Error(`db_insert_${res.status}: ${txt.slice(0, 200)}`);
    e.status = res.status;
    throw e;
  }
  const out = await res.json();
  return Array.isArray(out) ? out[0] : out;
}

async function dbUpdate(db, table, match, patch) {
  const qs = Object.entries(match).map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`).join("&");
  const res = await fetch(`${db.base}/${table}?${qs}`, {
    method: "PATCH",
    headers: { ...db.headers, Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    const e = new Error(`db_update_${res.status}: ${txt.slice(0, 200)}`);
    e.status = res.status;
    throw e;
  }
  const out = await res.json();
  return Array.isArray(out) ? out[0] : out;
}

async function dbDelete(db, table, match) {
  const qs = Object.entries(match).map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`).join("&");
  const res = await fetch(`${db.base}/${table}?${qs}`, {
    method: "DELETE",
    headers: { ...db.headers, Prefer: "return=representation" },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    const e = new Error(`db_delete_${res.status}: ${txt.slice(0, 200)}`);
    e.status = res.status;
    throw e;
  }
  return true;
}

// ── Capability gates ───────────────────────────────────────────────────────
// Business+ plans get every endpoint. Free/starter get 402. The actual
// entitlement is in the API key's `plan_id` column (set at issue time).
function planAllowsEndpoint(planId, endpoint) {
  const p = String(planId || "").toLowerCase();
  if (p === "business" || p === "enterprise") return true;
  // Test keys can hit every endpoint (sandbox); the response is deterministic
  // fixture data so quota doesn't burn.
  if (p === "__test__") return true;
  return false;
}

// ── Handlers ───────────────────────────────────────────────────────────────

async function handleExtractions(event, auth) {
  const db = getServiceDb();
  if (!db) return errorResponse(503, "service_unavailable", "Database is not configured.");
  const method = event.httpMethod;

  if (method === "GET") {
    // list with pagination
    const limit = Math.min(parseInt(event.queryStringParameters?.limit || "25", 10) || 25, 100);
    const cursor = event.queryStringParameters?.cursor;
    const q = {
      user_id: `eq.${auth.user.id}`,
      select: "*",
      order: "created_at.desc",
      limit: String(limit),
    };
    if (cursor) q.created_at = `lt.${cursor}`;
    try {
      const rows = await dbSelect(db, "extractions", q);
      const data = (rows || []).map(reshapeExtraction);
      const next = data.length === limit ? data[data.length - 1].created_at : null;
      return okResponse(200, { data, next_cursor: next }, { rateLimit: auth.rateLimit });
    } catch (err) {
      return serverError(err.message);
    }
  }

  if (method === "POST") {
    if (!planAllowsEndpoint(auth.plan, "extractions:create")) return forbidden();
    let body;
    try { body = await readJsonBody(event); }
    catch { return badRequest("Invalid JSON body."); }
    const url = body?.url;
    if (!url || typeof url !== "string") return badRequest("'url' is required and must be a string.");
    // Map public-API intent to internal options
    const intent = body.intent || "summary";
    const options = {
      renderJs: body.render_js === true,
      customPrompt: intent === "custom" ? body.prompt : undefined,
    };
    try {
      const extractRes = await callInternalExtract(url, options, auth);
      if (!extractRes.ok) return errorResponse(422, "unprocessable", extractRes.error || "Failed to extract URL.");
      const row = await dbInsert(db, "extractions", {
        user_id: auth.user.id,
        url,
        page_title: extractRes.data?.metadata?.title || null,
        ai_summary: extractRes.data?.summary || null,
        headings: extractRes.data?.headings || [],
        links: extractRes.data?.links || [],
        custom_extraction: extractRes.data?.json || null,
        intent,
      });
      // Fire-and-forget notification: Slack, Zapier, etc.
      notifyExtractionComplete({ userId: auth.user.id, extraction: row }).catch(() => {});
      return okResponse(201, reshapeExtraction(row), { rateLimit: auth.rateLimit });
    } catch (err) {
      return serverError(err.message);
    }
  }

  return errorResponse(405, "invalid_request", `Method ${method} not allowed on /extractions.`);
}

async function handleExtractionById(event, auth, id) {
  const db = getServiceDb();
  if (!db) return errorResponse(503, "service_unavailable", "Database is not configured.");
  const method = event.httpMethod;

  if (method === "GET") {
    try {
      const rows = await dbSelect(db, "extractions", {
        id: `eq.${id}`,
        user_id: `eq.${auth.user.id}`,
        select: "*",
        limit: "1",
      });
      if (!rows || rows.length === 0) return notFound();
      return okResponse(200, reshapeExtraction(rows[0]), { rateLimit: auth.rateLimit });
    } catch (err) {
      return serverError(err.message);
    }
  }

  if (method === "DELETE") {
    try {
      await dbDelete(db, "extractions", { id, user_id: auth.user.id });
      return okResponse(204, {}, { rateLimit: auth.rateLimit });
    } catch (err) {
      return serverError(err.message);
    }
  }

  return errorResponse(405, "invalid_request", `Method ${method} not allowed on /extractions/{id}.`);
}

async function handleEnrichment(event, auth, id) {
  if (event.httpMethod !== "POST") {
    return errorResponse(405, "invalid_request", "Enrichment endpoint accepts POST only.");
  }
  if (!planAllowsEndpoint(auth.plan, "enrichments:create")) return forbidden();
  let body;
  try { body = await readJsonBody(event); }
  catch { return badRequest("Invalid JSON body."); }
  const focus = body?.focus;
  const VALID_FOCUSES = ["contacts", "leadership", "social", "mission", "pricing"];
  if (!focus || !VALID_FOCUSES.includes(focus)) {
    return badRequest(`'focus' must be one of: ${VALID_FOCUSES.join(", ")}.`);
  }
  try {
    // Delegate to the internal /api/ai function which already knows how to
    // run an enrichment prompt against the AI provider.
    const aiRes = await callInternalAi({
      messages: [{ role: "user", content: buildEnrichmentPrompt(focus) }],
      max_tokens: 1200,
    }, auth);
    if (!aiRes.ok) return errorResponse(422, "unprocessable", aiRes.error || "Enrichment failed.");
    const data = safeJsonParse(aiRes.content) || { raw: aiRes.content };
    // Persist the enrichment back to the extraction row
    const db = getServiceDb();
    if (db) {
      try {
        const row = await dbSelect(db, "extractions", { id: `eq.${id}`, user_id: `eq.${auth.user.id}`, select: "enrichments", limit: "1" });
        const current = (row?.[0]?.enrichments && typeof row[0].enrichments === "object") ? row[0].enrichments : {};
        const next = { ...current, [focus]: { focus, data, created_at: new Date().toISOString() } };
        await dbUpdate(db, "extractions", { id, user_id: auth.user.id }, { enrichments: next });
      } catch { /* best-effort */ }
    }
    return okResponse(200, { focus, data }, { rateLimit: auth.rateLimit });
  } catch (err) {
    return serverError(err.message);
  }
}

async function handleContent(event, auth, id) {
  if (event.httpMethod !== "POST") {
    return errorResponse(405, "invalid_request", "Content endpoint accepts POST only.");
  }
  let body;
  try { body = await readJsonBody(event); }
  catch { return badRequest("Invalid JSON body."); }
  const format = body?.format;
  const VALID_FORMATS = ["seo_outline", "competitor_summary", "social_posts"];
  if (!format || !VALID_FORMATS.includes(format)) {
    return badRequest(`'format' must be one of: ${VALID_FORMATS.join(", ")}.`);
  }
  try {
    const aiRes = await callInternalAi({
      messages: [{ role: "user", content: buildContentPrompt(format) }],
      max_tokens: 2000,
    }, auth);
    if (!aiRes.ok) return errorResponse(422, "unprocessable", aiRes.error || "Content generation failed.");
    return okResponse(200, { format, content: aiRes.content }, { rateLimit: auth.rateLimit });
  } catch (err) {
    return serverError(err.message);
  }
}

async function handleBatches(event, auth) {
  const db = getServiceDb();
  if (!db) return errorResponse(503, "service_unavailable", "Database is not configured.");
  if (event.httpMethod !== "POST") {
    return errorResponse(405, "invalid_request", "Batches endpoint accepts POST only (v1 ships submit-only).");
  }
  if (!planAllowsEndpoint(auth.plan, "batches:create")) return forbidden();
  let body;
  try { body = await readJsonBody(event); }
  catch { return badRequest("Invalid JSON body."); }
  const urls = Array.isArray(body?.urls) ? body.urls : null;
  if (!urls || urls.length === 0) return badRequest("'urls' must be a non-empty array.");
  if (urls.length > 50) return badRequest("Batches are capped at 50 URLs per request.");
  // Insert a queued batch row; the actual scraping is handled by the existing
  // scheduled-runner / batch pipeline. We deliberately don't fan out here —
  // a synchronous fan-out would burn the API worker's 10s budget and
  // violate the API's SLA. The schedule runner will pick the row up.
  try {
    const intent = body.intent || "summary";
    const row = await dbInsert(db, "batch_runs", {
      user_id: auth.user.id,
      intent,
      urls,
      status: "queued",
      total: urls.length,
      succeeded: 0,
      failed: 0,
      source: "api",
    });
    return okResponse(202, reshapeBatch(row), { rateLimit: auth.rateLimit });
  } catch (err) {
    return serverError(err.message);
  }
}

async function handleBatchById(event, auth, id) {
  const db = getServiceDb();
  if (!db) return errorResponse(503, "service_unavailable", "Database is not configured.");
  if (event.httpMethod !== "GET") {
    return errorResponse(405, "invalid_request", "Batch-by-id accepts GET only.");
  }
  try {
    const rows = await dbSelect(db, "batch_runs", {
      id: `eq.${id}`,
      user_id: `eq.${auth.user.id}`,
      select: "*",
      limit: "1",
    });
    if (!rows || rows.length === 0) return notFound();
    return okResponse(200, reshapeBatch(rows[0]), { rateLimit: auth.rateLimit });
  } catch (err) {
    return serverError(err.message);
  }
}

async function handleSchedules(event, auth) {
  const db = getServiceDb();
  if (!db) return errorResponse(503, "service_unavailable", "Database is not configured.");
  const method = event.httpMethod;

  if (method === "GET") {
    try {
      const rows = await dbSelect(db, "schedules", {
        user_id: `eq.${auth.user.id}`,
        select: "*",
        order: "created_at.desc",
      });
      return okResponse(200, { data: (rows || []).map(reshapeSchedule) }, { rateLimit: auth.rateLimit });
    } catch (err) {
      return serverError(err.message);
    }
  }

  if (method === "POST") {
    if (!planAllowsEndpoint(auth.plan, "schedules:create")) return forbidden();
    let body;
    try { body = await readJsonBody(event); }
    catch { return badRequest("Invalid JSON body."); }
    const url = body?.url;
    const cadence = body?.cadence;
    if (!url) return badRequest("'url' is required.");
    if (!cadence) return badRequest("'cadence' is required.");
    try {
      const row = await dbInsert(db, "schedules", {
        user_id: auth.user.id,
        url,
        intent: body.intent || "summary",
        cadence,
        label: body.name || `Track · ${url}`,
        alert_email: body.alert_email || null,
        status: "active",
        expires_at: body.expires_at || null,
      });
      return okResponse(201, reshapeSchedule(row), { rateLimit: auth.rateLimit });
    } catch (err) {
      return serverError(err.message);
    }
  }

  return errorResponse(405, "invalid_request", `Method ${method} not allowed on /schedules.`);
}

async function handleScheduleById(event, auth, id, suffix) {
  const db = getServiceDb();
  if (!db) return errorResponse(503, "service_unavailable", "Database is not configured.");
  const method = event.httpMethod;

  if (method === "GET") {
    try {
      const rows = await dbSelect(db, "schedules", { id: `eq.${id}`, user_id: `eq.${auth.user.id}`, select: "*", limit: "1" });
      if (!rows || rows.length === 0) return notFound();
      return okResponse(200, reshapeSchedule(rows[0]), { rateLimit: auth.rateLimit });
    } catch (err) { return serverError(err.message); }
  }
  if (method === "PATCH") {
    let body;
    try { body = await readJsonBody(event); }
    catch { return badRequest("Invalid JSON body."); }
    const patch = {};
    for (const k of ["name", "label", "intent", "cadence", "alert_email", "status", "expires_at"]) {
      if (body[k] != null) patch[k === "name" ? "label" : k] = body[k];
    }
    if (Object.keys(patch).length === 0) return badRequest("No mutable fields in body.");
    try {
      const row = await dbUpdate(db, "schedules", { id, user_id: auth.user.id }, patch);
      if (!row) return notFound();
      return okResponse(200, reshapeSchedule(row), { rateLimit: auth.rateLimit });
    } catch (err) { return serverError(err.message); }
  }
  if (method === "DELETE") {
    try {
      await dbDelete(db, "schedules", { id, user_id: auth.user.id });
      return okResponse(204, {}, { rateLimit: auth.rateLimit });
    } catch (err) { return serverError(err.message); }
  }
  if (method === "POST" && suffix === "run") {
    // The scheduled-runner cron picks up new "queued" runs; we mark the
    // schedule as "due now" by enqueueing a row in workflow_events (if the
    // table exists) or falling back to setting next_run_at to now.
    try {
      const row = await dbUpdate(db, "schedules", { id, user_id: auth.user.id }, { next_run_at: new Date().toISOString(), last_status: null });
      if (!row) return notFound();
      return okResponse(202, { id, queued: true }, { rateLimit: auth.rateLimit });
    } catch (err) { return serverError(err.message); }
  }
  return errorResponse(405, "invalid_request", `Method ${method} not allowed on /schedules/{id}${suffix ? "/" + suffix : ""}.`);
}

async function handleShare(event, auth, id) {
  const db = getServiceDb();
  if (!db) return errorResponse(503, "service_unavailable", "Database is not configured.");
  if (event.httpMethod === "POST") {
    // Create a public report row keyed by a slug. The /p/:slug route is
    // served by the SPA (handled by the React Router fallback). We just
    // need to mint a slug and store it.
    let body = {};
    try { body = await readJsonBody(event); } catch { /* tolerate empty */ }
    const slug = createSlug(8);
    const ttlDays = parseInt(body?.ttl_days, 10) || null;
    const expiresAt = ttlDays ? new Date(Date.now() + ttlDays * 86400_000).toISOString() : null;
    try {
      await dbInsert(db, "public_reports", {
        extraction_id: id,
        user_id: auth.user.id,
        slug,
        expires_at: expiresAt,
      });
      const base = process.env.URL || process.env.SITE_URL || "https://datiq.app";
      return okResponse(201, { slug, url: `${base}/p/${slug}`, expires_at: expiresAt }, { rateLimit: auth.rateLimit });
    } catch (err) {
      return serverError(err.message);
    }
  }
  if (event.httpMethod === "DELETE") {
    try {
      await dbDelete(db, "public_reports", { extraction_id: id, user_id: auth.user.id });
      return okResponse(204, {}, { rateLimit: auth.rateLimit });
    } catch (err) { return serverError(err.message); }
  }
  return errorResponse(405, "invalid_request", "Share endpoint accepts POST or DELETE.");
}

async function handleGallery(event, auth) {
  // The gallery is public; we don't even require auth, but the auth pipeline
  // has already run by the time we get here. We just return recent public
  // reports.
  const db = getServiceDb();
  if (!db) return errorResponse(503, "service_unavailable", "Database is not configured.");
  const limit = Math.min(parseInt(event.queryStringParameters?.limit || "20", 10) || 20, 100);
  try {
    const rows = await dbSelect(db, "public_reports", {
      select: "slug,title,intent,created_at,extraction_id",
      order: "created_at.desc",
      limit: String(limit),
    });
    const base = process.env.URL || process.env.SITE_URL || "https://datiq.app";
    const data = (rows || []).map((r) => ({
      slug: r.slug,
      title: r.title || null,
      intent: r.intent || null,
      url: `${base}/p/${r.slug}`,
      created_at: r.created_at ? new Date(r.created_at).toISOString() : null,
    }));
    return okResponse(200, { data, next_cursor: null }, { rateLimit: auth.rateLimit });
  } catch (err) { return serverError(err.message); }
}

async function handleFeedback(event, auth, id) {
  if (event.httpMethod !== "POST") {
    return errorResponse(405, "invalid_request", "Feedback endpoint accepts POST only.");
  }
  let body;
  try { body = await readJsonBody(event); }
  catch { return badRequest("Invalid JSON body."); }
  const rating = body?.rating;
  if (rating !== "up" && rating !== "down") return badRequest("'rating' must be 'up' or 'down'.");
  const db = getServiceDb();
  if (!db) return errorResponse(503, "service_unavailable", "Database is not configured.");
  try {
    await dbInsert(db, "extraction_feedback", {
      extraction_id: id,
      user_id: auth.user.id,
      rating,
      comment: body?.comment || null,
    });
    return okResponse(201, { ok: true }, { rateLimit: auth.rateLimit });
  } catch (err) { return serverError(err.message); }
}

// ── Internal-call helpers (talk to the /api/* functions) ──────────────────
// Imported from ./lib/apiV1Internals.js so they can be mocked in tests.
// Self-mocking the same module doesn't work with ESM.

// ── Prompt builders (used by /enrichments and /content) ────────────────────
function buildEnrichmentPrompt(focus) {
  return `You are a research assistant. Produce a JSON object describing the "${focus}" of the page. Return ONLY valid JSON. No preamble, no markdown fences.`;
}

function buildContentPrompt(format) {
  const map = {
    seo_outline: "Write an SEO blog outline based on the page's main topics. Use H2/H3 headings and brief notes under each.",
    competitor_summary: "Write a 1-paragraph competitor summary: who the company is, what they sell, who they sell to, and how they differentiate.",
    social_posts: "Write 5 social media posts (Twitter/X, LinkedIn, Instagram caption) summarising the page.",
  };
  return map[format] || "Summarise the page.";
}

function safeJsonParse(s) {
  if (typeof s !== "string") return null;
  try { return JSON.parse(s); } catch { return null; }
}

function createSlug(len = 8) {
  // 8 url-safe base64 chars ≈ 48 bits of entropy, plenty for a slug.
  return createHash("sha256")
    .update(`${Date.now()}-${Math.random()}-${process.pid}`)
    .digest("base64url")
    .slice(0, len);
}

// ── Discoverability delegation ─────────────────────────────────────────────

/**
 * Serve /v1/audits/* by calling the SPA's own Discoverability handler.
 *
 * The two callers are authenticated differently — an API key here, a Supabase
 * JWT there — so the event is re-shaped to carry the resolved user as a bearer
 * token the inner handler already understands. Everything after that point is
 * literally the same code path, which is the point: the gate order, the quota
 * accounting and the compliance behaviour cannot drift between the public API
 * and the app, because there is only one of each.
 */
async function handleDiscoverability(event, auth, path) {
  const { handler: discoverabilityHandler } = await import("./discoverability.js");

  // The inner handler resolves identity from a Supabase JWT. An API key is not
  // one, so the resolved user id is passed through a header the inner handler's
  // authenticateBearer step is configured to accept. `_apiKeyUserId` is read
  // ONLY from this in-process delegation — it never crosses the network,
  // because Netlify strips unknown underscore-prefixed keys from the event and
  // the redirect for /api/v1/* never reaches the discoverability function.
  const inner = {
    ...event,
    queryStringParameters: {
      ...(event.queryStringParameters || {}),
      splat: path.join("/"),
    },
    _apiKeyUserId: auth.user?.id || null,
  };

  const res = await discoverabilityHandler(inner);
  // Normalise onto the public API's envelope so a client sees one error shape
  // across every /v1 endpoint.
  if (res.statusCode >= 400) {
    let body = {};
    try { body = JSON.parse(res.body); } catch { /* non-JSON body */ }
    const code = body.code || (res.statusCode === 404 ? "not_found"
      : res.statusCode === 402 ? "quota_exceeded"
      : res.statusCode === 403 ? "forbidden" : "invalid_request");
    return errorResponse(res.statusCode, code, body.error || "Request failed", {
      ...(body.host ? { host: body.host } : {}),
      ...(body.upgradeTo ? { upgrade_to: body.upgradeTo } : {}),
    });
  }
  return res;
}

// ── Router ─────────────────────────────────────────────────────────────────

export async function routeApiV1(event, auth) {
  const path = parsePath(resolveSplat(event));
  const method = event.httpMethod;

  // /v1/extractions
  if (path.length === 1 && path[0] === "extractions") {
    if (method === "GET") return handleExtractions({ ...event, httpMethod: "GET" }, auth);
    if (method === "POST") return handleExtractions({ ...event, httpMethod: "POST" }, auth);
    return errorResponse(405, "invalid_request", `Method ${method} not allowed on /extractions.`);
  }
  // /v1/extractions/{id}
  if (path.length === 2 && path[0] === "extractions") {
    if (method === "GET" || method === "DELETE") return handleExtractionById(event, auth, path[1]);
    return errorResponse(405, "invalid_request", `Method ${method} not allowed on /extractions/{id}.`);
  }
  // /v1/extractions/{id}/enrichments
  if (path.length === 3 && path[0] === "extractions" && path[2] === "enrichments") {
    return handleEnrichment(event, auth, path[1]);
  }
  // /v1/extractions/{id}/content
  if (path.length === 3 && path[0] === "extractions" && path[2] === "content") {
    return handleContent(event, auth, path[1]);
  }
  // /v1/extractions/{id}/share
  if (path.length === 3 && path[0] === "extractions" && path[2] === "share") {
    return handleShare(event, auth, path[1]);
  }
  // /v1/extractions/{id}/feedback
  if (path.length === 3 && path[0] === "extractions" && path[2] === "feedback") {
    return handleFeedback(event, auth, path[1]);
  }
  // /v1/batches
  if (path.length === 1 && path[0] === "batches") {
    if (method === "POST") return handleBatches(event, auth);
    return errorResponse(405, "invalid_request", `Method ${method} not allowed on /batches.`);
  }
  // /v1/batches/{id}
  if (path.length === 2 && path[0] === "batches") {
    return handleBatchById(event, auth, path[1]);
  }
  // /v1/schedules
  if (path.length === 1 && path[0] === "schedules") {
    return handleSchedules(event, auth);
  }
  // /v1/schedules/{id} and /v1/schedules/{id}/run
  if (path.length === 2 && path[0] === "schedules") {
    return handleScheduleById(event, auth, path[1], null);
  }
  if (path.length === 3 && path[0] === "schedules" && path[2] === "run") {
    return handleScheduleById(event, auth, path[1], "run");
  }
  // ── /v1/audits — the Discoverability module ─────────────────────────────
  // Thin delegation to the same handler the SPA uses, rather than a second
  // implementation. The audit engine already applies every gate (SSRF,
  // compliance, quota, rate limit) and a parallel copy here would be one
  // refactor away from applying a different set — which is how the guest-credit
  // leak documented in CLAUDE.md happened.
  //
  // ── D2: /v1/discoverability/* IS CANONICAL, THE BARE PREFIXES ARE ALIASES ──
  // The PRD namespaces every one of these under `discoverability`. The bare
  // forms shipped first and are in use, so they stay — PERMANENTLY, not
  // deprecated. An alias that is quietly removed a year later is worse than one
  // that was never offered, because by then somebody has built on it.
  //
  // The segment is stripped rather than routed separately, so both forms reach
  // exactly the same handler and cannot drift into applying different gates —
  // which is how the guest-credit leak documented in CLAUDE.md happened.
  if (path[0] === "discoverability" && path.length > 1) {
    return handleDiscoverability(event, auth, path.slice(1));
  }
  if (path[0] === "audits" || path[0] === "recommendations" || path[0] === "targets"
      || path[0] === "benchmarks" || path[0] === "monitors" || path[0] === "prompts"
      || path[0] === "sxo") {
    return handleDiscoverability(event, auth, path);
  }

  // /v1/gallery
  if (path.length === 1 && path[0] === "gallery") {
    return handleGallery(event, auth);
  }

  // Diagnostic only — never triggered on a successful route match. See
  // discoverability.js's matching log for why: resolveSplat's marker search
  // already had to learn a second event.path shape once; this is what tells
  // us directly if a third one is ever needed.
  console.error("[api-v1] No such endpoint — routing could not resolve a sub-path", {
    method, rawPath: event.path, rawQuerySplat: event.queryStringParameters?.splat,
    resolvedSplat: resolveSplat(event), parsedPath: path,
  });
  return errorResponse(404, "not_found", `No such endpoint: /${path.join("/")} (${method})`);
}

// ── Netlify handler ─────────────────────────────────────────────────────────

export const handler = async (event) => {
  // 1. CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, Idempotency-Key",
        "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      },
      body: "",
    };
  }

  // 2. Health check (unauthenticated)
  const path = parsePath(resolveSplat(event));
  if (path.length === 1 && path[0] === "_health") {
    return okResponse(200, { ok: true, version: "v1", ts: new Date().toISOString() });
  }

  // 3. Authenticate
  const auth = await authenticateApiRequest(event);
  if (!auth.ok) return auth.response;

  // 4. Route
  return routeApiV1(event, auth.auth);
};

export const _internal = {
  parsePath,
  reshapeExtraction,
  reshapeBatch,
  reshapeSchedule,
  buildEnrichmentPrompt,
  buildContentPrompt,
  routeApiV1,
};
