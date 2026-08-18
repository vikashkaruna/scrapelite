// admin-gallery.js — the human-verification gate for the public gallery.
//
//   GET  /api/admin-gallery                  → { ok, reports }  (token-gated)
//   POST /api/admin-gallery  { action: "curate", id, persona }  (token-gated)
//                                             → sets curated=true, persona,
//                                               reviewed_at, reviewed_by
//   POST /api/admin-gallery  { action: "uncurate", id }         → reverses it
//
// public_reports (0007_public_reports.sql) already lets anyone share and
// anyone read is_public rows — that makes /gallery a feed, not a showcase.
// "curated" (0025_gallery_curation.sql) is metadata layered on top: it never
// changes is_public and never publishes anything that wasn't already public.
// What it records is that an admin actually opened this specific report and
// looked at it before tagging it with a persona — the whole point of this
// endpoint existing rather than letting the client set `curated` directly.
//
// GET is token-gated (unlike admin-general-config.js's public GET) because it
// returns every report's full `data` projection, including ones nobody chose
// to curate — the same sensitivity level as admin-revenue.js, not a settings
// screen.

import { bearerFromEvent, verifyAdminToken } from "./lib/adminToken.js";

const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Cache-Control": "no-store",
};

const respond = (status, body) => ({ statusCode: status, headers: HEADERS, body: JSON.stringify(body) });

// Mirrors src/lib/personaConfig.js PERSONAS ids and the CHECK constraint in
// 0025_gallery_curation.sql — update all three together if a persona is added.
const VALID_PERSONAS = new Set([
  "sales", "competitive-intel", "seo", "market-research",
  "recruiter", "founder-vc", "agency",
]);

function getDb() {
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_KEY || "";
  if (!url || !key) return null;
  return { url, key };
}

async function sbFetch(db, path, opts = {}) {
  const res = await fetch(`${db.url}${path}`, {
    ...opts,
    headers: {
      apikey: db.key,
      Authorization: `Bearer ${db.key}`,
      "Content-Type": "application/json",
      ...opts.headers,
    },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Supabase ${path} → ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.status === 204 ? null : res.json();
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: HEADERS, body: "" };

  const auth = verifyAdminToken(bearerFromEvent(event));
  if (!auth.ok) return respond(401, { ok: false, error: auth.reason || "Unauthorized" });

  if (event.httpMethod === "GET") {
    const db = getDb();
    if (!db) return respond(200, { ok: true, reports: [], warning: "Supabase not configured." });
    try {
      const reports = await sbFetch(
        db,
        "/rest/v1/public_reports?select=id,slug,title,url,intent,data,persona,curated,reviewed_at,reviewed_by,created_at&order=created_at.desc&limit=200"
      );
      return respond(200, { ok: true, reports });
    } catch (e) {
      return respond(502, { ok: false, error: String(e.message || e) });
    }
  }

  if (event.httpMethod === "POST") {
    // Validate the request itself before ever checking whether Supabase is
    // reachable — a malformed request is a 400 regardless of backend state.
    let body;
    try { body = JSON.parse(event.body || "{}"); } catch {
      return respond(400, { ok: false, error: "Invalid JSON" });
    }

    const { action, id } = body;
    if (!id) return respond(400, { ok: false, error: "id is required" });

    let patch;
    if (action === "curate") {
      const persona = body.persona;
      if (!VALID_PERSONAS.has(persona)) {
        return respond(400, { ok: false, error: `persona must be one of: ${[...VALID_PERSONAS].join(", ")}` });
      }
      patch = {
        persona,
        curated: true,
        reviewed_at: new Date().toISOString(),
        // Demo-mode admin sessions have no real identity to attribute this
        // to — record that plainly rather than fabricating a name.
        reviewed_by: auth.demo ? "demo-admin" : "admin",
      };
    } else if (action === "uncurate") {
      patch = { curated: false };
    } else {
      return respond(400, { ok: false, error: `Unknown action: ${action}` });
    }

    const db = getDb();
    if (!db) return respond(502, { ok: false, error: "Supabase not configured — nothing to curate against." });
    try {
      await sbFetch(db, `/rest/v1/public_reports?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(patch),
      });
      return respond(200, { ok: true });
    } catch (e) {
      return respond(502, { ok: false, error: String(e.message || e) });
    }
  }

  return respond(405, { ok: false, error: "Method not allowed" });
};
