// netlify/functions/lib/paymentLedger.js — the ONE service-key writer for the
// two browser-independent payment side effects that RLS deliberately blocks
// from clients (0014_billing_rls): the `subscriptions` row (the claim path
// merges it into entitlements at sign-in) and the `payment_events` history
// row. Extracted from payment-webhook.js so verify-payment.js can write the
// SAME rows with the SAME idempotency — the webhook and the browser verify
// race each other on every paid checkout, and two implementations of
// "record this payment once" is how an event ended up doubled or missing.

/**
 * @param {object} [env] env-like override (tests); defaults to process.env.
 * @returns {null | {
 *   upsertSubscription: (data) => Promise<Response>,
 *   patchSubscription: (sessionId, patch) => Promise<Response>,
 *   insertPaymentEvent: (data) => Promise<Response>,
 * }}
 */
export function buildPaymentLedger(env = process.env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;

  const base = {
    apikey:         key,
    Authorization:  `Bearer ${key}`,
    "Content-Type": "application/json",
  };

  async function req(path, method, body, extra = {}) {
    const res = await fetch(`${url}/rest/v1${path}`, {
      method,
      headers: { ...base, ...extra },
      ...(body != null ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok && res.status !== 404 && res.status !== 409) {
      const text = await res.text().catch(() => "");
      throw new Error(`Supabase ${method} ${path} → HTTP ${res.status}: ${text}`);
    }
    return res;
  }

  return {
    upsertSubscription: (data) =>
      req("/subscriptions", "POST", data, { Prefer: "resolution=merge-duplicates,return=minimal" }),

    patchSubscription: (sessionId, patch) =>
      req(`/subscriptions?session_id=eq.${encodeURIComponent(sessionId)}`, "PATCH", patch),

    // Idempotent: skip if an event with the same provider_event_id already exists.
    // Prevents double-logging when both the client handler and the webhook fire.
    insertPaymentEvent: async (data) => {
      if (data.provider_event_id) {
        const check = await req(
          `/payment_events?provider_event_id=eq.${encodeURIComponent(data.provider_event_id)}&select=id&limit=1`,
          "GET"
        );
        const rows = await check.json().catch(() => []);
        if (Array.isArray(rows) && rows.length > 0) return check; // already recorded
      }
      return req("/payment_events", "POST", data, { Prefer: "return=minimal" });
    },
  };
}
