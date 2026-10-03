// adminConfigService.js — client wrapper for the admin AI provider config.
// Reads/writes via /api/admin-ai-config; POST sends the admin session token
// (issued by admin-auth.js, stored by adminService.js) as a Bearer header.

import { mergeServerCoupons, buildCouponsSyncPayload, buildCouponCatalogPayload } from "./adminService.js";

const ENDPOINT = "/api/admin-ai-config";
const ADMIN_AUTH_KEY = "scrapelite.adminAuth"; // session token (see adminService.js)

export function adminToken() {
  return localStorage.getItem(ADMIN_AUTH_KEY) || "";
}

/** Fetch current effective config + per-provider key presence. */
export async function getAiConfig() {
  const res = await fetch(ENDPOINT, {
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken()}` },
  });
  if (!res.ok) throw new Error(`Failed to load AI config (${res.status})`);
  return res.json(); // { ok, config, keyPresence, providers, persisted }
}

/** Persist a new config. Returns { ok, persisted, warning? }. */
export async function saveAiConfig(config) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken()}` },
    body: JSON.stringify(config),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Save failed (${res.status})`);
  return data;
}

// ── Live provider tests ──────────────────────────────────────────────────────
// Key PRESENCE is not health. Production ran for weeks with all three AI keys
// set and all three dead — one invalid, two out of credit — while the console
// showed them configured and the health dashboard showed them green. These
// endpoints actually call the vendor.

const TEST_ENDPOINT = "/api/admin-provider-test";

/** The full provider catalogue (AI + scrape + intel) with key presence. */
export async function getProviderCatalogue() {
  const res = await fetch(TEST_ENDPOINT, {
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken()}` },
  });
  if (!res.ok) throw new Error(`Failed to load providers (${res.status})`);
  return res.json();
}

/**
 * Live-test ONE provider. `model` is optional and lets an operator try a model
 * id BEFORE saving it as the default — which is what makes free-text model
 * entry safe.
 */
export async function testProvider(provider, model, { grounded = false } = {}) {
  const res = await fetch(TEST_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken()}` },
    body: JSON.stringify({ provider, ...(model ? { model } : {}), ...(grounded ? { grounded: true } : {}) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Test failed (${res.status})`);
  return data.result;
}

/** Live-test every provider (or a named subset) in parallel. */
export async function testAllProviders(providers) {
  const res = await fetch(TEST_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken()}` },
    body: JSON.stringify({ all: true, ...(providers ? { providers } : {}) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Test failed (${res.status})`);
  return data.results || [];
}

// ── Coupons (checkout-facing sync) ───────────────────────────────────────────
// See netlify/functions/admin-coupons-config.js for why this exists: saveCoupon
// in adminService.js only ever wrote to the admin's own localStorage, so a
// coupon created in /admin/coupons could never actually be redeemed at
// checkout. AdminCoupons.jsx calls saveCouponsConfig() after every local
// mutation with the FULL current percent-type coupon set (see its
// buildCouponsSyncPayload helper) — this endpoint replaces the whole stored
// value, it does not merge one code in.

const COUPONS_ENDPOINT = "/api/admin-coupons-config";

