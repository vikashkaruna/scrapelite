// netlify/functions/lib/accountState.js — freeze, unfreeze, and the deletion request.
//
// A thin, honest wrapper over the atomic functions in
// supabase/migrations/0032_account_state_and_audit_summary.sql. Same shape as
// lib/workspaces.js and lib/referrals.js: it decides nothing, it calls the
// database's functions and reports what they say.
//
// ── 🔴 IT CANNOT DELETE ANYTHING ───────────────────────────────────────────
// `requestAccountDeletion` records INTENT and freezes the account. The actual
// deletion is billing-purge.js — five interlocks, disarmed by default, dry-run
// mode, blast-radius cap — and it stays the only destructive path in the
// system. A second one reachable from a UI button would mean the careful path
// and the careless path both existed.
//
// ── FAILS CLOSED ───────────────────────────────────────────────────────────
// Unlike requireEntitlement, which fails OPEN so a Supabase blip cannot take
// extraction down. The asymmetry is deliberate and runs the other way here: if
// we cannot confirm a freeze was recorded, the honest answer is "we could not
// do that", not a green tick over nothing. A user who believes their account is
// frozen when it is not will discover it from an invoice.

const DEFAULT_GRACE_DAYS = 30;

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
    method: "POST", headers: db.headers, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${fn} failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** The account-state fields the UI needs. Never throws. */
export async function getAccountState(userId, env = process.env) {
  const db = serviceDb(env);
  if (!db || !userId) return { available: false };
  try {
    const res = await fetch(
      `${db.base}/entitlements?user_id=eq.${encodeURIComponent(userId)}` +
      "&select=frozen_at,frozen_reason,deletion_requested_at,deletion_purge_after,status,plan_id,period_end&limit=1",
      { headers: db.headers },
    );
    if (!res.ok) return { available: false };
    const row = (await res.json())[0] || null;
    return {
      available: true,
      frozen: Boolean(row?.frozen_at),
      frozenAt: row?.frozen_at || null,
      frozenReason: row?.frozen_reason || null,
      deletionRequestedAt: row?.deletion_requested_at || null,
      deletionPurgeAfter: row?.deletion_purge_after || null,
      status: row?.status || "active",
      planId: row?.plan_id || "free",
      // For DangerZone.jsx's plan-aware deletion message — see 0033's
      // request_account_deletion, which uses this same column to keep an
      // active paid plan from being purged before its period actually ends.
      periodEnd: row?.period_end || null,
    };
  } catch {
    return { available: false };
  }
}

/**
 * Freeze or unfreeze.
 *
 * `deletion_pending` from the database is not an error — it is the interlock
 * saying an account awaiting deletion cannot simply be unfrozen, because that
 * would leave it consuming units with a purge date sitting on it.
 */
export async function setAccountFrozen(userId, frozen, reason, env = process.env) {
  const db = serviceDb(env);
  if (!db) return { ok: false, error: "unavailable" };
  try {
    const verdict = await rpc(db, "set_account_frozen", {
      p_user_id: userId,
      p_frozen: Boolean(frozen),
      p_reason: reason ? String(reason).slice(0, 500) : null,
      p_actor: userId,
    });
    if (verdict === "ok") return { ok: true };
    return { ok: false, error: verdict };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** Record a deletion request. Returns the date the purge job may act on it. */
export async function requestAccountDeletion(userId, env = process.env) {
  const db = serviceDb(env);
  if (!db) return { ok: false, error: "unavailable" };
  try {
    const purgeAfter = await rpc(db, "request_account_deletion", {
      p_user_id: userId, p_grace_days: DEFAULT_GRACE_DAYS,
    });
    if (!purgeAfter) return { ok: false, error: "not_found" };
    return { ok: true, purgeAfter, graceDays: DEFAULT_GRACE_DAYS };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function cancelAccountDeletion(userId, env = process.env) {
  const db = serviceDb(env);
  if (!db) return { ok: false, error: "unavailable" };
  try {
    const verdict = await rpc(db, "cancel_account_deletion", { p_user_id: userId });
    return verdict === "ok" ? { ok: true } : { ok: false, error: verdict };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export const _internal = { serviceDb, rpc, DEFAULT_GRACE_DAYS };
