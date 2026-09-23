// netlify/functions/lib/creditMeter.js — the choke point.
//
// ── THE STRUCTURAL RULE THIS MODULE EXISTS TO ENFORCE ───────────────────────
// Meter at the CHOKE POINT, not per feature. Exactly four functions in this
// codebase spend money — runChain, runScrapeChain, fetchWebVitals and
// sampleCitations — and every one of them routes its charge through here. A
// module that adds an AI call is therefore metered the day it lands, without
// anyone remembering to price it.
//
// Pricing feature by feature is precisely how L0–L3 and L6 in
// docs/CREDITS-UNIFICATION-PROPOSAL.md happened: six surfaces that each spent
// real provider money and each billed nobody, discovered one at a time, months
// apart, by reading rather than by anything going red.
//
// ── METERING MUST NEVER BREAK THE RUN ───────────────────────────────────────
// Every write here is wrapped and swallowed. A ledger that is unreachable is a
// billing problem; a ledger that takes extraction down with it is an outage.
// This is the same asymmetry withJobRun holds over job_runs, and the same one
// requireEntitlement holds over the entitlement row: fail OPEN on
// infrastructure. The failure is logged and counted, never raised.
//
// ⚠️ THAT IS ALSO WHY A MISSING MIGRATION CANNOT LOCK ANYONE OUT.
// `credit_available` arrives in 0078. Until that has been applied to an
// environment the RPC answers PGRST202, `available()` reports `degraded`, and
// every gate built on it must let the request through. A gate that failed
// closed on an unapplied migration would take the whole product down on the
// day it deployed — which is exactly the shape of the entity-approval outage
// this repo has just finished diagnosing, pointed the other way.

import { createClient } from "@supabase/supabase-js";
import {
  creditsFor, KIND_TO_REASON, KIND_TO_UNIT, CREDIT_WEIGHTS,
} from "../../../src/lib/credits/creditWeights.js";
import { PLAN_BY_ID } from "../../../src/lib/pricingConfig.js";

