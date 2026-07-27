// webhook.js — optional fire-and-forget POST of a saved extraction.
//
// Resolves the URL in this order at call time:
//   1. Per-user URL set in localStorage (src/lib/userWebhook.js)
//   2. Platform VITE_WEBHOOK_URL (src/lib/config.js) — the
//      operator-set default for a single-tenant automation
//   3. Nothing → no-op (the feature is opt-in)
//
// Failures are logged, never thrown, so a bad webhook can't block a
// save. The `keepalive: true` option lets the browser continue the
// request in the background after the page unloads (e.g. user closes
// the tab right after clicking "Save").

import { hasWebhook, WEBHOOK_URL } from "./config.js";
import { getUserWebhookUrl } from "./userWebhook.js";

// Internal: pick the URL the user (or platform) wants this event to
// go to. The user URL wins because each DatIQ user can have their own
// automation target (their own Zapier / n8n / Make). When unset, fall
// back to the platform URL. Returns null if neither is set.
function resolveWebhookUrl() {
  const userUrl = getUserWebhookUrl();
  if (userUrl) return userUrl;
  return hasWebhook ? WEBHOOK_URL : null;
}

export async function notifyWebhook(extraction) {
  const url = resolveWebhookUrl();
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "extraction.saved",
        sent_at: new Date().toISOString(),
        source: "datiq",
        data: extraction,
      }),
      // Don't keep the page waiting on the webhook response.
      keepalive: true,
    });
  } catch (err) {
    console.warn("[DatIQ] Webhook delivery failed:", err);
  }
}

// Exported for the WebhookSetupModal "send test event" button and for
// the /integrations status pill. Returns the URL we'll actually use
// (preference: user-set, then platform), or null if the feature is off.
export function getEffectiveWebhookUrl() {
  return resolveWebhookUrl();
}

// Re-export for the test suite + UI.
export { resolveWebhookUrl };
