// paymentRepo.js — Layer 3: Supabase persistence for subscriptions + payment events.
// Silently degrades to no-op when Supabase is not configured.
import { supabase } from "./supabaseClient.js";
import { getSessionId } from "./usageRepo.js";

// ── Subscription ─────────────────────────────────────────────────────────────
export async function syncSubscriptionToDb(planId, provider, providerData = {}) {
  if (!supabase) return;
  try {
    const { error } = await supabase.from("subscriptions").upsert(
      {
        session_id:                getSessionId(),
        plan_id:                   planId,
        status:                    "active",
        provider:                  provider || null,
        provider_subscription_id:  providerData.subscriptionId  || null,
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
    const { data, error } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("session_id", getSessionId())
      .single();
    if (error) return null;
    return data;
  } catch { return null; }
}

// ── Payment events (audit log / history) ─────────────────────────────────────
export async function logPaymentEvent({ type, provider, providerId, planId, amountCents, currency, status = "completed" }) {
  if (!supabase) return;
  try {
    await supabase.from("payment_events").insert({
      session_id:        getSessionId(),
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
    const { data, error } = await supabase
      .from("payment_events")
      .select("*")
      .eq("session_id", getSessionId())
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return [];
    return data ?? [];
  } catch { return []; }
}
