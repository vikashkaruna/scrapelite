// admin-coupons-config.js — sync percent-off coupons to the checkout-facing store.
//
//   GET  /api/admin-coupons-config  (Authorization: Bearer <admin token>)
//                                   → { ok, coupons, persisted, demo }
//   POST /api/admin-coupons-config  (Authorization: Bearer <admin token>)
//                                   body: { coupons: { CODE: {value,planId,expiresAt,active,maxUses}, ... } }
//                                   → upserts Supabase pricing_config row key='coupons'
//
// ── THE BUG THIS CLOSES ─────────────────────────────────────────────────────
// A coupon created in /admin/coupons was written ONLY to the admin's own
// browser (localStorage "datiq.coupons" via adminService.js's saveCoupon) —
// there was no server write path at all. Checkout (create-checkout.js) has
// always resolved real, charge-reducing coupons from lib/pricingSource.js,
// which reads a STATIC table merged with Supabase pricing_config's 'coupons'
// row — never localStorage. So an admin-created coupon looked saved (it round-
// tripped inside their own tab) but could never actually be redeemed at
// checkout by anyone, including the admin who made it.
//
// This function is the missing write side. It stores coupons in EXACTLY the
// shape pricingSource.js's resolveCouponInfo() already reads: an object keyed
// by uppercase code, each holding {value, planId, expiresAt, active, maxUses}.
// That is a different, smaller shape than the admin's own localStorage array
// (which also carries id/type/uses/createdAt for admin bookkeeping) — the
// client is responsible for building this reduced view and always sends the
// COMPLETE map, matching the whole-value-replace convention every other
// admin-*-config function here uses (admin-ai-config.js, admin-general-
// config.js): a partial POST would silently drop whatever code wasn't
// included, since Supabase's on_conflict upsert replaces the jsonb value, it
// does not deep-merge it.
//
// ── WHY ONLY PERCENT-TYPE COUPONS SYNC HERE ─────────────────────────────────
// "extractions" (bonus-extraction) coupons are applied entirely client-side —
// BillingProvider.applyCoupon() adds straight to subscription.bonusExtractions
// and never touches a checkout amount — so they were never part of this gap
// and have nothing to sync here. Only "percent" coupons change what a
// customer is actually charged, and only those are meaningful to
// pricingSource.js's resolveCouponInfo(). Also excludes planId:"manual"
// coupons (admin-assign-to-user only, never self-serve at checkout) as a
// defensive filter even though the current /admin/coupons UI can no longer
// create them.

// ── SECOND ROW: THE ADMIN CATALOG (migrated off localStorage) ─────────────────
// `datiq.coupons` in a browser used to be the ONLY home of the admin's coupon
// list, so a coupon created in one browser was invisible in another, and the
// bonus (credit) and manual-assign coupons — which the checkout map above
// cannot express — lived nowhere durable at all. Two stores now, one purpose each:
//   pricing_config 'coupons'        → what REDEEMS: percent coupons AND credit
//                                     coupons ({credits}), read by checkout and
//                                     by POST /api/credits.
//   pricing_config 'coupon_catalog' → what the ADMIN sees: the full list (every
//                                     type, manual-assign included), whole-value
//                                     replace like every other admin-*-config row.
// A manual coupon is catalog-only on purpose: it must never be self-redeemable
// at checkout, and its per-user assignment lives with the user (auth metadata +
// coupon_redemptions, written by admin-users.js).

import { verifyAdminToken, bearerFromEvent } from "./lib/adminToken.js";
import { loadPricing } from "./lib/pricingSource.js";

const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Cache-Control": "no-store",
};

const respond = (status, body) => ({ statusCode: status, headers: HEADERS, body: JSON.stringify(body) });

function SUPABASE_CONFIGURED() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
}

// Keep only well-formed entries before persisting. Mirrors resolveCouponInfo's
// own reads in pricingSource.js — value/planId/expiresAt/active/maxUses.
function sanitizeCoupons(input) {
  if (!input || typeof input !== "object") return {};
  const out = {};
  for (const [rawCode, c] of Object.entries(input)) {
    const code = String(rawCode).trim().toUpperCase().slice(0, 24);
    if (!code || !c || typeof c !== "object") continue;
    if (c.planId === "manual") continue; // admin-assign-only, never checkout-redeemable
    // Credit (bonus) coupon: redeemed server-side by POST /api/credits, which
    // reads `credits` off this same map. `value` stays 0 so checkout's percent
    // resolver can never mistake it for a discount.
    const credits = Math.floor(Number(c.credits));
    if (credits > 0) {
      out[code] = {
        value: 0,
        credits: Math.min(credits, 1_000_000),
        planId: c.planId ? String(c.planId).trim().toLowerCase().slice(0, 40) : null,
        expiresAt: c.expiresAt ? String(c.expiresAt).slice(0, 10) : null,
        active: c.active !== false,
        maxUses: Math.max(0, parseInt(c.maxUses, 10) || 0),
      };
      continue;
    }
    const value = Number(c.value);
    if (!(value > 0 && value <= 100)) continue; // percent coupons: 1-100
    out[code] = {
      value,
      planId: c.planId ? String(c.planId).trim().toLowerCase().slice(0, 40) : null,
      expiresAt: c.expiresAt ? String(c.expiresAt).slice(0, 10) : null,
      active: c.active !== false,
      maxUses: Math.max(0, parseInt(c.maxUses, 10) || 0),
    };
  }
  return out;
}

