// Server-authoritative anonymous identity and quota.

import { createHash, randomBytes } from "node:crypto";

const COOKIE = "datiq_guest_id";
const MAX_AGE = 60 * 60 * 24 * 365;
const DEFAULT_SINGLE_LIMIT = 10;
const DEFAULT_BATCH_LIMIT = 5;
// One free Discoverability audit per guest identity — its OWN bucket (0073), so
// an audit (fetch + PageSpeed + citation sample + AI) never draws on the ten
// cheap extraction credits, and the UI's "one free audit" is what is enforced.
const DEFAULT_AUDIT_LIMIT = 1;

function db(env = process.env) {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return { base: `${url}/rest/v1`, headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" } };
}

function cookieValue(event) {
  const raw = event?.headers?.cookie || event?.headers?.Cookie || "";
  const found = raw.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`));
  return found ? decodeURIComponent(found.slice(COOKIE.length + 1)) : "";
}

function newIdentity() {
  return randomBytes(32).toString("base64url");
}

function hashIdentity(identity) {
  return createHash("sha256").update(identity, "utf8").digest("hex");
}

function setCookie(identity) {
  return `${COOKIE}=${encodeURIComponent(identity)}; Max-Age=${MAX_AGE}; Path=/; HttpOnly; SameSite=Lax; Secure`;
}

function limits(env = process.env) {
  const single = Number(env.GUEST_SINGLE_HARD_LIMIT || DEFAULT_SINGLE_LIMIT);
  const batch = Number(env.GUEST_BATCH_HARD_LIMIT || DEFAULT_BATCH_LIMIT);
  const audit = Number(env.GUEST_AUDIT_HARD_LIMIT || DEFAULT_AUDIT_LIMIT);
  return {
    single: Number.isFinite(single) && single > 0 ? Math.floor(single) : DEFAULT_SINGLE_LIMIT,
    batch: Number.isFinite(batch) && batch > 0 ? Math.floor(batch) : DEFAULT_BATCH_LIMIT,
    audit: Number.isFinite(audit) && audit > 0 ? Math.floor(audit) : DEFAULT_AUDIT_LIMIT,
  };
}

/**
 * Reserve one anonymous credit.
 *
 * 🔴 `verifiedUserId` MUST come from a token the caller has already verified.
 * This used to skip the charge whenever ANY `Authorization` header was present,
 * trusting the caller to have checked it — so `Authorization: Bearer x` bought
 * unlimited guest extractions and audits. A header is a claim; only a resolved
 * user id is a sign-in.
 *
 * @param {object} event
 * @param {"single"|"batch"|"audit"} kind
 * @param {{verifiedUserId?: string|null, env?: object}} [options]
 */
export async function consumeGuestCredit(event, kind = "single", { verifiedUserId = null, env = process.env } = {}) {
  if (verifiedUserId) {
    return { ok: true, allowed: true, authenticated: true, degraded: false, cookie: null, remaining: null };
  }
  const identity = cookieValue(event) || newIdentity();
  const cookie = setCookie(identity);
  const d = db(env);
  if (!d) return { ok: true, allowed: true, degraded: true, cookie, remaining: null };

  const rpcKind = kind === "batch" || kind === "audit" ? kind : "single";
  const lim = limits(env);
  const payload = {
    p_token_hash: hashIdentity(identity),
    p_kind: rpcKind,
    p_single_limit: lim.single,
    p_batch_limit: lim.batch,
  };
  // Sent ONLY for audits. PostgREST resolves an RPC by its named arguments, so
  // adding this key to every call would stop single/batch credits resolving
  // against a database that has not yet applied 0073 — and that path fails open.
  if (rpcKind === "audit") payload.p_audit_limit = lim.audit;

  try {
    const res = await fetch(`${d.base}/rpc/consume_guest_credit`, {
      method: "POST",
      headers: d.headers,
      body: JSON.stringify(payload),
    });
    if (!res.ok) return { ok: false, allowed: true, degraded: true, cookie, remaining: null };
    const data = await res.json();
    return { ok: true, allowed: data?.allowed !== false, degraded: false, cookie, remaining: data?.remaining ?? null, reason: data?.reason, kind: data?.kind || rpcKind };
  } catch {
    return { ok: false, allowed: true, degraded: true, cookie, remaining: null };
  }
}

/**
 * Is this guest still within their bucket — WITHOUT spending from it.
 *
 * 🔴 /api/ai MUST CHECK, NEVER CONSUME, AND THE DIFFERENCE IS THE WHOLE POINT.
 * One extraction from the browser is /api/extract (which charges the bucket)
 * PLUS one or two /api/ai calls for the summary and link tagging. Charging
 * each of those would take a guest from ten extractions to three or four,
 * silently, while GuestTrialBanner carried on advertising ten — the server
 * and the UI would disagree about the same number.
 *
 * The leak L0b describes is "a guest can call /api/ai without limit", and a
 * READ closes it exactly: once the ten extraction credits are gone, the AI
 * endpoint stops too. Nothing is double-charged to get there.
 *
 * ⚠️ FAILS OPEN on anything it cannot determine — no cookie (a first-time
 * visitor has spent nothing), no row, no database. Only an explicit count at
 * or over the limit refuses, which is the same asymmetry requireEntitlement
 * holds: closed on a known state, open on infrastructure.
 */
export async function peekGuestCredit(event, kind = "single", { verifiedUserId = null, env = process.env } = {}) {
  if (verifiedUserId) return { allowed: true, authenticated: true };

  const identity = cookieValue(event);
  // No cookie at all means no charged extraction has ever happened for this
  // browser, so there is nothing to have exhausted.
  if (!identity) return { allowed: true, fresh: true };

  const d = db(env);
  if (!d) return { allowed: true, degraded: true };

  const lim = limits(env);
  const column = kind === "batch" ? "batch_count" : kind === "audit" ? "audit_count" : "single_count";
  const max = kind === "batch" ? lim.batch : kind === "audit" ? lim.audit : lim.single;

  try {
    const res = await fetch(
      `${d.base}/guest_identities?token_hash=eq.${encodeURIComponent(hashIdentity(identity))}&select=${column}&limit=1`,
      { headers: d.headers },
    );
    if (!res.ok) return { allowed: true, degraded: true };
    const rows = await res.json();
    // 0073 added audit_count. On a database that has not applied it the column
    // is absent and PostgREST answers 400, caught above as degraded — which is
    // the open direction, as it must be.
    const used = Number(rows?.[0]?.[column] ?? 0);
    if (!Number.isFinite(used)) return { allowed: true, degraded: true };
    return {
      allowed: used < max,
      remaining: Math.max(0, max - used),
      reason: used >= max ? `${kind}_limit_reached` : undefined,
      kind,
    };
  } catch {
    return { allowed: true, degraded: true };
  }
}

export const _internal = { COOKIE,  DEFAULT_SINGLE_LIMIT, DEFAULT_BATCH_LIMIT, DEFAULT_AUDIT_LIMIT, hashIdentity, limits, cookieValue };