/** What checkout will actually see: static table merged with pricing_config. */
export async function getCouponsConfig() {
  const res = await fetch(COUPONS_ENDPOINT, {
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken()}` },
  });
  if (!res.ok) throw new Error(`Failed to load coupon sync state (${res.status})`);
  return res.json(); // { ok, coupons, persisted }
}

/**
 * Replace the checkout-facing coupon map. `coupons` is {CODE: {value,planId,expiresAt,active,maxUses}}
 * (credit coupons carry `credits`). `catalog`, when given, is the admin's full list and is stored
 * alongside so every browser sees the same coupons.
 */
export async function saveCouponsConfig(coupons, catalog) {
  const res = await fetch(COUPONS_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken()}` },
    body: JSON.stringify({ coupons, ...(catalog ? { catalog } : {}) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Save failed (${res.status})`);
  return data;
}

/**
 * Load the server's coupon list into this browser's and, if this browser holds
 * coupons the server has never seen (legacy localStorage-only ones), push the
 * merged list up so they become durable. Returns the merged list, or `null`
 * when the server could not be reached (caller keeps the local list).
 */
export async function syncCouponsFromServer() {
  let cfg;
  try { cfg = await getCouponsConfig(); } catch { return null; }
  const { merged, localOnly } = mergeServerCoupons({ catalog: cfg.catalog, checkoutMap: cfg.coupons, uses: cfg.uses });
  // Push when the server has no catalog yet or lacks something this browser has.
  if (cfg.persisted !== false && (cfg.catalog == null || localOnly.length > 0)) {
    try { await saveCouponsConfig(buildCouponsSyncPayload(merged), buildCouponCatalogPayload(merged)); } catch { /* retried next load */ }
  }
  return merged;
}

// ── General / global settings ────────────────────────────────────────────────

const GENERAL_ENDPOINT = "/api/admin-general-config";

/** Fetch current global application settings. */
export async function getGeneralConfig() {
  const res = await fetch(GENERAL_ENDPOINT, { headers: { "Content-Type": "application/json" } });
  if (!res.ok) throw new Error(`Failed to load settings (${res.status})`);
  return res.json(); // { ok, settings, persisted }
}

/** Persist global settings. Returns { ok, persisted, warning? }. */
export async function saveGeneralConfig(settings) {
  const res = await fetch(GENERAL_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken()}` },
    body: JSON.stringify({ settings }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Save failed (${res.status})`);
  return data;
}

// ── Revenue dashboard ────────────────────────────────────────────────────────

const REVENUE_ENDPOINT = "/api/admin-revenue";

/** Fetch live revenue metrics and trend from Supabase. Returns { metrics, trend, fromSeed, warning? }. */
export async function getRevenueData() {
  const res = await fetch(REVENUE_ENDPOINT, {
    headers: { Authorization: `Bearer ${adminToken()}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Failed to load revenue data (${res.status})`);
  return data;
}

// ── User management ──────────────────────────────────────────────────────────

const USERS_ENDPOINT = "/api/admin-users";

/** Fetch all registered users from Supabase auth. Returns { users, fromSeed, warning? }. */
export async function fetchRealUsers() {
  const res = await fetch(USERS_ENDPOINT, {
    headers: { Authorization: `Bearer ${adminToken()}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Failed to load users (${res.status})`);
  return data;
}

/** Extend a user's bonus CREDITS by writing to their auth metadata.
 *  The field is still named `bonus_extractions` — it is a stored wire name, and
 *  renaming it would orphan every row already written. BillingProvider reads it
 *  as credits; §4.6 of CREDITS-UNIFICATION-PROPOSAL.md records the migration. */
export async function extendUserBonus(userId, bonus) {
  const res = await fetch(USERS_ENDPOINT, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken()}` },
    body: JSON.stringify({ userId, bonus }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Extend failed (${res.status})`);
  return data; // { ok, userId, newBonus }
}

import { saveAdminGrant } from "./adminService.js";

/** Issue a user-specific, one-time, non-recurring complimentary plan grant. */
export async function assignAdminGrantCoupon(userId, { couponCode, planId, validityMonths, claimExpiresAt, reason, userEmail }) {
  try {
    const res = await fetch(USERS_ENDPOINT, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken()}` },
      body: JSON.stringify({
        action: "assign_grant_coupon",
        userId,
        couponCode,
        planId,
        validityMonths,
        claimExpiresAt: claimExpiresAt || null,
        reason,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data?.ok) {
      saveAdminGrant({
        ...(data.adminGrantCoupon || {}),
        userId,
        userEmail,
        code: couponCode,
        planId,
        validityMonths,
        claimExpiresAt,
        reason,
      });
      return data;
    }
    if (!res.ok && res.status === 503) {
      const localGrant = saveAdminGrant({
        userId,
        userEmail,
        code: couponCode,
        planId,
        validityMonths,
        claimExpiresAt,
        reason,
      });
      return { ok: true, userId, adminGrantCoupon: localGrant, localOnly: true };
    }
    throw new Error(data.error || `Issue grant failed (${res.status})`);
  } catch (err) {
    if (err.message && !err.message.includes("failed") && !err.message.includes("503")) throw err;
    const localGrant = saveAdminGrant({
      userId,
      userEmail,
      code: couponCode,
      planId,
      validityMonths,
      claimExpiresAt,
      reason,
    });
    return { ok: true, userId, adminGrantCoupon: localGrant, localOnly: true };
  }
}

/** Send a Supabase auth invite email. Returns { ok, userId, email } or throws. */
export async function inviteUserByEmail(form) {
  const res = await fetch(USERS_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken()}` },
    body: JSON.stringify(form),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Invite failed (${res.status})`), { status: res.status, localOnly: data.localOnly });
  return data;
}

// ── Gallery curation ─────────────────────────────────────────────────────────
// The human-verification gate for /gallery — an admin previews a shared
// report's actual content, then tags it with a persona to promote it into
// the curated showcase. See netlify/functions/admin-gallery.js.

const GALLERY_ENDPOINT = "/api/admin-gallery";

/** Fetch every public_reports row for admin review. Returns { reports, warning? }. */
export async function fetchGalleryReports() {
  const res = await fetch(GALLERY_ENDPOINT, {
    headers: { Authorization: `Bearer ${adminToken()}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Failed to load gallery reports (${res.status})`);
  return data;
}

/** Promote a report into the curated showcase under the given persona. */
export async function curateGalleryReport(id, persona) {
  const res = await fetch(GALLERY_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken()}` },
    body: JSON.stringify({ action: "curate", id, persona }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Curate failed (${res.status})`);
  return data;
}

/**
 * TAKE DOWN a published page — revoke the link entirely.
 *
 * ⚠️ Different in kind from uncurate. Uncurate removes a report from the
 * showcase and it STAYS PUBLICLY READABLE at its own URL; takedown revokes the
 * link so nobody can reach it. Conflating them is how someone means to tidy
 * the gallery and instead kills a customer's live share link.
 *
 * The reason is mandatory — the server refuses without one.
 */
export async function takedownGalleryReport(id, reason) {
  const res = await fetch(GALLERY_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken()}` },
    body: JSON.stringify({ action: "takedown", id, reason }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `Takedown failed (${res.status})`);
  return data;
}

/** Remove a report from the curated showcase (it stays shared/public). */
export async function uncurateGalleryReport(id) {
  const res = await fetch(GALLERY_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken()}` },
    body: JSON.stringify({ action: "uncurate", id }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Uncurate failed (${res.status})`);
  return data;
}

/** Permanently delete a report completely from the database. */
export async function deleteGalleryReport(id) {
  const res = await fetch(GALLERY_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken()}` },
    body: JSON.stringify({ action: "delete", id }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `Delete failed (${res.status})`);
  return data;
}

