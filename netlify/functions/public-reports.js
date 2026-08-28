// public-reports.js — the write side of a shareable report link.
//
// ── THE BUG THIS CLOSES ─────────────────────────────────────────────────────
// "Sync public link" reported a LIVE link as a failed publish. The client
// used to upsert `public_reports` directly with the anon key; on an EXISTING
// slug that upsert becomes an UPDATE, and 0007_public_reports.sql's
// "owner update" policy has two branches:
//
//   user_id::text = auth.uid()::text   — null for an anonymous share
//   session_id = …->>'x-session-id'    — a header this codebase never sent
//
// Neither branch is satisfiable for an anonymous sharer, so re-publishing an
// existing link was denied by RLS even though the link stayed live the whole
// time — only the OVERWRITE was refused. shareService.js's client-side probe
// (read the row back, report refreshed:false rather than a hard failure) is
// what makes that survivable today; this function is the actual fix.
//
// ⚠️ Do NOT "fix" this by sending an x-session-id header instead. The
// "public read" policy exposes every column — session_id included — to
// anyone holding the slug, so header-based ownership would let any READER of
// a public report take over and rewrite or delete it. That turns a
// fail-closed bug into a real vulnerability.
//
// ── THE FIX ──────────────────────────────────────────────────────────────
// The write moves behind this service-key function instead. The client sends
// its own session_id in the POST BODY (never a header, never something a
// reader of the published row could obtain — it is never returned by any
// SELECT the client runs, see shareService.js's own select() calls). This
// function fetches the target row itself with the service key (which
// bypasses RLS entirely, so the anon-exposed "public read" policy is
// irrelevant to this check) and compares ownership server-side: a signed-in
// caller's JWT user id, or the anonymous sharer's own session_id — exactly
// the same two branches the RLS policy already expressed, just evaluated in
// application code where the caller's session_id can be validated without
// ever being exposed to a third party.

import { authenticateBearer } from "./lib/supabaseServerClient.js";

const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};

const respond = (status, body) => ({ statusCode: status, headers: HEADERS, body: JSON.stringify(body) });

function sb() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_KEY || "";
  if (!url || !key) return null;
  return {
    base: `${url}/rest/v1`,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: HEADERS, body: "" };
  if (event.httpMethod !== "POST") return respond(405, { ok: false, error: "Method not allowed" });

  const db = sb();
  if (!db) return respond(200, { ok: false, reason: "supabase_not_configured" });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return respond(400, { ok: false, error: "Invalid JSON" }); }

  const slug = String(body.slug || "").trim();
  const sessionId = body.sessionId ? String(body.sessionId).trim().slice(0, 100) : null;
  if (!slug || !body.title || !body.data) {
    return respond(400, { ok: false, error: "slug, title and data are required" });
  }

  // Optional — a signed-in sharer's own JWT. Never trust a client-supplied
  // user id for ownership; this is the only source of truth for "who is
  // making this request", same reasoning as account-state.js.
  let callerUserId = null;
  const authHeader = event.headers?.authorization || event.headers?.Authorization;
  if (authHeader) {
    const auth = await authenticateBearer(event, { label: "public-reports" });
    if (auth.ok) callerUserId = auth.user.id;
  }

  const row = {
    slug,
    title: String(body.title).slice(0, 300),
    url: body.url ? String(body.url).slice(0, 2000) : null,
    intent: body.intent ? String(body.intent).slice(0, 60) : null,
    data: body.data,
    user_id: callerUserId,
    session_id: sessionId,
    is_public: true,
  };

  const existingRes = await fetch(
    `${db.base}/public_reports?slug=eq.${encodeURIComponent(slug)}&select=user_id,session_id`,
    { headers: db.headers },
  );
  if (!existingRes.ok) return respond(502, { ok: false, error: "Could not read the current state of this link." });
  const existing = (await existingRes.json().catch(() => []))?.[0] || null;

  if (!existing) {
    // New slug — anyone may create a share, signed in or not, matching the
    // "we never reject a share because the user isn't signed in" INSERT
    // policy this replaces.
    const res = await fetch(`${db.base}/public_reports`, {
      method: "POST",
      headers: { ...db.headers, Prefer: "return=minimal" },
      body: JSON.stringify(row),
    });
    if (!res.ok) return respond(502, { ok: false, error: "Couldn't publish the public link." });
    return respond(200, { ok: true, slug, refreshed: true });
  }

  // Same OR the RLS policy it replaces expressed: a signed-in owner match,
  // or a session_id match. Unconditional on existing.user_id, matching that
  // policy exactly — a signed-in re-sharer's session_id from before they
  // signed in should still work, the same way the RLS policy allowed it.
  const owns = (callerUserId && existing.user_id === callerUserId)
    || (sessionId && existing.session_id === sessionId);

  if (!owns) {
    // The link is live and readable — that IS what a public link is, so
    // reporting a failure here would be false. The content just cannot be
    // refreshed by someone who isn't the original sharer. Mirrors the exact
    // graceful-degradation shape shareService.js already expects.
    return respond(200, { ok: true, slug, refreshed: false });
  }

  const res = await fetch(`${db.base}/public_reports?slug=eq.${encodeURIComponent(slug)}`, {
    method: "PATCH",
    headers: { ...db.headers, Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
  if (!res.ok) return respond(502, { ok: false, error: "Couldn't publish the public link." });
  return respond(200, { ok: true, slug, refreshed: true });
};
