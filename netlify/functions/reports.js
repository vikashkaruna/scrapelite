// netlify/functions/reports.js — PRD 2's shareable intelligence reports.
//
//   GET  /api/reports?slug=<s>   → resolve + read (THE only public read path)
//   GET  /api/reports            → my reports (signed in)
//   POST /api/reports {action:"create"}     → from a template run; PRIVATE
//   POST /api/reports {action:"publish"}    → private → link|org|named|public
//   POST /api/reports {action:"unpublish"}  → back to private, slug KEPT
//   POST /api/reports {action:"revoke"}     → terminal; slug burned
//   POST /api/reports {action:"grant"}      → add/remove a named collaborator
//
// ── EVERY READ GOES THROUGH resolve_report_access() ─────────────────────────
// 0007_public_reports.sql resolved visibility in RLS with
// `USING (is_public = true)`, which exposes EVERY COLUMN — session_id included
// — to anyone holding a slug. 0039 replaces that with a service-key function
// that returns a VERDICT plus only the fields a viewer may see. This handler
// is its only caller, so there is no second path that could skip the check.
//
// ── NOTHING HERE MAY BE CACHED ──────────────────────────────────────────────
// PRD 2 requires that revoking a link blocks access IMMEDIATELY. A cached body
// makes that impossible no matter how correct the check is, so every report
// response carries no-store. This is the one endpoint where a CDN hit would be
// a security bug rather than a performance win.

import { authenticateBearer } from "./lib/supabaseServerClient.js";
import { resolveRequestEntitlement, checkCapability, denyResponse } from "./lib/requireEntitlement.js";
import { createClient } from "@supabase/supabase-js";
import { VISIBILITY, SHAREABLE, isIndexable } from "../../src/lib/reports/visibilityModel.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

// A revoked link that is still served from an edge cache is a revoked link
// that does not work. See the header.
const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate, private" };

const json = (statusCode, body, extra = {}) => ({
  statusCode,
  headers: { "Content-Type": "application/json", ...CORS, ...extra },
  body: JSON.stringify(body),
});

function serviceDb(env = process.env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  try {
    if (event.httpMethod === "GET") return await handleGet(event);
    if (event.httpMethod === "POST") return await handlePost(event);
    return json(405, { error: "Method not allowed" });
  } catch (e) {
    console.error("[reports] unhandled", e);
    return json(500, { error: "Something went wrong handling that report." });
  }
};

