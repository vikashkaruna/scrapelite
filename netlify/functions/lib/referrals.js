// netlify/functions/lib/referrals.js — referral codes and rewards.
//
// A referral grants real, paid quota (25 extractions to each side), so every
// part of it is server-issued and server-granted. The previous implementation
// lived entirely in the beneficiary's localStorage, which meant:
//
//   * every user got the same code — an LCG whose multiply overflowed
//     Number.MAX_SAFE_INTEGER, so the low bits were always zero and the
//     alphabet index was always 0 ("AAAAAAAA");
//   * the "bonus" was written to a key nothing but the banner label read, so
//     it never granted an extraction;
//   * the referrer was never credited at all, because redemption happened in
//     the invitee's browser;
//   * and a second browser profile farmed it without limit.
//
// Codes come from `issue_referral_code`, rewards from `redeem_referral_code`;
// both are in supabase/migrations/0029_referrals.sql and both are atomic.
// This module is a thin, honest wrapper — it does not compute codes, decide
// eligibility, or add up bonuses. Those are the database's job precisely
// because the client cannot be trusted with them.
//
// FAILS CLOSED, like lib/scrapeConsent.js: if the store cannot answer, the
// caller gets "no code" / "not redeemed" rather than a fabricated reward.

/** Extractions granted to EACH side of a successful referral. */
export const REFERRAL_BONUS = 25;

function serviceDb(env = process.env) {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return {
    base: `${url}/rest/v1`,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
  };
}

async function rpc(db, fn, body) {
  const res = await fetch(`${db.base}/rpc/${fn}`, {
    method: "POST",
    headers: db.headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`${fn} failed (${res.status}): ${detail.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * This user's invite code, minted on first call and stable thereafter.
 * Returns { code: string|null, degraded: boolean }.
 */
export async function getOrIssueCode(userId, env = process.env) {
  if (!userId) return { code: null, degraded: false };
  const db = serviceDb(env);
  if (!db) return { code: null, degraded: true };
  try {
    const code = await rpc(db, "issue_referral_code", { p_user_id: userId });
    return { code: typeof code === "string" ? code : null, degraded: false };
  } catch (err) {
    console.error("[DatIQ] issue_referral_code failed:", err.message);
    return { code: null, degraded: true };
  }
}

/**
 * Redeem `code` for this user. The database credits BOTH sides atomically.
 * Returns { ok, bonus?, reason?, degraded }.
 * reason ∈ invalid | self | already | unavailable
 */
export async function redeemCode(userId, code, env = process.env) {
  if (!userId || !code) return { ok: false, reason: "invalid", degraded: false };
  const db = serviceDb(env);
  if (!db) return { ok: false, reason: "unavailable", degraded: true };
  try {
    const result = await rpc(db, "redeem_referral_code", {
      p_invitee_id: userId,
      p_code: String(code),
      p_bonus: REFERRAL_BONUS,
    });
    if (result?.ok) return { ok: true, bonus: result.bonus ?? REFERRAL_BONUS, degraded: false };
    return { ok: false, reason: result?.reason || "invalid", degraded: false };
  } catch (err) {
    console.error("[DatIQ] redeem_referral_code failed:", err.message);
    return { ok: false, reason: "unavailable", degraded: true };
  }
}

/**
 * How this user's referral stands: how many people they have invited
 * successfully, and the bonus balance the entitlement carries.
 * Never throws — a stats read must not break the banner.
 */
export async function getReferralStats(userId, env = process.env) {
  const empty = { referrals: 0, bonus: 0, degraded: false };
  if (!userId) return empty;
  const db = serviceDb(env);
  if (!db) return { ...empty, degraded: true };
  try {
    const [countRes, entRes] = await Promise.all([
      fetch(
        `${db.base}/referral_redemptions?select=id&referrer_user_id=eq.${userId}`,
        { headers: { ...db.headers, Prefer: "count=exact" } },
      ),
      fetch(
        `${db.base}/entitlements?select=bonus_extractions&user_id=eq.${userId}&limit=1`,
        { headers: db.headers },
      ),
    ]);
    if (!countRes.ok || !entRes.ok) return { ...empty, degraded: true };
    const rows = await countRes.json();
    const ent = await entRes.json();
    return {
      referrals: Array.isArray(rows) ? rows.length : 0,
      bonus: Array.isArray(ent) && ent[0] ? ent[0].bonus_extractions || 0 : 0,
      degraded: false,
    };
  } catch (err) {
    console.error("[DatIQ] referral stats failed:", err.message);
    return { ...empty, degraded: true };
  }
}

export const _internal = { serviceDb, rpc };
