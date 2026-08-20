// Server-authoritative anonymous identity and quota.

import { createHash, randomBytes } from "node:crypto";

const COOKIE = "datiq_guest_id";
const MAX_AGE = 60 * 60 * 24 * 365;
const DEFAULT_SINGLE_LIMIT = 10;
const DEFAULT_BATCH_LIMIT = 5;

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
  return {
    single: Number.isFinite(single) && single > 0 ? Math.floor(single) : DEFAULT_SINGLE_LIMIT,
    batch: Number.isFinite(batch) && batch > 0 ? Math.floor(batch) : DEFAULT_BATCH_LIMIT,
  };
}

export async function consumeGuestCredit(event, kind = "single", env = process.env) {
  if (event?.headers?.authorization || event?.headers?.Authorization) {
    return { ok: true, allowed: true, authenticated: true, degraded: false, cookie: null, remaining: null };
  }
  const identity = cookieValue(event) || newIdentity();
  const cookie = setCookie(identity);
  const d = db(env);
  if (!d) return { ok: true, allowed: true, degraded: true, cookie, remaining: null };

  try {
    const res = await fetch(`${d.base}/rpc/consume_guest_credit`, {
      method: "POST",
      headers: d.headers,
      body: JSON.stringify({
        p_token_hash: hashIdentity(identity),
        p_kind: kind === "batch" ? "batch" : "single",
        p_single_limit: limits(env).single,
        p_batch_limit: limits(env).batch,
      }),
    });
    if (!res.ok) return { ok: false, allowed: true, degraded: true, cookie, remaining: null };
    const data = await res.json();
    return { ok: true, allowed: data?.allowed !== false, degraded: false, cookie, remaining: data?.remaining ?? null, reason: data?.reason, kind: data?.kind || kind };
  } catch {
    return { ok: false, allowed: true, degraded: true, cookie, remaining: null };
  }
}

export const _internal = { COOKIE, DEFAULT_SINGLE_LIMIT, DEFAULT_BATCH_LIMIT, hashIdentity, limits, cookieValue };
