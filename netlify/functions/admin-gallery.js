// admin-gallery.js — the human-verification gate for the public gallery.
//
//   GET  /api/admin-gallery                  → { ok, reports }  (token-gated)
//   POST /api/admin-gallery  { action: "curate", id, persona }  (token-gated)
//                                             → sets curated=true, persona,
//                                               reviewed_at, reviewed_by
//   POST /api/admin-gallery  { action: "uncurate", id }         → reverses it
//   POST /api/admin-gallery  { action: "takedown", id, reason } → revoke a published page
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
        "/rest/v1/public_reports?select=id,slug,title,url,intent,data,persona,curated,reviewed_at,reviewed_by,created_at&is_public=eq.true&order=created_at.desc&limit=200"
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
    } else if (action === "takedown") {
      // ── ADMIN TAKEDOWN of a published page ────────────────────────────────
      // Takedown revokes the public share link so nobody holding the link can
      // reach it anymore, and removes it from /gallery and /admin/gallery.
      //
      // 1. Updates public_reports (sets is_public=false, curated=false)
      // 2. Also revokes in public.reports (via revoke_report / visibility='revoked')
      //    if a corresponding row exists.
      // A reason is MANDATORY, matching ops_audit_log conventions.
      const reason = String(body.reason || "").trim();
      if (!reason) {
        return respond(400, { ok: false, error: "A written reason is required to take down a published page." });
      }
      const db0 = getDb();
      if (!db0) return respond(502, { ok: false, error: "Supabase not configured — nothing to take down." });
      try {
        let slug = null;
        let foundInPublic = false;
        try {
          const rows = await sbFetch(db0, `/rest/v1/public_reports?id=eq.${encodeURIComponent(id)}&select=id,slug,is_public`);
          const rep = Array.isArray(rows) ? rows[0] : rows;
          if (rep) {
            foundInPublic = true;
            slug = rep.slug;
          }
        } catch { /* proceed */ }

        // Update public_reports (the primary source for /gallery and /p/:slug)
        await sbFetch(db0, `/rest/v1/public_reports?id=eq.${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ is_public: false, curated: false }),
        }).catch((err) => {
          if (!foundInPublic) throw err;
        });

        // Also revoke in public.reports if present
        try {
          await sbFetch(db0, `/rest/v1/rpc/revoke_report`, {
            method: "POST",
            body: JSON.stringify({ p_report_id: id, p_actor: null, p_reason: reason }),
          }).catch(() => null);

          if (slug) {
            await sbFetch(db0, `/rest/v1/reports?slug=eq.${encodeURIComponent(slug)}`, {
              method: "PATCH",
              headers: { Prefer: "return=minimal" },
              body: JSON.stringify({ visibility: "revoked", revoked_at: new Date().toISOString() }),
            }).catch(() => null);
          }
        } catch { /* non-blocking */ }

        return respond(200, { ok: true, action: "takedown", id, visibility: "revoked" });
      } catch (err) {
        return respond(502, { ok: false, error: `Takedown failed: ${err.message}` });
      }
    } else if (action === "delete") {
      // ── ADMIN HARD DELETE: Remove completely ──────────────────────────────
      // Permanently purges the report from public_reports (and reports).
      const db0 = getDb();
      if (!db0) return respond(502, { ok: false, error: "Supabase not configured — nothing to delete." });
      try {
        let slug = null;
        try {
          const rows = await sbFetch(db0, `/rest/v1/public_reports?id=eq.${encodeURIComponent(id)}&select=id,slug`);
          const rep = Array.isArray(rows) ? rows[0] : rows;
          if (rep?.slug) slug = rep.slug;
        } catch { /* ignore */ }

        // Hard delete from public_reports
        await sbFetch(db0, `/rest/v1/public_reports?id=eq.${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: { Prefer: "return=minimal" },
        });

        // Also clean up from reports if matching slug or id exists
        if (slug) {
          await sbFetch(db0, `/rest/v1/reports?slug=eq.${encodeURIComponent(slug)}`, {
            method: "DELETE",
            headers: { Prefer: "return=minimal" },
          }).catch(() => null);
        }
        await sbFetch(db0, `/rest/v1/reports?id=eq.${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: { Prefer: "return=minimal" },
        }).catch(() => null);

        return respond(200, { ok: true, action: "delete", id });
      } catch (err) {
        return respond(502, { ok: false, error: `Delete failed: ${err.message}` });
      }
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
