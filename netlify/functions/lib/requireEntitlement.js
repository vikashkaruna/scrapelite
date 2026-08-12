// requireEntitlement.js — server-side capability enforcement.
//
// Until now every entitlement decision in DatIQ lived in the browser, derived
// from `subscription.planId` in localStorage. That is fine for UX but it is not
// authorization: clearing localStorage, or POSTing straight to /api/extract,
// bypassed it completely. This module is the server half.
//
// ── TWO RULES THAT MUST NOT BE "HARDENED" LATER ──────────────────────────────
//
// 1. FAIL OPEN ON INFRASTRUCTURE, FAIL CLOSED ON STATUS.
//    If Supabase is unreachable we ALLOW the request. An entitlement lookup
//    must never turn a database blip into a total product outage — today
//    /api/extract works with Supabase down, and that must stay true. We deny
//    only when we successfully read a row that explicitly says suspended /
//    deactivated / purged. This mirrors the deliberate choice already made for
//    coupon enforcement in lib/pricingSource.js (`reserveCoupon` → null means
//    "enforcement unavailable", and payments proceed rather than hard-fail).
//
// 2. GUESTS ARE NOT COVERED HERE.
//    Unauthenticated callers keep exactly today's behaviour: the per-host token
//    bucket in lib/rateLimiter.js is their only gate. This module raises the
//    floor for signed-in users; it is not a general-purpose API gateway. Do not
//    assume it protects anything for anonymous traffic.
//
// The plan table is the STATIC one from src/lib/pricingConfig.js on purpose.
// src/lib/pricingOverrides.js reads localStorage, so admin price/limit
// overrides are per-operator-browser and must never influence a server-side
// authorization decision.
import { createClient } from "@supabase/supabase-js";
import { PLAN_BY_ID } from "../../../src/lib/pricingConfig.js";
import { can, computeLifecycle } from "../../../src/lib/entitlementModel.js";
import { noRealtimeOptions } from "./supabaseServerClient.js";

/** Anon-key client carrying the caller's JWT — same shape as extractions.js. */
function getSupabaseForUser(authHeader) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, noRealtimeOptions({
    global: { headers: authHeader ? { Authorization: authHeader } : {} },
    auth: { persistSession: false },
  }));
}

/** Service-key REST handle. Deliberately not the SDK — matches the house style. */
function getServiceDb() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return {
    base: `${url}/rest/v1`,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  };
}

export function bearerFromEvent(event) {
  return event?.headers?.authorization || event?.headers?.Authorization || "";
}

/**
 * Read one entitlements row with the SERVICE key.
 *
 * Service key rather than the user's JWT on purpose: it is immune to RLS policy
 * drift, and it means a user cannot make themselves look unrestricted by
 * arranging for their own row to be unreadable.
 *
 * @returns {{row: object|null, degraded: boolean}}
 *   degraded=true means "we could not find out" → callers must fail open.
 */
export async function fetchEntitlement(userId) {
  const db = getServiceDb();
  if (!db || !userId) return { row: null, degraded: true };
  try {
    const res = await fetch(
      `${db.base}/entitlements?user_id=eq.${encodeURIComponent(userId)}&select=*&limit=1`,
      { headers: db.headers },
    );
    if (!res.ok) return { row: null, degraded: true };
    const rows = await res.json();
    // No row is NOT degraded: a signed-in user with no entitlement row is a
    // legitimate free user. Absence is an answer.
    return { row: Array.isArray(rows) && rows[0] ? rows[0] : null, degraded: false };
  } catch {
    return { row: null, degraded: true };
  }
}

/**
 * Resolve who is calling and what they are entitled to.
 *
 * @returns {{userId: string|null, guest: boolean, entitlement: object|null,
 *            degraded: boolean, planMap: object, supabase: object|null}}
 */
export async function resolveRequestEntitlement(event) {
  const authHeader = bearerFromEvent(event);
  const base = { planMap: PLAN_BY_ID, supabase: null };

  if (!authHeader) {
    return { ...base, userId: null, guest: true, entitlement: null, degraded: false };
  }

  const supabase = getSupabaseForUser(authHeader);
  if (!supabase) {
    // Supabase not configured at all — treat as guest, fail open.
    return { ...base, userId: null, guest: true, entitlement: null, degraded: true };
  }

  let user = null;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (!error) user = data?.user ?? null;
  } catch {
    /* fall through to degraded */
  }

  if (!user) {
    // A token was presented but could not be verified. Do NOT silently upgrade
    // this to "guest with full free access" — but also do not 500. Treat as a
    // guest; the rate limiter still applies.
    return { ...base, userId: null, guest: true, entitlement: null, degraded: true };
  }

  const { row, degraded } = await fetchEntitlement(user.id);
  return {
    ...base,
    supabase,
    userId: user.id,
    guest: false,
    entitlement: row,
    degraded,
  };
}

/**
 * Decide a capability for an already-resolved request.
 * Fails open when the caller is a guest or when the lookup degraded.
 */
export function checkCapability(resolved, capability, ctx = {}) {
  if (!resolved || resolved.guest || resolved.degraded) {
    return { allowed: true, reason: null, code: null, remaining: Infinity };
  }
  if (!resolved.entitlement) {
    // Signed in, no row yet → free plan, active. Plan limits still apply.
    return can({ plan_id: "free", status: "active" }, capability, {
      planMap: resolved.planMap,
      ...ctx,
    });
  }
  return can(resolved.entitlement, capability, { planMap: resolved.planMap, ...ctx });
}

/** Convenience: resolve + check in one call. */
export async function requireCapability(event, capability, ctx = {}) {
  const resolved = await resolveRequestEntitlement(event);
  return { resolved, check: checkCapability(resolved, capability, ctx) };
}

/** HTTP status for a denied capability. See denyBody for why 402. */
export const DENY_STATUS = 402;

/**
 * JSON body for a denied capability.
 *
 * Exposed separately from denyResponse because the functions do not share a
 * header convention — extract.js builds CORS headers inside its own respond()
 * helper, schedules.js has a CORS constant. Callers use whichever fits.
 *
 * `lifecycle: true` distinguishes "your subscription lapsed" from "your plan
 * doesn't include this", so the client can route to renewal vs upgrade without
 * string-matching the message.
 */
export function denyBody(check) {
  return {
    error: check.reason,
    code: check.code,
    lifecycle:
      check.code === "SUSPENDED" || check.code === "DEACTIVATED" || check.code === "PURGED",
    upgradeTo: check.upgradeTo ?? null,
    remaining: Number.isFinite(check.remaining) ? check.remaining : null,
  };
}

/**
 * Full HTTP response for a denied capability.
 *
 * 402 Payment Required: the one status that unambiguously means "this is a
 * billing problem, not a bug and not a login problem".
 */
export function denyResponse(check, extraHeaders = {}) {
  return {
    statusCode: DENY_STATUS,
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(denyBody(check)),
  };
}

/** Re-exported so callers can render lifecycle state without a second import. */
export { computeLifecycle };