function serviceDb(env = process.env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Every metered call this process has seen. Test-visible so the parity suite
 * can assert a choke point actually reported, and operator-visible so an
 * unattributed call is countable rather than merely absent.
 */
const stats = { metered: 0, unattributed: 0, failed: 0, degraded: 0 };
export function meterStats() { return { ...stats }; }
export function resetMeterStats() {
  stats.metered = 0; stats.unattributed = 0; stats.failed = 0; stats.degraded = 0;
}

/**
 * A metering context. `caller` is REQUIRED and is not the user id — it names
 * the surface, so an unattributed call can be traced back to the module that
 * made it rather than merely counted.
 *
 * `userId` may legitimately be null (a guest, a platform cron acting on nobody
 * in particular). That is why `caller` carries the identification burden: a
 * null user is a known state, a missing caller is a bug.
 */
export function meterContext({
  caller, userId = null, workspaceId = null, runId = null, kindMap = null,
} = {}) {
  // `kindMap` lets a SURFACE rename what a choke point charges without the
  // choke point knowing the surface exists. A watchlist's page read is still
  // one page and still costs 1, but it belongs in the ledger as a
  // `monitor_check`, because "what did monitoring cost me this month" is a
  // question the customer actually asks. Without this the surface would have
  // to charge by hand — which is exactly how monitoring ended up with its own
  // hand-rolled chargeLedger call and a double-charge waiting to happen.
  //
  // The buffer is what keeps metering off the request's time budget. See
  // record() / flush() below.
  return { caller: caller || null, userId, workspaceId, runId, kindMap, buffer: [] };
}

/** True when this context can be attributed to a surface. */
export function isAttributed(ctx) {
  return Boolean(ctx && typeof ctx.caller === "string" && ctx.caller.trim());
}


// ── WHY CHARGES ARE BUFFERED AND FLUSHED ONCE ───────────────────────────────
// runChain is a SERIAL fallback over three providers inside an 8s wall-clock
// budget, and deadline.js exists because that budget is already tight enough
// to have caused a production 504. Awaiting a Supabase round-trip per provider
// call would spend the customer's deadline on our bookkeeping — so a choke
// point RECORDS (synchronously, into the context) and the request FLUSHES once.
//
// That also collapses the write: a 40-page run produces ~3 ledger rows rather
// than 120, which is the same reasoning toLedgerEntries() already applies to
// template runs. The ledger stays a legible audit trail rather than a firehose.
//
// ⚠️ A REQUEST KILLED BEFORE ITS FLUSH LOSES THE CHARGE, AND THAT IS THE RIGHT
// DIRECTION. 0037's header says a run killed mid-flight writes rows only for
// the items that completed, and chargeableEvents() drops `failed` outcomes
// entirely. Under-billing for our own crash is the error we are willing to
// make; over-billing for work the customer never received is not.

/** Record a cost-bearing call against the context. Synchronous — no I/O. */
export function record(ctx, { kind, quantity = 1, meta = {}, failed = false, cached = false, skipped = false } = {}) {
  // Checked BEFORE attribution: a failed provider call is not a missed charge,
  // so warning about it would train the reader to ignore the warning that
  // matters. The parity test is what catches a call site with no meter at all.
  if (failed || cached || skipped) return { charged: 0, reason: failed ? "failed" : cached ? "cached" : "skipped" };
  if (!isAttributed(ctx)) {
    stats.unattributed += 1;
    console.warn(`[DatIQ] creditMeter: UNATTRIBUTED ${kind} call — nobody will be billed for it.`);
  }
  const effective = ctx?.kindMap?.[kind] || kind;
  const { credits, known } = creditsFor(effective, quantity);
  if (!known) {
    stats.failed += 1;
    console.warn(`[DatIQ] creditMeter: no weight for kind "${effective}" — charged 0.`);
    return { charged: 0, reason: "unknown_kind" };
  }
  if (credits <= 0) return { charged: 0, reason: "zero" };
  if (!ctx || !Array.isArray(ctx.buffer)) return { charged: credits, reason: "no_buffer" };
  ctx.buffer.push({ kind: effective, credits, quantity, meta });
  return { charged: credits, kind: effective };
}

/** What this context has recorded but not yet written. */
export function pending(ctx) {
  return (ctx?.buffer || []).reduce((sum, e) => sum + e.credits, 0);
}

/**
 * Write everything recorded against this context, collapsed to one row per
 * (reason, unit). Safe to call twice — the buffer is drained first, so a retry
 * cannot double-charge.
 */
export async function flush(ctx, env = process.env) {
  const entries = ctx?.buffer || [];
  if (entries.length === 0) return { ok: true, charged: 0, rows: 0 };
  ctx.buffer = [];

  const byKey = new Map();
  for (const e of entries) {
    const reason = KIND_TO_REASON[e.kind] || "adjustment";
    const unit = KIND_TO_UNIT[e.kind] || null;
    const key = `${reason}::${unit}`;
    const prev = byKey.get(key) || { reason, unit, credits: 0, quantity: 0, kinds: new Set() };
    prev.credits += e.credits;
    prev.quantity += e.quantity;
    prev.kinds.add(e.kind);
    byKey.set(key, prev);
  }

  const db = serviceDb(env);
  if (!db) {
    stats.degraded += 1;
    return { ok: false, degraded: true, charged: 0, reason: "not_configured" };
  }

  let charged = 0;
  for (const row of byKey.values()) {
    try {
      const { error } = await db.rpc("credit_spend", {
        p_user_id: ctx?.userId || null,
        p_run_id: ctx?.runId || null,
        p_reason: row.reason,
        p_credits: row.credits,
        p_unit: row.unit,
        p_quantity: row.quantity,
        p_meta: { caller: ctx?.caller || "unknown", kinds: [...row.kinds] },
        p_workspace_id: ctx?.workspaceId || null,
      });
      if (error) {
        stats.failed += 1;
        console.warn(`[DatIQ] creditMeter: flush failed (${row.reason}, ${row.credits}cr): ${error.message}`);
        continue;
      }
      stats.metered += 1;
      charged += row.credits;
    } catch (err) {
      // Swallowed on purpose. See the header.
      stats.failed += 1;
      console.warn(`[DatIQ] creditMeter: ledger unreachable on flush: ${err?.message || err}`);
    }
  }
  return { ok: true, charged, rows: byKey.size };
}

/**
 * Record one cost-bearing provider call.
 *
 * ⚠️ `skipped`, `cached` and `failed` outcomes write NOTHING — not a zero row.
 * creditModel.chargeableEvents() states the same rule for template runs and
 * 0037's header states it for the schema: a run refused at a gate, served from
 * cache, or killed by a provider error produces an EMPTY ledger write. An
 * all-zero ledger is noise that hides real spend.
 */
export async function meter(ctx, {
  kind, quantity = 1, meta = {}, failed = false, cached = false, skipped = false,
} = {}, env = process.env) {
  if (!isAttributed(ctx)) {
    stats.unattributed += 1;
    // Loud, and countable. The parity test is what fails the build; this is
    // what makes a slip visible in production if one ever gets past it.
    console.warn(`[DatIQ] creditMeter: UNATTRIBUTED ${kind} call — nobody will be billed for it.`);
  }
  if (failed || cached || skipped) return { ok: true, charged: 0, reason: failed ? "failed" : cached ? "cached" : "skipped" };

  const { credits, known } = creditsFor(kind, quantity);
  if (!known) {
    // An unpriced kind is reported, never guessed at. Inventing a price bills
    // a customer for a number nobody decided.
    stats.failed += 1;
    console.warn(`[DatIQ] creditMeter: no weight for kind "${kind}" — charged 0.`);
    return { ok: false, charged: 0, reason: "unknown_kind" };
  }
  if (credits <= 0) return { ok: true, charged: 0, reason: "zero" };

  const db = serviceDb(env);
  if (!db) {
    stats.degraded += 1;
    return { ok: false, charged: 0, degraded: true, reason: "not_configured", credits };
  }

  try {
    const { error } = await db.rpc("credit_spend", {
      p_user_id: ctx?.userId || null,
      p_run_id: ctx?.runId || null,
      p_reason: KIND_TO_REASON[kind] || "adjustment",
      p_credits: credits,
      p_unit: KIND_TO_UNIT[kind] || null,
      p_quantity: quantity,
      p_meta: { caller: ctx?.caller || "unknown", kind, ...meta },
      p_workspace_id: ctx?.workspaceId || null,
    });
    if (error) {
      stats.failed += 1;
      console.warn(`[DatIQ] creditMeter: ledger write failed (${kind}, ${credits}cr): ${error.message}`);
      return { ok: false, charged: 0, reason: "write_failed", credits };
    }
  } catch (err) {
    // Swallowed on purpose. See the header.
    stats.failed += 1;
    console.warn(`[DatIQ] creditMeter: ledger unreachable (${kind}): ${err?.message || err}`);
    return { ok: false, charged: 0, degraded: true, reason: "unreachable", credits };
  }

  stats.metered += 1;
  return { ok: true, charged: credits, kind };
}

/**
 * How many credits this user may still spend.
 *
 * 🔴 `degraded: true` MEANS "WE DO NOT KNOW", AND IT IS NOT ZERO.
 * Every caller must treat it as permission to proceed. Reading an unreachable
 * balance as an empty one would refuse paying customers during a Supabase
 * blip, and would refuse EVERY customer in an environment where 0078 has not
 * been applied yet — the function simply would not exist.
 */
export async function available(userId, env = process.env) {
  if (!userId) return { ok: true, available: 0, guest: true, enforced: false };
  const db = serviceDb(env);
  if (!db) return { ok: false, degraded: true, available: null, enforced: false, reason: "not_configured" };
  try {
    const { data, error } = await db.rpc("credit_status", { p_user_id: userId });
    if (error) {
      // PGRST202 here means 0078 has not been applied to this environment.
      // Name it, because "could not read the balance" sends an operator
      // looking at the ledger contents rather than at the migration list.
      const missing = String(error.code || "") === "PGRST202"
        || /could not find the function/i.test(error.message || "");
      if (missing) {
        console.warn("[DatIQ] creditMeter: credit_status() is absent — migration 0078 has "
          + "not been applied to this database. Credit gates are OPEN until it is.");
      }
      return {
        ok: false, degraded: true, available: null, enforced: false,
        reason: missing ? "migration_missing" : "read_failed",
      };
    }
    return {
      ok: true,
      available: Number(data?.available) || 0,
      enforced: Boolean(data?.enforced),
      grants: Number(data?.grants) || 0,
      granted: Number(data?.granted) || 0,
      spent: Number(data?.spent) || 0,
    };
  } catch (err) {
    return { ok: false, degraded: true, available: null, enforced: false, reason: "unreachable", detail: err?.message };
  }
}

/**
 * Would this run fit?
 *
 * 🔴 THREE WAYS THIS SAYS YES, AND ONLY ONE OF THEM MEANS "THEY HAVE THE
 * CREDITS". Every caller acts on `ok`, so the reasons are collapsed here
 * rather than re-derived at each site, which is how a fail-open rule drifts:
 *
 *   degraded  — we could not read the balance (Supabase blip, or 0078 not
 *               applied here). We do not know, and not knowing is never a
 *               reason to refuse paying customers.
 *   !enforced — this account has never been granted credits, so it is not on
 *               the credit system at all. Gates ship before the step that
 *               starts granting allowances; without this every customer would
 *               be refused the day the migration landed.
 *   ok        — they genuinely have the credits.
 *
 * `CREDITS_ENFORCEMENT_DISABLED=1` is the break-glass, read from the
 * environment so that — unlike a database flag — it cannot fail open itself.
 * Same shape as OPS_JOBS_DISABLED.
 */
export async function affords(userId, estimated, env = process.env) {
  if (String(env.CREDITS_ENFORCEMENT_DISABLED || "") === "1") {
    return { ok: true, disabled: true, available: null, estimated };
  }
  const bal = await available(userId, env);
  if (bal.degraded) {
    return { ok: true, degraded: true, available: null, estimated, reason: bal.reason };
  }
  if (!bal.enforced) {
    return { ok: true, inactive: true, available: bal.available, estimated };
  }
  const remaining = bal.available;
  if (remaining >= estimated) return { ok: true, available: remaining, estimated };
  return {
    ok: false, available: remaining, estimated,
    shortfall: estimated - remaining,
  };
}

/**
 * Issue credits. `period` makes it idempotent — a redelivered webhook, a cron
 * that ticked twice, or a retried backfill is a no-op rather than a gift.
 */
export async function grant(userId, credits, {
  period = null, expiresAt = null, meta = {},
} = {}, env = process.env) {
  if (!userId || !(credits > 0)) return { ok: false, reason: "invalid" };
  const db = serviceDb(env);
  if (!db) return { ok: false, degraded: true, reason: "not_configured" };
  try {
    const { data, error } = await db.rpc("credit_grant", {
      p_user_id: userId,
      p_credits: Math.floor(credits),
      p_period: period,
      p_expires_at: expiresAt,
      p_meta: meta,
    });
    if (error) return { ok: false, degraded: true, reason: error.message };
    return data || { ok: false, reason: "no_result" };
  } catch (err) {
    return { ok: false, degraded: true, reason: err?.message || "unreachable" };
  }
}

/** The monthly allowance, carrying 0078's rollover expiry. */
export async function grantMonthly(userId, credits, period, env = process.env) {
  if (!userId || !(credits > 0) || !period) return { ok: false, reason: "invalid" };
  const db = serviceDb(env);
  if (!db) return { ok: false, degraded: true, reason: "not_configured" };
  try {
    const { data, error } = await db.rpc("credit_grant_monthly", {
      p_user_id: userId, p_credits: Math.floor(credits), p_period: period,
    });
    if (error) return { ok: false, degraded: true, reason: error.message };
    return data || { ok: false, reason: "no_result" };
  } catch (err) {
    return { ok: false, degraded: true, reason: err?.message || "unreachable" };
  }
}

export { CREDIT_WEIGHTS };

// ── THE ALLOWANCE ───────────────────────────────────────────────────────────
//
// Granted LAZILY, on first access in a period, rather than by a cron.
//
// 🔴 THAT IS A DELIBERATE CHOICE, NOT A SHORTCUT. This repo has a documented
// incident where four crons declared a schedule and were scheduled nowhere —
// they simply never fired, with no build error and no runtime error, for
// months. A monthly allowance that depends on a cron somebody remembered to
// register in netlify.toml has that failure mode, and its symptom would be
// customers quietly unable to work. A lazy grant cannot silently not-happen:
// the first request that needs the balance creates it.
//
// ⚠️ IT IS SAFE TO CALL ON EVERY REQUEST because credit_grant() is idempotent
// by a unique index, but it is memoised per container anyway so the common
// case is zero round trips.
//
// ⚠️ ONE GRANT PER USER PER MONTH, keyed on the period ALONE and not on the
// plan. Keying it `2026-09:pro` would top a customer up again on every plan
// change, which is farmable; keying it on the period means an upgrade
// mid-month does not add the new plan's pool until the month turns. That is
// the less generous reading and the safe one — recorded here rather than left
// to be discovered.
const allowanceMemo = new Map();   // `${userId}:${period}` → true

/** 'YYYY-MM' in UTC — the same key usageService and credit_balance use. */
export function periodKey(now = Date.now()) {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Make sure this account has had its allowance for the current period.
 *
 * Free (D3) is a ONE-TIME lifetime grant with no expiry — it does not reset,
 * so its key is `signup` and it can never be issued twice. Every paid plan
 * gets a monthly grant carrying 0078's rollover expiry.
 */
export async function ensureAllowance(userId, planId, env = process.env, now = Date.now()) {
  if (!userId) return { ok: false, reason: "no_user" };
  const plan = PLAN_BY_ID[planId || "free"];
  const credits = plan?.limits?.credits;
  if (!Number.isFinite(credits) || credits <= 0) return { ok: false, reason: "no_pool" };

  const lifetime = (planId || "free") === "free";
  const period = lifetime ? "signup" : periodKey(now);
  const memoKey = `${userId}:${period}`;
  if (allowanceMemo.get(memoKey)) return { ok: true, memoised: true };

  const res = lifetime
    ? await grant(userId, credits, {
        period,
        expiresAt: null,   // 🔴 a lifetime pool. An expiry here would quietly
                           // delete the taster from under someone who came
                           // back a month later.
        meta: { kind: "signup", plan: planId || "free" },
      }, env)
    : await grantMonthly(userId, credits, period, env);

  // `already_granted` is a SUCCESS: the allowance exists, which is what the
  // caller asked about. Collapsing it into a failure is how a retry loop
  // starts.
  if (res?.ok || res?.reason === "already_granted") {
    allowanceMemo.set(memoKey, true);
    return { ok: true, granted: Boolean(res?.ok), credits };
  }
  return { ok: false, reason: res?.reason || "grant_failed" };
}

/** Test seam — the memo is per container and otherwise invisible. */
export function resetAllowanceMemo() { allowanceMemo.clear(); }

/**
 * The balance a gate should decide against, with the allowance ensured first.
 * Returns the shape entitlementModel.creditGate() reads.
 */
export async function creditsContextFor(userId, planId, env = process.env) {
  if (!userId) return { enforced: false, guest: true, available: 0 };
  await ensureAllowance(userId, planId, env);
  const status = await available(userId, env);
  if (status.degraded) return { enforced: false, degraded: true, available: null, reason: status.reason };
  return { enforced: status.enforced, available: status.available };
}
