// netlify/functions/lib/slackFormatter.js — F17 (Slack-formatted change alerts).
//
// Council intent: "Scheduled Monitoring + Change Detection Alerts (email/Slack)"
// — the existing scheduled-runner.js already posts a generic JSON payload
// to SCHEDULE_ALERT_WEBHOOK. This module adds a Slack-specific path that
// formats the same event as a Slack Block Kit message and POSTs to a
// separate SLACK_WEBHOOK_URL when configured.
//
// The two paths are independent:
//   • SCHEDULE_ALERT_WEBHOOK  → JSON, for n8n / Zapier / Make (existing)
//   • SLACK_WEBHOOK_URL       → Slack Block Kit (new, this module)
//
// Operators can use either or both. No secrets are stored in the codebase.

const MAX_TARGETS = 8; // keep the message scannable

// ── Pure helpers (unit-testable) ─────────────────────────────────────────────

/**
 * Strip tracking junk from a URL for display.
 */
function cleanUrlForDisplay(u) {
  try {
    const url = new URL(u);
    const drop = new Set(["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "gclid"]);
    for (const k of Array.from(url.searchParams.keys())) {
      if (drop.has(k.toLowerCase())) url.searchParams.delete(k);
    }
    return url.toString();
  } catch { return u; }
}

/**
 * Build a Slack Block Kit payload for a single schedule.changed event.
 * Pure — no fetch. Callers POST the result to their Slack incoming webhook.
 */
export function buildSlackChangeAlert(schedule, changedSummary = {}, detectedAt = new Date().toISOString()) {
  const label = schedule?.label || "Untitled schedule";
  const intent = schedule?.intent || "summary";
  const isBatch = schedule?.type === "batch";
  const targets = Array.isArray(schedule?.target)
    ? schedule.target.slice(0, MAX_TARGETS)
    : [schedule?.target].filter(Boolean);

  const headerSub = isBatch ? "Batch monitor detected a change" : "Tracked page changed";
  const targetsList = targets
    .map((t) => `• \`<${cleanUrlForDisplay(t)}|${t}>\``)
    .join("\n") || "_no target_";

  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: `🔔 ${headerSub}`, emoji: true },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Schedule:*\n${label}` },
        { type: "mrkdwn", text: `*Intent:*\n${intent}` },
        { type: "mrkdwn", text: `*Detected:*\n<!date^${Math.floor(new Date(detectedAt).getTime() / 1000)}^{date_pretty} at {time}|${new Date(detectedAt).toISOString()}>` },
        { type: "mrkdwn", text: `*Type:*\n${isBatch ? `Batch (${Array.isArray(schedule?.target) ? schedule.target.length : 0} URL${(Array.isArray(schedule?.target) ? schedule.target.length : 0) !== 1 ? "s" : ""})` : "Single URL"}` },
      ],
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Targets*\n${targetsList}` },
    },
  ];

  if (changedSummary?.previousHash && changedSummary?.newHash) {
    blocks.push({
      type: "context",
      elements: [
        { type: "mrkdwn", text: `Content fingerprint changed: \`${changedSummary.previousHash}\` → \`${changedSummary.newHash}\`` },
      ],
    });
  }

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "View in DatIQ →" },
        url: process.env.URL || process.env.SITE_URL || "https://datiq.app",
        style: "primary",
      },
    ],
  });

  return {
    text: `DatIQ: ${label} changed`, // fallback for clients that don't render blocks
    blocks,
  };
}

/**
 * Build a Slack Block Kit payload for the weekly schedule-ran summary
 * (F49 — schedule-ran trigger). One card per detected change; trimmed
 * to the top 5 so the message stays below Slack's 50-block cap.
 */
