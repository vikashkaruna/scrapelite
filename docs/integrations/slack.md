# Slack Integration

> Get Slack notifications when a tracked URL changes **or** when a new
> extraction completes. v1 honours a global `SLACK_WEBHOOK_URL` env
> var; v1.1 adds per-user webhooks.

## What's wired up

DatIQ posts to Slack in two scenarios:

| Event | Source | When it fires |
|---|---|---|
| **Tracked URL changed** | `scheduled-runner.js` (cron) | Every hourly run, when the content fingerprint differs from the previous one. |
| **New extraction saved** | `notify.js` (called by `api-v1.js` POST `/extractions`) | After a successful extraction. |

Both use Slack's [Block Kit](https://api.slack.com/block-kit) format
for rich formatting.

## Set up

### 1. Create an incoming webhook

1. In Slack, go to **Apps → Manage apps → Custom Integrations → Incoming
   Webhooks** (or use a Slack app you control).
2. Click **Add New Webhook to Workspace**, pick the channel, copy the
   webhook URL.
3. The URL looks like `https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX`.

### 2. Configure DatIQ

**Operator (recommended for self-hosted):**

```bash
# .env or Netlify env
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
```

**Per-user (via the Account UI, v1.1):**

1. **Account → Integrations → Slack**.
2. Paste the webhook URL. DatIQ posts a test message to confirm it
   works.
3. From now on, all change alerts + new-extraction events for that
   user go to that channel.

## What the messages look like

**Tracked URL change:**

```
🔔 Tracked page changed
─────────────────────
Schedule:   Stripe pricing
Intent:     summary
Detected:   Jul 28, 2026 at 10:00
Type:       Single URL

Targets
• <https://stripe.com/pricing|stripe.com/pricing>

Content fingerprint changed: `a1b2c3` → `d4e5f6`

[View in DatIQ →]
```

**New extraction:**

```
✅ New extraction: Acme — Product analytics
─────────────────────────────────────────
URL:   <https://acme.com|acme.com>
Host:  acme.com

Summary:
Acme is a product-analytics platform aimed at fast-moving teams…

[View in DatIQ →]
```

## API

```
# Internal (Supabase JWT required)
GET    /api/integrations/slack/status
POST   /api/integrations/slack/connect       { webhookUrl }
DELETE /api/integrations/slack/connect
POST   /api/integrations/slack/test
POST   /api/integrations/slack/notify        { type: "new_extraction"|"new_enrichment", payload }
```

The `notify` endpoint exists so other parts of the codebase (e.g. a
future "send to Slack" button on the Preview page) can fire a
notification without re-implementing the channel-resolution logic.

## Operator notes

- Slack's webhook URLs are *secrets*; treat them like API keys. They
  can be revoked from the Slack side at any time.
- The webhook URL is stored in `integration_connections.config`
  (plaintext) for v1. v1.1 will wrap it in a pgcrypto envelope.
- Block Kit messages are validated client-side by the formatter
  helpers in `netlify/functions/lib/slackFormatter.js`. The test
  suite at `netlify/__tests__/lib/slackFormatter.test.js` covers the
  shape.