async function handleGet(event) {
  const qs = event.queryStringParameters || {};
  const db = serviceDb();
  if (!db) return json(503, { error: "Reports are not configured in this environment." });

  // ── public read ──────────────────────────────────────────────────────────
  if (qs.slug) {
    // A viewer may be anonymous. If a bearer token IS present we resolve the
    // identity, because org and named visibility depend on it — but a failed
    // auth must not turn a readable `link` report into a 401.
    let viewerId = null;
    let viewerEmail = null;
    if (event.headers?.authorization) {
      const auth = await authenticateBearer(event, { label: "reports" });
      if (auth.ok) { viewerId = auth.user.id; viewerEmail = auth.user.email || null; }
    }

    const { data, error } = await db.rpc("resolve_report_access", {
      p_slug: qs.slug, p_viewer_id: viewerId, p_viewer_email: viewerEmail, p_log: true,
    });
    if (error) {
      console.error("[reports] resolve failed:", error.message);
      return json(500, { error: "Could not open that report." }, NO_STORE);
    }
    if (!data?.ok) {
      // 404 for everything, deliberately: distinguishing "private" from
      // "does not exist" tells an enumerator which slugs are real.
      return json(404, { error: "Report not available", reason: data?.reason || "not_found" }, NO_STORE);
    }
    return json(200, { report: data.report, indexable: !!data.report.indexable }, NO_STORE);
  }

  // ── my reports ───────────────────────────────────────────────────────────
  const auth = await authenticateBearer(event, { label: "reports" });
  if (!auth.ok) return json(auth.status, auth.body);
  const { data, error } = await db
    .from("reports")
    .select("id, slug, title, source_url, template_key, visibility, expires_at, revoked_at, published_at, view_count, created_at")
    .eq("owner_id", auth.user.id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return json(500, { error: error.message });
  return json(200, { reports: data || [] }, NO_STORE);
}

async function handlePost(event) {
  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Invalid JSON body" }); }

  const action = String(body.action || "");
  const auth = await authenticateBearer(event, { label: "reports" });
  if (!auth.ok) return json(auth.status, auth.body);

  const db = serviceDb();
  if (!db) return json(503, { error: "Reports are not configured in this environment." });

  switch (action) {
    case "create":    return await createReport(db, body, auth.user, event);
    case "publish":   return await publish(db, body, auth.user, event);
    case "unpublish": return await setVisibility(db, body.reportId, VISIBILITY.PRIVATE, auth.user);
    case "revoke":    return await revoke(db, body, auth.user);
    case "grant":     return await grant(db, body, auth.user);
    default:          return json(400, { error: `Unknown action '${action}'` });
  }
}

async function createReport(db, body, user, event) {
  if (!body.title) return json(400, { error: "A report needs a title." });

  // Branding is re-validated server-side. The Brand Kit lives in the browser's
  // localStorage, so the client has to send it — which means a hand-built
  // request could otherwise brand a report on a plan that never paid for it.
  // Same pattern report-email.js already uses.
  let branding = {};
  if (body.branding && Object.keys(body.branding).length) {
    const resolved = await resolveRequestEntitlement(event);
    const check = checkCapability(resolved, "report.branding", {});
    // A disallowed brand kit is silently DROPPED, never an error: failing the
    // whole publish over branding would block a legitimate share.
    if (check.allowed) branding = body.branding;
  }

  const { data, error } = await db.from("reports").insert({
    owner_id: user.id,
    workspace_id: body.workspaceId || null,
    run_id: body.runId || null,
    title: String(body.title).slice(0, 300),
    source_url: body.sourceUrl || null,
    template_key: body.templateKey || null,
    data: body.data || {},
    branding,
    visibility: VISIBILITY.PRIVATE, // private by default — decision D3
  }).select().limit(1);

  if (error) return json(500, { error: error.message });
  return json(200, { report: data?.[0] || null }, NO_STORE);
}

async function publish(db, body, user, event) {
  const to = String(body.visibility || VISIBILITY.LINK);
  if (!SHAREABLE.includes(to)) return json(400, { error: `Cannot publish to '${to}'.` });

  const resolved = await resolveRequestEntitlement(event);
  const check = checkCapability(resolved, "report.share", {});
  if (!check.allowed) return denyResponse(check, CORS);

  return await setVisibility(db, body.reportId, to, user, body.expiresAt);
}

async function setVisibility(db, reportId, visibility, user, expiresAt = null) {
  if (!reportId) return json(400, { error: "reportId is required." });
  const { data, error } = await db.rpc("set_report_visibility", {
    p_report_id: reportId, p_visibility: visibility,
    p_actor: user.id, p_expires_at: expiresAt || null,
  });
  if (error) return json(500, { error: error.message });
  if (!data?.ok) {
    const copy = {
      not_found: "That report no longer exists.",
      not_owner: "Only the report's owner can change how it's shared.",
      revoked: "This link was revoked and cannot be restored. Create a new report to share again.",
      invalid_visibility: "That sharing option isn't valid.",
    };
    return json(400, { error: copy[data?.reason] || "Could not update sharing.", reason: data?.reason });
  }
  return json(200, {
    ok: true, visibility: data.visibility, slug: data.slug,
    indexable: isIndexable(data.visibility),
  }, NO_STORE);
}

async function revoke(db, body, user) {
  if (!body.reportId) return json(400, { error: "reportId is required." });
  const { data, error } = await db.rpc("revoke_report", {
    p_report_id: body.reportId, p_actor: user.id, p_reason: body.reason || null,
  });
  if (error) return json(500, { error: error.message });
  if (!data?.ok) return json(400, { error: "Could not revoke that link.", reason: data?.reason });
  return json(200, { ok: true, visibility: "revoked" }, NO_STORE);
}

async function grant(db, body, user) {
  const { reportId, email, remove } = body;
  if (!reportId || !email) return json(400, { error: "reportId and email are required." });

  const owned = await db.from("reports").select("id").eq("id", reportId).eq("owner_id", user.id).limit(1);
  if (owned.error || !owned.data?.length) return json(404, { error: "Report not found" });

  if (remove) {
    await db.from("report_grants").update({ revoked_at: new Date().toISOString() })
      .eq("report_id", reportId).eq("email", email);
    return json(200, { ok: true, removed: email }, NO_STORE);
  }

  const { error } = await db.from("report_grants")
    .upsert({ report_id: reportId, email: String(email).toLowerCase(), granted_by: user.id, revoked_at: null },
            { onConflict: "report_id,email" });
  if (error) return json(500, { error: error.message });
  return json(200, { ok: true, granted: email }, NO_STORE);
}