// The admin's full coupon list (every type, manual-assign included). Same
// bounded, well-formed-only discipline as sanitizeCoupons.
const CATALOG_MAX = 500;
export function sanitizeCatalog(input) {
  if (!Array.isArray(input)) return null;
  const seen = new Set();
  const out = [];
  for (const c of input) {
    if (!c || typeof c !== "object") continue;
    const code = String(c.code || "").trim().toUpperCase().replace(/\s+/g, "").slice(0, 24);
    if (!code || seen.has(code)) continue;
    const type = c.type === "extractions" ? "extractions" : "percent";
    const value = Number(c.value);
    if (!(value > 0)) continue;
    if (type === "percent" && value > 100) continue;
    seen.add(code);
    out.push({
      id: String(c.id || `c${code}`).slice(0, 40),
      code, type,
      value: type === "extractions" ? Math.min(Math.floor(value), 1_000_000) : value,
      maxUses: Math.max(0, parseInt(c.maxUses, 10) || 0),
      planId: c.planId ? String(c.planId).trim().toLowerCase().slice(0, 40) : null,
      expiresAt: c.expiresAt ? String(c.expiresAt).slice(0, 10) : null,
      active: c.active !== false,
      createdAt: c.createdAt ? String(c.createdAt).slice(0, 10) : null,
    });
    if (out.length >= CATALOG_MAX) break;
  }
  return out;
}

async function readRow(key) {
  const url = process.env.SUPABASE_URL;
  const sk = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !sk) return null;
  try {
    const res = await fetch(`${url}/rest/v1/pricing_config?key=eq.${encodeURIComponent(key)}&select=value`, {
      headers: { apikey: sk, Authorization: `Bearer ${sk}` },
    });
    if (!res.ok) return null;
    const rows = await res.json().catch(() => null);
    return Array.isArray(rows) && rows.length ? rows[0].value : null;
  } catch { return null; }
}

// Real redemption counts, keyed by code — the admin list's `uses` column must
// show what checkout/credits actually recorded, not a per-browser tally.
async function readUses() {
  const url = process.env.SUPABASE_URL;
  const sk = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !sk) return {};
  try {
    const res = await fetch(`${url}/rest/v1/coupon_counters?select=coupon_code,uses`, {
      headers: { apikey: sk, Authorization: `Bearer ${sk}` },
    });
    if (!res.ok) return {};
    const rows = await res.json().catch(() => null);
    const out = {};
    for (const r of Array.isArray(rows) ? rows : []) out[String(r.coupon_code).toUpperCase()] = Number(r.uses) || 0;
    return out;
  } catch { return {}; }
}

async function upsert(value, rowKey = "coupons") {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return false;
  const res = await fetch(`${url}/rest/v1/pricing_config?on_conflict=key`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({ key: rowKey, value, updated_at: new Date().toISOString() }),
  });
  return res.ok;
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: HEADERS, body: "" };

  if (event.httpMethod === "GET") {
    const auth = verifyAdminToken(bearerFromEvent(event));
    if (!auth.ok) return respond(401, { ok: false, error: auth.reason || "Unauthorized" });
    // Same read path checkout uses (loadPricing().coupons: static merged with
    // whatever is actually in pricing_config) — so this is what the admin UI
    // can trust as "what checkout will really see", not a second guess at it.
    const pricing = await loadPricing();
    const [catalog, uses] = await Promise.all([readRow("coupon_catalog"), readUses()]);
    return respond(200, {
      ok: true, coupons: pricing.coupons, persisted: SUPABASE_CONFIGURED(), demo: auth.demo,
      // null = nothing stored yet (first load after this shipped) — the client
      // then pushes its own list up instead of treating it as "no coupons".
      catalog: Array.isArray(catalog) ? catalog : null,
      uses,
    });
  }

  if (event.httpMethod === "POST") {
    const auth = verifyAdminToken(bearerFromEvent(event));
    if (!auth.ok) return respond(401, { ok: false, error: auth.reason || "Unauthorized" });

    let body;
    try { body = JSON.parse(event.body || "{}"); } catch { return respond(400, { ok: false, error: "Invalid JSON" }); }

    const coupons = sanitizeCoupons(body.coupons);

    if (!SUPABASE_CONFIGURED()) {
      return respond(200, { ok: true, persisted: false, demo: auth.demo,
        warning: "Supabase not configured — coupons not persisted server-side, so they cannot be redeemed at checkout." });
    }

    let saved = false;
    try { saved = await upsert(coupons); } catch { saved = false; }
    if (!saved) return respond(502, { ok: false, error: "Failed to persist coupons to Supabase." });

    // The admin catalog is optional so an older client (coupons-only POST) keeps working.
    const catalog = sanitizeCatalog(body.catalog);
    if (catalog) {
      let catalogSaved = false;
      try { catalogSaved = await upsert(catalog, "coupon_catalog"); } catch { catalogSaved = false; }
      if (!catalogSaved) return respond(502, { ok: false, error: "Coupons saved for checkout, but the admin list could not be persisted." });
    }
    return respond(200, { ok: true, persisted: true, demo: auth.demo, coupons, ...(catalog ? { catalog } : {}) });
  }

  return respond(405, { ok: false, error: "Method not allowed" });
};
