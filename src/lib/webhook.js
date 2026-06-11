// webhook.js — optional fire-and-forget POST of a saved extraction.
// Enabled by VITE_WEBHOOK_URL. Failures are logged, never thrown, so a bad
// webhook can't block a save.

import { hasWebhook, WEBHOOK_URL } from "./config.js";

export async function notifyWebhook(extraction) {
  if (!hasWebhook) return;
  try {
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "extraction.saved",
        sent_at: new Date().toISOString(),
        data: extraction,
      }),
      // Don't keep the page waiting on the webhook response.
      keepalive: true,
    });
  } catch (err) {
    console.warn("[DatIQ] Webhook delivery failed:", err);
  }
}