export function buildSlackWeeklyRunSummary({ userName, weekOf, changes }) {
  const greeting = userName ? `Hi ${userName}` : "Hi";
  const top = (changes || []).slice(0, 5);
  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: `📊 DatIQ weekly summary — week of ${weekOf}`, emoji: true },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `${greeting} — your DatIQ schedules ran this week. ${top.length === 0 ? "No content changes detected." : `${top.length} change${top.length !== 1 ? "s" : ""} detected:`}` },
    },
  ];
  for (const c of top) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${c.label || c.scheduleId}* — ${c.target ? `<${cleanUrlForDisplay(c.target)}|${c.target}>` : "_(batch)_"}\nDetected <!date^${Math.floor(new Date(c.detectedAt).getTime() / 1000)}^{date_short_pretty} at {time}|${new Date(c.detectedAt).toISOString()}>`,
      },
    });
  }
  if (top.length > 0) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Open DatIQ →" },
          url: process.env.URL || process.env.SITE_URL || "https://datiq.app",
          style: "primary",
        },
      ],
    });
  }
  return { text: `DatIQ weekly summary — ${top.length} change(s)`, blocks };
}

/**
 * Format a Slack welcome message (F49 — welcome trigger).
 */
export function buildSlackWelcomeMessage({ userName, planLabel = "Free" }) {
  const greeting = userName ? `Welcome, ${userName}!` : "Welcome to DatIQ!";
  return {
    text: greeting,
    blocks: [
      { type: "header", text: { type: "plain_text", text: `👋 ${greeting}`, emoji: true } },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `You're on the *${planLabel}* plan. Try a single URL, a multi-URL batch, or set up a schedule to monitor a page.`,
        },
      },
      {
        type: "actions",
        elements: [
          { type: "button", text: { type: "plain_text", text: "Extract a page" }, url: `${process.env.URL || "https://datiq.app"}/`, style: "primary" },
          { type: "button", text: { type: "plain_text", text: "Set up a schedule" }, url: `${process.env.URL || "https://datiq.app"}/schedules` },
        ],
      },
    ],
  };
}

// ── Side-effecting: post to Slack ────────────────────────────────────────────

/**
 * POST a Block Kit payload to the configured Slack incoming webhook.
 * Returns { ok, status, error? }.
 *
 * On non-2xx responses Slack returns a JSON body shaped like
 *   { "ok": false, "error": "invalid_blocks", "response_metadata": { "messages": ["…"] } }
 * We read that body so the caller (and the dashboard's failedRecords)
 * gets a useful diagnostic string instead of just `slack_400`. The old
 * code threw the body away, which is why "https://www.india.com: slack_400"
 * was the only signal the user got when a long news-site title blew past
 * Slack's 150-char header limit.
 */
export async function postToSlack(payload, { webhookUrl, fetchFn } = {}) {
  const url = webhookUrl || process.env.SLACK_WEBHOOK_URL;
  if (!url) return { ok: false, error: "SLACK_WEBHOOK_URL not configured" };
  const f = fetchFn || (typeof fetch !== "undefined" ? fetch : null);
  if (!f) return { ok: false, error: "No fetch available (SSR?)" };
  try {
    const res = await f(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) return { ok: true, status: res.status };
    let detail = "";
    try {
      const text = await res.text();
      if (text) {
        try {
          const parsed = JSON.parse(text);
          // Slack's body is the most useful thing we can show — error
          // codes like `invalid_blocks`, `no_text`, `channel_not_found`.
          // response_metadata.messages often has the specific offending
          // field/character.
          detail =
            parsed?.error ||
            (Array.isArray(parsed?.response_metadata?.messages) && parsed.response_metadata.messages[0]) ||
            text.slice(0, 200);
        } catch {
          detail = text.slice(0, 200);
        }
      }
    } catch { /* body-read errored — fall through with detail="" */ }
    return {
      ok: false,
      status: res.status,
      // Prefix with `slack_` so the UI's existing `slack_<code>` pattern
      // still matches when there's no body to extract (network 5xx, etc).
      error: detail ? `${detail} (slack_${res.status})` : `slack_${res.status}`,
    };
  } catch (err) {
    return { ok: false, error: err?.message || "network error" };
  }
}

export const _internal = { MAX_TARGETS, cleanUrlForDisplay };
