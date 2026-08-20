// netlify/functions/lib/notify.js
//
// Centralized notification dispatcher. Every event in DatIQ that a user
// might want to hear about goes through `notifyExtractionComplete`,
// `notifyEnrichmentComplete`, or `notifyMonitoringChange`.
//
// Each notification fans out to every active channel the user has
// configured: Slack (Block Kit to a webhook URL) and Zapier events (via
// zapierEventStore). All paths are best-effort; a failure in one does
// NOT block the others. Email is sent separately by the change-alert
// caller (scheduled-runner) because it has its own entitlement check
// (Resend rate limits, plan gating) that doesn't apply to other events.
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
import { emitNewExtraction, emitNewEnrichment, emitMonitoringAlert } from "./zapierEmitter.js";

// ── Channel resolution ─────────────────────────────────────────────────────

/**
 * Look up the user's Slack channel.
 *
 * Priority (highest first):
 *   1. `overrideUrl` argument — used by /api/integrations/slack/test so a
 *      user can probe a candidate webhook before saving it.
 *   2. Per-user connection from `integration_connections` (config.webhook_url).
 *      A user who explicitly connected Slack via the Account UI gets their
 *      own channel — this is the v1 user-facing path.
 *   3. Global env `SLACK_WEBHOOK_URL` — operator fallback for self-hosted
 *      installs and for users who haven't connected their own channel.
 *
 * Per-user must beat the env: if a user spent the time to connect their
 * own channel, we should NOT route their alerts to the operator's channel.
 * The env exists for users who haven't connected; the moment a per-user
 * webhook is stored, it takes over.
 */
export async function resolveSlackWebhook({ userId, overrideUrl } = {}) {
  if (overrideUrl) return overrideUrl;
  if (userId) {
    try {
      const r = await getConnection({ userId, provider: "slack", includeSecrets: true });
      if (r && r.ok && r.connection && r.connection.config && r.connection.config.webhook_url) {
        return r.connection.config.webhook_url;
      }
    } catch { /* fall through to env / null */ }
  }
  if (process.env.SLACK_WEBHOOK_URL) return process.env.SLACK_WEBHOOK_URL;
  return null;
}

// ── Slack Block Kit builders for new extractions ───────────────────────────

// Slack Block Kit hard limits — referenced so the truncations and the
// assertions on them stay in sync.
const SLACK_HEADER_MAX = 150;        // header.text (plain_text) per Slack docs
const SLACK_SECTION_MAX = 3000;      // section.text / fields[].text
const SLACK_FALLBACK_MAX = 3000;     // the top-level "text" field
const HEADER_PREFIX = "✅ New extraction: ";
// Reserve enough headroom for the prefix + Slack's emoji-as-multi-char
// quirk. 120 chars × visible title is comfortably under 150 once the
// 19-char prefix is added.
const HEADER_TITLE_MAX = 120;
const SUMMARY_MAX = 1500;

/**
 * Strip control chars that break both JSON and Slack's Block Kit parser
 * (Slack 400s with `invalid_blocks` on \u0000–\u001F except \t\n). Also
 * collapse internal whitespace so a page title with literal newlines or
 * runs of spaces doesn't surprise the renderer.
 */
function sanitizeForSlack(s) {
  if (s == null) return "";
  return String(s)
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Cap a title to fit inside Slack's 150-char header block alongside the
 * `✅ New extraction: ` prefix. Truncate with an ellipsis so the user
 * sees something was cut rather than a silently-mangled string.
 */
function truncateForHeader(title) {
  if (title.length <= HEADER_TITLE_MAX) return title;
  return `${title.slice(0, HEADER_TITLE_MAX - 1).trimEnd()}…`;
}

/**
 * Slack mrkdwn link format is `<url|display>`. If the URL itself contains
 * `>` or `<` the link closes early and Slack rejects the block. The URLs
 * we store are normally clean, but the `&` and query-string `>` from
 * redirect trackers have shown up in the past — defense in depth.
 */
function safeUrlForMrkdwn(u) {
  if (!u) return "";
  return String(u).replace(/[<>]/g, (ch) => (ch === "<" ? "%3C" : "%3E"));
}

export function buildSlackNewExtraction(extraction) {
  if (!extraction) return null;
  const rawTitle = extraction.page_title || extraction.title || "";
  const cleanTitle = sanitizeForSlack(rawTitle) || "Untitled";
  const headerTitle = truncateForHeader(cleanTitle);
  const url = sanitizeForSlack(extraction.url) || "(no url)";
  const summary = sanitizeForSlack(extraction.ai_summary || extraction.summary || "");
  const host = sanitizeForSlack(hostOf(url));
  return {
    text: `DatIQ: new extraction — ${cleanTitle}`.slice(0, SLACK_FALLBACK_MAX),
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: `${HEADER_PREFIX}${headerTitle}`, emoji: true },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*URL:*\n<${safeUrlForMrkdwn(url)}|${safeUrlForMrkdwn(url)}>`.slice(0, SLACK_SECTION_MAX) },
          { type: "mrkdwn", text: `*Host:*\n${host}`.slice(0, SLACK_SECTION_MAX) },
        ],
      },
      ...(summary ? [{
        type: "section",
        text: { type: "mrkdwn", text: `*Summary:*\n${summary.slice(0, SUMMARY_MAX)}`.slice(0, SLACK_SECTION_MAX) },
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

/**
 * Notify all configured channels that a tracked page (or batch) has
 * changed content. Called from scheduled-runner when a re-scrape
 * fingerprint diverges from the stored one.
 *
 * The caller (scheduled-runner) is responsible for the email + n8n-style
 * webhook paths; this dispatcher only handles the user-facing channels
 * that respect per-user configuration: Slack (per-user webhook, with
 * global env fallback) and Zapier event (per-user poll).
 */
export async function notifyMonitoringChange({ userId, schedule, changedSummary }) {
  if (!schedule) return { ok: false, reason: "missing_schedule" };
  const result = { slack: null, zapier: null };

  // Slack — per-user webhook, with global env fallback. Uses
  // buildSlackChangeAlert from slackFormatter (Block Kit, no auth).
  try {
    const webhookUrl = await resolveSlackWebhook({ userId });
    if (webhookUrl) {
      const payload = buildSlackChangeAlert(schedule, changedSummary);
      const r = await postToSlack(payload, { webhookUrl });
      result.slack = { ok: r.ok, status: r.status, error: r.error };
    }
  } catch (err) {
    result.slack = { ok: false, error: err?.message || "unknown" };
  }

  // Zapier — append a 'monitoring_alert' event to zapier_events so
  // the user's poller picks it up on the next cycle.
  try {
    await emitMonitoringAlert({ userId, schedule, changedSummary });
    result.zapier = { ok: true };
  } catch (err) {
    result.zapier = { ok: false, error: err?.message || "unknown" };
  }

  return { ok: true, ...result };
}

export const _internal = { buildSlackNewExtraction, hostOf };
