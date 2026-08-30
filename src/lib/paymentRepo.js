// paymentRepo.js — Layer 3: Supabase persistence for subscriptions + payment events.
// Silently degrades to no-op when Supabase is not configured.
import { supabase } from "./supabaseClient.js";
import { getSessionId } from "./usageRepo.js";
import { getAuthUserId } from "./billingRepo.js";

// ── Subscription ─────────────────────────────────────────────────────────────
export async function syncSubscriptionToDb(planId, provider, providerData = {}) {
  if (!supabase) return;
  try {
    // Dual-write phase (see the ordering note in 0012_billing_identity.sql):
    // every NEW row carries user_id from the moment it is created, so the 0013
    // backfill only ever has historical rows left to fix. Null for a logged-out
    // purchase — that row is claimed later when the buyer signs in.
    const userId = await getAuthUserId();
    const { error } = await supabase.from("subscriptions").upsert(
      {
        session_id:                getSessionId(),
        user_id:                   userId,
        plan_id:                   planId,
        status:                    "active",
        provider:                  provider || null,
        // For Razorpay one-time Orders there's no subscription id — persist the
        // order id here so razorpay_order_id is durably stored even if the webhook
        // never arrives (guide §1.4 "store these fields").
        provider_subscription_id:  providerData.subscriptionId  || providerData.orderId || null,
        provider_customer_id:      providerData.customerId       || null,
        current_period_start:      providerData.periodStart      || new Date().toISOString(),
        current_period_end:        providerData.periodEnd        || null,
        updated_at:                new Date().toISOString(),
      },
      { onConflict: "session_id" }
    );
    if (error) console.warn("[paymentRepo] subscriptions upsert:", error.message);
  } catch {}
}

export async function fetchSubscriptionFromDb() {
  if (!supabase) return null;
  try {
    const userId = await getAuthUserId();
    if (userId) {
      const { data, error } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!error && data) return data;
    }
    const { data, error } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("session_id", getSessionId())
      .maybeSingle();
    if (error) return null;
    return data;
  } catch { return null; }
}

// ── Payment events (audit log / history) ─────────────────────────────────────
export async function logPaymentEvent({ type, provider, providerId, planId, amountCents, currency, status = "completed" }) {
  if (!supabase) return;
  try {
    const userId = await getAuthUserId();
    await supabase.from("payment_events").insert({
      session_id:        getSessionId(),
      user_id:           userId,
      event_type:        type,
      provider:          provider,
      provider_event_id: providerId  || null,
      plan_id:           planId       || null,
      amount_cents:      amountCents  || null,
      currency:          currency     || null,
      status,
    });
  } catch {}
}

export async function fetchPaymentHistory(limit = 10) {
  if (!supabase) return [];
  try {
    const userId = await getAuthUserId();
    let query = supabase.from("payment_events").select("*");
    if (userId) {
      query = query.eq("user_id", userId);
    } else {
      query = query.eq("session_id", getSessionId());
    }
    const { data, error } = await query
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return [];
    return data ?? [];
  } catch { return []; }
}
