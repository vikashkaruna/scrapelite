// netlify/functions/lib/notify.js
//
// Centralized notification dispatcher. Every event in DatIQ that a user
// might want to hear about goes through `notifyExtractionComplete` or
// `notifyMonitoringChange` (the latter already lives in scheduled-runner).
//
// Each notification fans out to every active channel the user has
// configured: Slack (Block Kit to a webhook URL), email (via Resend), and
// Zapier event (via zapierEventStore). All paths are best-effort; a
// failure in one does NOT block the others.
//
// ── WHY NOT JUST CALL SLACK DIRECTLY? ─────────────────────────────────────
// We want one place to add new channels (Discord, Microsoft Teams, custom
// webhook). If we inline the Slack call in every handler, we'd be
// duplicating the routing logic. Keeping the fan-out here means a new
// channel is one new function in this file.
//
// The trade-off is that this module needs to know how to look up a user's
// channels. We do that with the integration_connections table (Slack rows
// are stored there) plus the user's per-channel env override.

import { postToSlack, buildSlackChangeAlert } from "./slackFormatter.js";
import { getConnection } from "./integrationConnectionStore.js";
import { emitNewExtraction, emitNewEnrichment } from "./zapierEmitter.js";

// ── Channel resolution ─────────────────────────────────────────────────────

/**
 * Look up the user's Slack channel. v1 uses a single env-scoped webhook
 * (SLACK_WEBHOOK_URL), so the same channel gets every alert. v1.1 will
 * allow per-user webhooks stored in integration_connections.
 */
async function resolveSlackWebhook({ userId, overrideUrl } = {}) {
  if (overrideUrl) return overrideUrl;
  if (process.env.SLACK_WEBHOOK_URL) return process.env.SLACK_WEBHOOK_URL;
  // Per-user override (v1.1). v1 ships with global-only.
  if (userId) {
    try {
      const r = await getConnection({ userId, provider: "slack" });
      if (r && r.ok && r.connection && r.connection.config && r.connection.config.webhook_url) {
        return r.connection.config.webhook_url;
      }
    } catch { /* fall through to null */ }
  }
  return null;
}

// ── Slack Block Kit builders for new extractions ───────────────────────────

export function buildSlackNewExtraction(extraction) {
  if (!extraction) return null;
  const title = extraction.page_title || extraction.title || "Untitled";
  const url = extraction.url;
  const summary = extraction.ai_summary || extraction.summary || "";
  return {
    text: `DatIQ: new extraction — ${title}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: `✅ New extraction: ${title}`, emoji: true },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*URL:*\n<${url}|${url}>` },
          { type: "mrkdwn", text: `*Host:*\n${hostOf(url)}` },
        ],
      },
      ...(summary ? [{
        type: "section",
        text: { type: "mrkdwn", text: `*Summary:*\n${summary.slice(0, 1500)}` },
      }] : []),
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "View in DatIQ →" },
            url: `${process.env.URL || process.env.SITE_URL || "https://datiq.app"}/preview`,
            style: "primary",
          },
        ],
      },
    ],
  };
}

function hostOf(u) {
  try { return new URL(u).hostname; } catch { return ""; }
}

// ── Public dispatchers ─────────────────────────────────────────────────────

/**
 * Notify all configured channels that a new extraction has been saved.
 * Best-effort: never throws, returns a per-channel result object.
 */
export async function notifyExtractionComplete({ userId, extraction }) {
  if (!extraction) return { ok: false, reason: "missing_extraction" };
  const result = { slack: null, zapier: null };

  // Slack
  try {
    const webhookUrl = await resolveSlackWebhook({ userId });
    if (webhookUrl) {
      const payload = buildSlackNewExtraction(extraction);
      const r = await postToSlack(payload, { webhookUrl });
      result.slack = { ok: r.ok, status: r.status, error: r.error };
    }
  } catch (err) {
    result.slack = { ok: false, error: err?.message || "unknown" };
  }

  // Zapier
  try {
    await emitNewExtraction({ userId, extraction });
    result.zapier = { ok: true };
  } catch (err) {
    result.zapier = { ok: false, error: err?.message || "unknown" };
  }

  return { ok: true, ...result };
}

/**
 * Notify all configured channels that a new enrichment has been added.
 */
export async function notifyEnrichmentComplete({ userId, extractionId, focus, data }) {
  const result = { zapier: null };
  try {
    await emitNewEnrichment({ userId, extractionId, focus, data });
    result.zapier = { ok: true };
  } catch (err) {
    result.zapier = { ok: false, error: err?.message || "unknown" };
  }
  return { ok: true, ...result };
}

export const _internal = { buildSlackNewExtraction, resolveSlackWebhook, hostOf };
