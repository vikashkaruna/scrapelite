// billingRepo.js — Supabase I/O for billing identity + entitlements.
//
// Companion to paymentRepo.js (which owns subscriptions + payment_events).
// This module owns the two things that make billing user-scoped rather than
// browser-scoped: claiming a localStorage session for a signed-in user, and
// reading that user's resolved entitlement row.
//
// Degrades to a no-op whenever Supabase is unconfigured, exactly like the rest
// of the repo layer — a missing backend must never break the UI.
import { supabase } from "./supabaseClient.js";
import { getSessionId } from "./usageRepo.js";

/** Current auth user id, or null. Never throws. */
export async function getAuthUserId() {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) return null;
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Link this browser's billing session to the signed-in user and backfill
 * user_id onto their historical subscription / payment / usage rows.
 *
 * Calls the claim_billing_session RPC (0012_billing_identity.sql), which is
 * SECURITY DEFINER and reads auth.uid() internally — so a caller cannot claim
 * on behalf of anyone else, and it refuses outright if the session is already
 * linked to a different user. That refusal is the anti-theft check: a guessed
 * or shared session id must not transfer a paid plan.
 *
 * Safe to call on every sign-in; it is idempotent.
 *
 * @returns {Promise<{claimed: boolean, reason?: string}>}
 */
export async function claimBillingSession(sessionId = getSessionId()) {
  if (!supabase || !sessionId) return { claimed: false, reason: "unavailable" };
  try {
    const { data, error } = await supabase.rpc("claim_billing_session", {
      p_session_id: sessionId,
    });
    if (error) {
      // Most likely the migration has not been applied yet. Not fatal — the
      // app works exactly as it did before, just without the link.
      console.warn("[billingRepo] claim_billing_session:", error.message);
      return { claimed: false, reason: "rpc_error" };
    }
    return data ?? { claimed: false, reason: "no_result" };
  } catch (err) {
    console.warn("[billingRepo] claim_billing_session threw:", err?.message);
    return { claimed: false, reason: "exception" };
  }
}

/**
 * List the signed-in user's invoices, newest first.
 *
 * Scoped by RLS (`invoices select own`) AND by an explicit user_id filter —
 * the same defence-in-depth extractions.js uses. Returns [] for a signed-out
 * user rather than throwing, so the Account page degrades to an empty state.
 */
export async function fetchInvoices(limit = 50) {
  if (!supabase) return [];
  try {
    const userId = await getAuthUserId();
    if (!userId) return [];
    const { data, error } = await supabase
      .from("invoices")
      .select("*")
      .eq("user_id", userId)
      .order("issued_at", { ascending: false })
      .limit(limit);
    if (error) return [];
    return data ?? [];
  } catch {
    return [];
  }
}

/** Line items for one invoice, ordered for display. */
export async function fetchInvoiceLines(invoiceId) {
  if (!supabase || !invoiceId) return [];
  try {
    const { data, error } = await supabase
      .from("invoice_lines")
      .select("*")
      .eq("invoice_id", invoiceId)
      .order("line_no", { ascending: true });
    if (error) return [];
    return data ?? [];
  } catch {
    return [];
  }
}

/**
 * Read the signed-in user's entitlement row.
 *
 * Uses the user's own JWT under the `entitlements select own` RLS policy — no
 * server function needed for a read. Returns null for a signed-out user, and
 * for a signed-in user who simply has no row yet (a legitimate free user).
 */
export async function fetchEntitlement() {
  if (!supabase) return null;
  try {
    const userId = await getAuthUserId();
    if (!userId) return null;
    const { data, error } = await supabase
      .from("entitlements")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return null;
    return data ?? null;
  } catch {
    return null;
  }
}

import { getAdminGrantForUser, redeemLocalAdminGrant } from "./adminService.js";

/**
 * Read the newest admin-issued grant for the signed-in user. The endpoint is
 * user-scoped server-side; the browser never queries the assignment table.
 */
export async function fetchAdminGrantCoupon() {
  let userId = null;
  let email = null;
  if (supabase) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      userId = session?.user?.id || null;
      email = session?.user?.email || null;
      if (session?.access_token) {
        const res = await fetch("/api/redeem-admin-coupon", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          if (data?.grant) return data.grant;
        }
      }
    } catch {
      /* ignore */
    }
  }
  const local = getAdminGrantForUser(userId, email);
  if (local) {
    return {
      id: local.id,
      code: local.code,
      planId: local.planId,
      validityMonths: local.validityMonths,
      claimExpiresAt: local.claimExpiresAt,
      status: local.status,
      assignedAt: local.assignedAt,
      redeemedAt: local.redeemedAt,
      periodStart: local.periodStart,
      periodEnd: local.periodEnd,
    };
  }
  return null;
}

/** Redeem a grant coupon for the currently signed-in user. */
export async function redeemAdminGrantCoupon(code) {
  let session = null;
  if (supabase) {
    try {
      const { data } = await supabase.auth.getSession();
      session = data?.session;
    } catch {
      /* ignore */
    }
  }

  if (session?.access_token) {
    try {
      const res = await fetch("/api/redeem-admin-coupon", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok) return data;
      if (res.status !== 503 && res.status !== 404) {
        throw new Error(data.error || "Could not redeem this plan grant.");
      }
    } catch (err) {
      if (err.message && !err.message.includes("503") && !err.message.includes("404") && !err.message.includes("Failed to fetch")) {
        throw err;
      }
    }
  }

  // Local / testing fallback
  const localRes = redeemLocalAdminGrant(session?.user?.id || session?.user?.email, code);
  if (localRes.ok) return localRes;
  throw new Error(localRes.error || "Could not redeem this plan grant.");
}
