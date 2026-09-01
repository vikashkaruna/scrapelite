#!/usr/bin/env node
//
// scripts/generate-n8n-workflows.mjs
//
// Generates every n8n/workflows/*.json from a compact spec. The JSON
// files in n8n/workflows/ are the source of truth that gets imported
// into n8n; this script is the editor for those files.
//
// v2 plan: docs/WORKFLOW-IMPLEMENTATION-PLAN.md §4.3, §11
//
// Run: node scripts/generate-n8n-workflows.mjs
//   (no args — generates everything; safe to re-run; idempotent)
//
// Why a generator: the 11 MCP tool + 6 automation workflows are
// ~80% identical (each is "trigger → http request → respond" or
// "trigger → http request → error branch → update DB"). Hand-writing
// 200+ lines of JSON for each is error-prone; a generator is ~30
// lines per spec and the JSON is always consistent.
//
// ── URL/HOST PLACEHOLDERS (replaces the previous {{SUPABASE_URL}} etc.) ──
// The generated workflow JSONs never contain raw host placeholders.
// Every URL/host that varies by environment is emitted as a n8n
// expression that reads from the per-event `_ctx` field (or from
// `$env` for n8n-instance config):
//
//   {{SUPABASE_URL}}   →  $json._ctx.supabase_url   (per DatIQ env, from Netlify)
//   {{SITE_URL}}       →  $json._ctx.site_url       (per DatIQ env, from Netlify)
//   {{WEBHOOK_URL}}    →  $env.N8N_BASE_URL         (this n8n's own URL)
//
// The orchestrator puts `_ctx` in the top level of the dispatch body
// (see netlify/functions/lib/workflowOrchestrator.js buildDispatchBody).
// A re-import of the same workflow JSONs therefore works unchanged
// across production, staging, and branch deploys — only the orchestrator
// env vars change.

import { writeFileSync, mkdirSync, readdirSync, unlinkSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const OUT_DIR = join(ROOT, "n8n", "workflows");

// ── URL expression helpers ─────────────────────────────────────────────
//
// n8n URL / header / jsonBody fields accept a JS expression when prefixed
// with `=`. We compose URLs as JS string concatenation so the host is
// read from the per-event `_ctx` and the path/query is literal.
//
// `sb(pathAndQuery)` returns an expression for a Supabase REST URL.
//   sb("/rest/v1/workflow_events?id=eq." + $json.event_id)
//   →  "={{ 'https://' + $json._ctx.supabase_url + '/rest/v1/workflow_events?id=eq.' + $json.event_id }}"
//
// `api(pathAndQuery)` returns an expression for a DatIQ API URL.
//   api("/api/workflow-orchestrator/dispatch")
//   →  "={{ 'https://' + $json._ctx.site_url + '/api/workflow-orchestrator/dispatch' }}"
//
// `n8nWebhook(pathAndQuery)` returns an expression for an internal n8n
// webhook URL (read from $env because the webhook is INSIDE this n8n
// instance, not a DatIQ env thing).
function jsExpr(literal) {
  // Wrap a literal string in single quotes. Doubled-up single quotes
  // are not currently used by the inputs, so this stays simple.
  return `'${literal.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}
function sb(exprStr) {
  return `={{ ${jsExpr("https://")} + $json._ctx.supabase_url + (${exprStr}) }}`;
}
function api(exprStr) {
  return `={{ ${jsExpr("https://")} + $json._ctx.site_url + (${exprStr}) }}`;
}
function n8nWebhook(exprStr) {
  return `={{ $env.N8N_BASE_URL + (${exprStr}) }}`;
}

function callbackNode({ eventPath = "$json.event?.id || $json.id" } = {}) {
  return {
    name: "Callback DatIQ",
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    parameters: {
      method: "POST",
      url: "={{ $json._ctx?.callback_url || ($json._ctx?.site_url ? 'https://' + $json._ctx.site_url + '/api/workflow-callback' : $env.SITE_URL + '/api/workflow-callback') }}",
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: "Content-Type", value: "application/json" },
          { name: "Authorization", value: "=Bearer {{ $env.DATIQ_N8N_API_KEY || $env.N8N_WEBHOOK_SECRET }}" },
        ],
      },
      sendBody: true,
      specifyBody: "json",
      jsonBody:
        `={\\n` +
        `  "event_id": "{{ ${eventPath} }}",\\n` +
        `  "state": "done",\\n` +
        `  "output": { "completed_at": "{{ $now.toISO() }}" }\\n` +
        `}`,
      options: { continueOnFail: true },
    },
  };
}

const UUIDS = {};

function uid(seed) {
  // Deterministic UUID per seed for stable diffs.
  if (UUIDS[seed]) return UUIDS[seed];
  const h = seed.split("").reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0);
  const hex = (Math.abs(h) * 0x12345678).toString(16).padStart(32, "0").slice(0, 32);
  const u = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  UUIDS[seed] = u;
  return u;
}

// ── Spec builder ────────────────────────────────────────────────────────
// Each spec is a small object describing the workflow's intent.
// The generator fills in the boilerplate (IDs, positions, connections).

function mcpToolSpec({ name, description, inputSchema, action }) {
  return {
    name,
    nodes: [
      {
        name: "MCP Trigger",
        type: "@n8n/n8n-nodes-langchain.mcpTrigger",
        typeVersion: 1,
        parameters: {
          toolName: name,
          toolDescription: description,
          toolInputSchema: inputSchema,
        },
        position: [240, 300],
      },
      {
        name: action.nodeName || "Action",
        type: "n8n-nodes-base.httpRequest",
        typeVersion: 4.2,
        parameters: action.parameters,
        position: [500, 300],
      },
      {
        name: "Respond",
        type: "n8n-nodes-base.respondToWebhook",
        typeVersion: 1,
        parameters: {
          respondWith: "json",
          responseBody: "={{ JSON.stringify($json) }}",
        },
        position: [760, 300],
      },
    ],
    connections: {
      "MCP Trigger": { main: [[{ node: action.nodeName || "Action", type: "main", index: 0 }]] },
      [action.nodeName || "Action"]: { main: [[{ node: "Respond", type: "main", index: 0 }]] },
    },
  };
}

function webhookFlowSpec({ name, description, action, errorBranch }) {
  return {
    name,
    nodes: [
      {
        name: "Webhook",
        type: "n8n-nodes-base.webhook",
        typeVersion: 1,
        parameters: {
          httpMethod: "POST",
          path: `datiq/${name.replace(/^datiq_/, "").replace(/_/g, "-")}`,
          responseMode: "responseNode",
          authentication: "headerAuth",
          options: {},
        },
        position: [240, 300],
      },
      ...action.nodes.map((n, i) => ({ ...n, position: [500 + i * 240, 300] })),
      {
        name: "Respond OK",
        type: "n8n-nodes-base.respondToWebhook",
        typeVersion: 1,
        parameters: { respondWith: "json", responseBody: "={{ JSON.stringify({ ok: true }) }}" },
        position: [500 + action.nodes.length * 240, 300],
      },
    ],
    connections: {
      Webhook: { main: [[{ node: action.nodes[0].name, type: "main", index: 0 }]] },
      ...Object.fromEntries(
        action.nodes.slice(0, -1).map((n, i) => [
          n.name,
          { main: [[{ node: action.nodes[i + 1].name, type: "main", index: 0 }]] },
        ])
      ),
      [action.nodes[action.nodes.length - 1].name]: {
        main: [[{ node: "Respond OK", type: "main", index: 0 }]],
      },
    },
  };
}

function toN8nJson(spec, extra = {}) {
  const wfId = uid(`wf-${spec.name}`);
  const isErrorHandler = spec.name === "datiq_global_error_handler";
  return {
    name: spec.name,
    nodes: spec.nodes.map((n) => ({
      parameters: n.parameters,
      type: n.type,
      typeVersion: n.typeVersion,
      position: n.position,
      id: uid(`${wfId}-${n.name}`),
      name: n.name,
      ...(n.credentials ? { credentials: n.credentials } : {}),
    })),
    connections: spec.connections,
    active: false,
    settings: {
      executionOrder: "v1",
      saveExecutionProgress: true,
      saveManualExecutions: true,
      ...(isErrorHandler ? {} : { errorWorkflow: uid("wf-datiq_global_error_handler") }),
      ...(extra.settings || {}),
    },
    versionId: uid(`ver-${spec.name}`),
    id: wfId,
    meta: {
      templateCredsSetupCompleted: false,
      ...(extra.meta || {}),
    },
  };
}

// ── The 11 MCP tool specs ───────────────────────────────────────────────

const MCP_TOOLS = [
  mcpToolSpec({
    name: "datiq_list_pending_workflows",
    description:
      "Lists workflow events in the DatIQ automation queue. Use this to answer " +
      "'what's pending?', 'what's failed?', 'what changed in the last hour?'. " +
      "Filter by `state` (pending/processing/done/failed/cancelled), `kind` " +
      "(schedule.changed/contact.received/payment.captured), or `user_id`. " +
      "Returns up to 50 events sorted by `next_attempt_at` ascending.",
    inputSchema: {
      type: "object",
      properties: {
        state: { type: "string", enum: ["pending", "processing", "done", "failed", "cancelled"] },
        kind: { type: "string" },
        user_id: { type: "string" },
        limit: { type: "number", default: 50, maximum: 200 },
      },
    },
    action: {
      nodeName: "List events",
      parameters: {
        method: "GET",
        url: sb(
          "'/rest/v1/workflow_events'" +
            "+ '?select=id,kind,ref_id,user_id,state,attempts,max_attempts,next_attempt_at,started_at,finished_at,last_error,created_at'" +
            "+ '&order=next_attempt_at.asc&limit=' + ($json.limit || 50)" +
            "+ ($json.state ? '&state=eq.' + $json.state : '')" +
            "+ ($json.kind ? '&kind=eq.' + $json.kind : '')" +
            "+ ($json.user_id ? '&user_id=eq.' + $json.user_id : '')"
        ),
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: "apikey", value: "={{ $credentials['datiq-supabase-service'].value }}" },
            { name: "Authorization", value: "=Bearer {{ $credentials['datiq-supabase-service'].value }}" },
          ],
        },
        options: {},
      },
    },
  }),

  mcpToolSpec({
    name: "datiq_get_workflow_event",
    description:
      "Returns a single workflow event by id, including the latest few " +
      "attempts (from workflow_runs). Use this to diagnose 'why did this fail?'.",
    inputSchema: {
      type: "object",
      properties: { event_id: { type: "string" } },
      required: ["event_id"],
    },
    action: {
      nodeName: "Get event",
      parameters: {
        method: "GET",
        url: sb("'/rest/v1/workflow_events?id=eq.' + $json.event_id + '&select=*'"),
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: "apikey", value: "={{ $credentials['datiq-supabase-service'].value }}" },
            { name: "Authorization", value: "=Bearer {{ $credentials['datiq-supabase-service'].value }}" },
          ],
        },
        options: {},
      },
    },
  }),

  mcpToolSpec({
    name: "datiq_process_pending_workflow",
    description:
      "Force-dispatch a single pending workflow event immediately (bypasses " +
      "the 5-min poll). Use this when the user just said 're-run that'.",
    inputSchema: {
      type: "object",
      properties: { event_id: { type: "string" } },
      required: ["event_id"],
    },
    action: {
      nodeName: "Force dispatch",
      parameters: {
        method: "POST",
        url: api("'/api/workflow-orchestrator/dispatch'"),
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: "Authorization", value: "=Bearer {{ $credentials['datiq-orchestrator'].value }}" },
            { name: "Content-Type", value: "application/json" },
          ],
        },
        sendBody: true,
        specifyBody: "json",
        jsonBody: '={ "event_id": "{{ $json.event_id }}" }',
        options: {},
      },
    },
  }),

  mcpToolSpec({
    name: "datiq_retry_workflow_event",
    description:
      "Reset a failed workflow event back to pending with attempts=0, so " +
      "the next orchestrator run picks it up. Use after fixing the underlying " +
      "issue (e.g., rotated a credential).",
    inputSchema: {
      type: "object",
      properties: {
        event_id: { type: "string" },
        reset_attempts: { type: "boolean", default: true },
      },
      required: ["event_id"],
    },
    action: {
      nodeName: "Reset attempts",
      parameters: {
        method: "PATCH",
        url: sb(
          "'/rest/v1/workflow_events?id=eq.' + $json.event_id" +
            "+ ($json.reset_attempts !== false ? '' : '&state=eq.failed')"
        ),
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: "apikey", value: "={{ $credentials['datiq-supabase-service'].value }}" },
            { name: "Authorization", value: "=Bearer {{ $credentials['datiq-supabase-service'].value }}" },
            { name: "Content-Type", value: "application/json" },
            { name: "Prefer", value: "return=representation" },
          ],
        },
        sendBody: true,
        specifyBody: "json",
        jsonBody:
          '={ "state": "pending", "attempts": 0, "next_attempt_at": "={{ $now.toISO() }}", "last_error": null, "finished_at": null, "started_at": null }',
        options: {},
      },
    },
  }),

  mcpToolSpec({
    name: "datiq_cancel_workflow_event",
    description:
      "Mark a workflow event as cancelled so the orchestrator won't retry " +
      "it. The event stays in the table for audit; it just won't run again.",
    inputSchema: {
      type: "object",
      properties: { event_id: { type: "string" }, reason: { type: "string" } },
      required: ["event_id"],
    },
    action: {
      nodeName: "Cancel",
      parameters: {
        method: "PATCH",
        url: sb("'/rest/v1/workflow_events?id=eq.' + $json.event_id"),
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: "apikey", value: "={{ $credentials['datiq-supabase-service'].value }}" },
            { name: "Authorization", value: "=Bearer {{ $credentials['datiq-supabase-service'].value }}" },
            { name: "Content-Type", value: "application/json" },
            { name: "Prefer", value: "return=representation" },
          ],
        },
        sendBody: true,
        specifyBody: "json",
        jsonBody:
          '={ "state": "cancelled", "finished_at": "={{ $now.toISO() }}", "last_error": "={{ $json.reason || \\"cancelled by operator\\" }}" }',
        options: {},
      },
    },
  }),
];

// ── The 6 schedule MCP tool specs (Phase 5) ────────────────────────────
// Defined here for completeness; the generator runs them all.

const SCHEDULE_MCP_TOOLS = [
  mcpToolSpec({
    name: "datiq_list_schedules",
    description:
      "Lists monitoring schedules. Filter by `user_id` to get one user's " +
      "schedules, or omit to list all (admin-only).",
    inputSchema: {
      type: "object",
      properties: { user_id: { type: "string" }, status: { type: "string", enum: ["active", "paused"] } },
    },
    action: {
      nodeName: "List schedules",
      parameters: {
        method: "GET",
        url: sb(
          "'/rest/v1/scheduled_tasks'" +
            "+ '?select=id,user_id,status,cron,next_run_at,data,created_at,updated_at'" +
            "+ '&order=updated_at.desc'" +
            "+ ($json.user_id ? '&user_id=eq.' + $json.user_id : '')" +
            "+ ($json.status ? '&status=eq.' + $json.status : '')"
        ),
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: "apikey", value: "={{ $credentials['datiq-supabase-service'].value }}" },
            { name: "Authorization", value: "=Bearer {{ $credentials['datiq-supabase-service'].value }}" },
          ],
        },
        options: {},
      },
    },
  }),

  mcpToolSpec({
    name: "datiq_create_schedule",
    description:
      "Create a new monitoring schedule. `target` is the URL to track (or " +
      "array of URLs for batch). `cron` is a 5-field cron expression (UTC).",
    inputSchema: {
      type: "object",
      properties: {
        user_id: { type: "string" },
        type: { type: "string", enum: ["track", "batch"] },
        target: {},
        cron: { type: "string" },
        intent: { type: "string", default: "summary" },
        alert_email: { type: "string" },
        label: { type: "string" },
        render_js: { type: "boolean", default: false },
        custom_prompt: { type: "string" },
        expires_at: { type: "string" },
      },
      required: ["user_id", "type", "target", "cron"],
    },
    action: {
      nodeName: "Insert",
      parameters: {
        method: "POST",
        url: sb("'/rest/v1/scheduled_tasks'"),
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: "apikey", value: "={{ $credentials['datiq-supabase-service'].value }}" },
            { name: "Authorization", value: "=Bearer {{ $credentials['datiq-supabase-service'].value }}" },
            { name: "Content-Type", value: "application/json" },
            { name: "Prefer", value: "return=representation" },
          ],
        },
        sendBody: true,
        specifyBody: "json",
        jsonBody:
          `={\n` +
          `  "id": "sch_{{ $now.toMillis() }}",\n` +
          `  "user_id": "{{ $json.user_id }}",\n` +
          `  "status": "active",\n` +
          `  "cron": "{{ $json.cron }}",\n` +
          `  "data": {{ JSON.stringify({ type: $json.type, target: $json.target, intent: $json.intent, alertEmail: $json.alert_email, label: $json.label, renderJs: $json.render_js, customPrompt: $json.custom_prompt, expiresAt: $json.expires_at, status: 'active' }) }}\n` +
          `}`,
        options: {},
      },
    },
  }),

  mcpToolSpec({
    name: "datiq_pause_schedule",
    description: "Pause a monitoring schedule. The orchestrator won't fire it while paused.",
    inputSchema: { type: "object", properties: { schedule_id: { type: "string" } }, required: ["schedule_id"] },
    action: {
      nodeName: "Pause",
      parameters: {
        method: "PATCH",
        url: sb("'/rest/v1/scheduled_tasks?id=eq.' + $json.schedule_id"),
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: "apikey", value: "={{ $credentials['datiq-supabase-service'].value }}" },
            { name: "Authorization", value: "=Bearer {{ $credentials['datiq-supabase-service'].value }}" },
            { name: "Content-Type", value: "application/json" },
            { name: "Prefer", value: "return=representation" },
          ],
        },
        sendBody: true,
        specifyBody: "json",
        jsonBody: '={ "status": "paused", "updated_at": "={{ $now.toISO() }}" }',
        options: {},
      },
    },
  }),

  mcpToolSpec({
    name: "datiq_resume_schedule",
    description: "Resume a paused monitoring schedule.",
    inputSchema: { type: "object", properties: { schedule_id: { type: "string" } }, required: ["schedule_id"] },
    action: {
      nodeName: "Resume",
      parameters: {
        method: "PATCH",
        url: sb("'/rest/v1/scheduled_tasks?id=eq.' + $json.schedule_id"),
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: "apikey", value: "={{ $credentials['datiq-supabase-service'].value }}" },
            { name: "Authorization", value: "=Bearer {{ $credentials['datiq-supabase-service'].value }}" },
            { name: "Content-Type", value: "application/json" },
            { name: "Prefer", value: "return=representation" },
          ],
        },
        sendBody: true,
        specifyBody: "json",
        jsonBody: '={ "status": "active", "updated_at": "={{ $now.toISO() }}" }',
        options: {},
      },
    },
  }),

  mcpToolSpec({
    name: "datiq_delete_schedule",
    description: "Permanently delete a monitoring schedule and all its history.",
    inputSchema: { type: "object", properties: { schedule_id: { type: "string" } }, required: ["schedule_id"] },
    action: {
      nodeName: "Delete",
      parameters: {
        method: "DELETE",
        url: sb("'/rest/v1/scheduled_tasks?id=eq.' + $json.schedule_id"),
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: "apikey", value: "={{ $credentials['datiq-supabase-service'].value }}" },
            { name: "Authorization", value: "=Bearer {{ $credentials['datiq-supabase-service'].value }}" },
          ],
        },
        options: {},
      },
    },
  }),

  mcpToolSpec({
    name: "datiq_diagnose_pending_workflow",
    description:
      "Diagnostic tool. Given a workflow event id, fetches the event + " +
      "recent attempts + the target schedule + the user + recent " +
      "extractions, and returns a structured diagnostic. Use this when " +
      "'why did this fail?'.",
    inputSchema: {
      type: "object",
      properties: { event_id: { type: "string" } },
      required: ["event_id"],
    },
    action: {
      nodeName: "Fetch event",
      parameters: {
        method: "GET",
        url: sb("'/rest/v1/workflow_events?id=eq.' + $json.event_id + '&select=*'"),
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: "apikey", value: "={{ $credentials['datiq-supabase-service'].value }}" },
            { name: "Authorization", value: "=Bearer {{ $credentials['datiq-supabase-service'].value }}" },
          ],
        },
        options: {},
      },
    },
  }),
];

// ── The 6 automation workflow specs (Phase 4/5) ────────────────────────

const AUTOMATION_WORKFLOWS = [
  // ① schedule-changed-router — the most important one, replaces the
  //    dropped SCHEDULE_ALERT_WEBHOOK.
  webhookFlowSpec({
    name: "datiq_schedule_changed_router",
    description: "Routes schedule.changed events to Slack + Resend. Replaces the old direct webhook.",
    action: {
      nodes: [
        {
          name: "Resolve channels",
          type: "n8n-nodes-base.code",
          typeVersion: 2,
          parameters: {
            mode: "runOnceForEachItem",
            jsCode:
              `// Read user preferences from workflow_subscriptions. Falls back to\n` +
              `// the channels embedded in the event payload.\n` +
              `const evt = $input.first().json;\n` +
              `const channels = Array.isArray(evt.channels) ? evt.channels : [];\n` +
              `const out = { slack: channels.find(c => c.type === 'slack') || null, email: channels.find(c => c.type === 'email') || null };\n` +
              `return [{ json: { event: evt, channels: out } }];`,
          },
        },
        {
          name: "Post to Slack",
          type: "n8n-nodes-base.slack",
          typeVersion: 2,
          parameters: {
            resource: "message",
            operation: "post",
            channel: "={{ $json.channels.slack?.channel || '#monitoring' }}",
            text:
              "=:rotating_light: *Content changed:* {{ $json.event.payload.label }} ({{ $json.event.payload.scheduleId }})\n" +
              ">Target: {{ $json.event.payload.target }}\n" +
              ">Intent: {{ $json.event.payload.intent }}\n" +
              ">Previous hash: `{{ $json.event.payload.previousHash }}`\n" +
              ">New hash: `{{ $json.event.payload.newHash }}`\n" +
              ">Detected: {{ $json.event.payload.detectedAt }}",
            otherOptions: {},
          },
          credentials: { slackOAuth2Api: { id: "datiq-slack-monitoring", name: "datiq-slack-monitoring" } },
        },
        {
          name: "Send Resend email",
          type: "n8n-nodes-base.httpRequest",
          typeVersion: 4.2,
          parameters: {
            method: "POST",
            url: "https://api.resend.com/emails",
            sendHeaders: true,
            headerParameters: {
              parameters: [
                { name: "Authorization", value: "=Bearer {{ $credentials['datiq-resend'].value }}" },
                { name: "Content-Type", value: "application/json" },
              ],
            },
            sendBody: true,
            specifyBody: "json",
            jsonBody:
              `={\n` +
              `  "from": "{{ $env.ALERT_EMAIL_FROM || 'DatIQ Alerts <alerts@datiq.app>' }}",\n` +
              `  "to": ["{{ $json.channels.email?.to || $json.event.payload.alertEmail }}"],\n` +
              `  "subject": "DatIQ — content changed: {{ $json.event.payload.label }}",\n` +
              `  "html": "<h2>Content changed</h2><p>Your schedule <b>{{ $json.event.payload.label }}</b> detected a change.</p><p><a href='{{ $json.event.payload.siteUrl }}/schedules'>View in DatIQ →</a></p>"\n` +
              `}`,
            options: { continueOnFail: true },
          },
        },
        callbackNode({ eventPath: "$json.event?.id || $json.id" }),
      ],
    },
  }),

  // ② contact-received router
  webhookFlowSpec({
    name: "datiq_contact_router",
    description: "Routes contact-form submissions to Slack + CRM webhook.",
    action: {
      nodes: [
        {
          name: "Notify Slack",
          type: "n8n-nodes-base.slack",
          typeVersion: 2,
          parameters: {
            resource: "message",
            operation: "post",
            channel: "=#datiq-support",
            text:
              "=:envelope: New contact: *{{ $json.type }}* from {{ $json.from }}\n" +
              ">{{ $json.subject }}\n" +
              ">{{ ($json.body || '').slice(0, 200) }}",
          },
          credentials: { slackOAuth2Api: { id: "datiq-slack-monitoring", name: "datiq-slack-monitoring" } },
        },
        {
          name: "Forward to CRM",
          type: "n8n-nodes-base.httpRequest",
          typeVersion: 4.2,
          parameters: {
            method: "POST",
            url: "={{ $env.VITE_CONTACT_WEBHOOK_URL || $env.VITE_WEBHOOK_URL }}",
            sendHeaders: true,
            headerParameters: { parameters: [{ name: "Content-Type", value: "application/json" }] },
            sendBody: true,
            specifyBody: "json",
            jsonBody: "={{ JSON.stringify($json) }}",
            options: { continueOnFail: true },
          },
        },
        callbackNode({ eventPath: "$json.id" }),
      ],
    },
  }),

  // ⑤ failure-alert (Phase 5)
  webhookFlowSpec({
    name: "datiq_failure_alert",
    description: "Posts operational alerts (schedule scrape failed 3+ times) to #datiq-alerts.",
    action: {
      nodes: [
        {
          name: "Notify ops",
          type: "n8n-nodes-base.slack",
          typeVersion: 2,
          parameters: {
            resource: "message",
            operation: "post",
            channel: "=#datiq-alerts",
            text: "=:warning: DatIQ op event: {{ $json.kind }} — {{ $json.payload?.reason || 'see logs' }}",
          },
          credentials: { slackOAuth2Api: { id: "datiq-slack-monitoring", name: "datiq-slack-monitoring" } },
        },
        callbackNode({ eventPath: "$json.id" }),
      ],
    },
  }),

  // ③ user-lifecycle (welcome / reengagement drip)
  {
    name: "datiq_user_lifecycle",
    description: "Welcome / reengagement drip. Triggered by DatIQ's welcome-email + reengagement functions.",
    nodes: [
      {
        name: "Webhook",
        type: "n8n-nodes-base.webhook",
        typeVersion: 1,
        parameters: {
          httpMethod: "POST",
          path: "datiq/user-event",
          responseMode: "responseNode",
          authentication: "headerAuth",
          options: {},
        },
        position: [240, 300],
      },
      {
        name: "Send Resend email",
        type: "n8n-nodes-base.httpRequest",
        typeVersion: 4.2,
        parameters: {
          method: "POST",
          url: "https://api.resend.com/emails",
          sendHeaders: true,
          headerParameters: {
            parameters: [
              { name: "Authorization", value: "=Bearer {{ $credentials['datiq-resend'].value }}" },
              { name: "Content-Type", value: "application/json" },
            ],
          },
          sendBody: true,
          specifyBody: "json",
          jsonBody:
            `={\\n` +
            `  "from": "{{ $env.CONTACT_EMAIL_FROM || 'DatIQ <hello@datiq.app>' }}",\\n` +
            `  "to": ["{{ $json.user?.email }}"],\\n` +
            `  "subject": "{{ $json.subject || 'Welcome to DatIQ' }}",\\n` +
            `  "html": "{{ $json.html || '<p>Welcome to DatIQ!</p>' }}"\\n` +
            `}`,
          options: { continueOnFail: true },
        },
        position: [500, 300],
      },
      {
        ...callbackNode({ eventPath: "$json.id" }),
        position: [760, 300],
      },
      {
        name: "Respond OK",
        type: "n8n-nodes-base.respondToWebhook",
        typeVersion: 1,
        parameters: { respondWith: "json", responseBody: "={{ JSON.stringify({ ok: true }) }}" },
        position: [1020, 300],
      },
    ],
    connections: {
      Webhook: { main: [[{ node: "Send Resend email", type: "main", index: 0 }]] },
      "Send Resend email": { main: [[{ node: "Callback DatIQ", type: "main", index: 0 }]] },
      "Callback DatIQ": { main: [[{ node: "Respond OK", type: "main", index: 0 }]] },
    },
  },

  // ⑥ daily-digest (cron-triggered, no webhook)
  {
    name: "datiq_daily_digest",
    description: "Daily digest: emails each user a summary of their schedule activity from the past 24h.",
    nodes: [
      {
        name: "Daily 21:00 UTC",
        type: "n8n-nodes-base.scheduleTrigger",
        typeVersion: 1.2,
        parameters: {
          rule: {
            interval: [
              { field: "cronExpression", expression: "0 21 * * *" },
            ],
          },
        },
        position: [240, 300],
      },
      {
        name: "Query Supabase for today's runs",
        type: "n8n-nodes-base.httpRequest",
        typeVersion: 4.2,
        parameters: {
          method: "GET",
          url: sb(
            "'/rest/v1/workflow_events'" +
              "+ '?select=id,user_id,kind,state&kind=eq.schedule.changed'" +
              "+ '&created_at=gte.' + $now.minus({days: 1}).toISO()"
          ),
          sendHeaders: true,
          headerParameters: {
            parameters: [
              { name: "apikey", value: "={{ $credentials['datiq-supabase-service'].value }}" },
              { name: "Authorization", value: "=Bearer {{ $credentials['datiq-supabase-service'].value }}" },
            ],
          },
          options: {},
        },
        position: [500, 300],
      },
      {
        name: "Group by user",
        type: "n8n-nodes-base.code",
        typeVersion: 2,
        parameters: {
          mode: "runOnceForEachItem",
          jsCode:
            `// Group today's events by user_id\n` +
            `const items = $input.all();\n` +
            `const byUser = {};\n` +
            `for (const item of items) {\n` +
            `  const u = item.json.user_id || 'anonymous';\n` +
            `  byUser[u] = (byUser[u] || 0) + 1;\n` +
            `}\n` +
            `return Object.entries(byUser).map(([user_id, count]) => ({ json: { user_id, count } }));`,
        },
        position: [760, 300],
      },
    ],
    connections: {
      "Daily 21:00 UTC": { main: [[{ node: "Query Supabase for today's runs", type: "main", index: 0 }]] },
      "Query Supabase for today's runs": { main: [[{ node: "Group by user", type: "main", index: 0 }]] },
    },
  },

  // ⑦ global-error-handler (ErrorTrigger-based, sends Resend alert email with workflow name, error details, stack trace)
  {
    name: "datiq_global_error_handler",
    description: "Global error handler: catches failed workflow executions and dispatches a detailed alert email via Resend.",
    nodes: [
      {
        name: "Error Trigger",
        type: "n8n-nodes-base.errorTrigger",
        typeVersion: 1,
        position: [240, 300],
      },
      {
        name: "Format error & build Resend email",
        type: "n8n-nodes-base.code",
        typeVersion: 2,
        parameters: {
          mode: "runOnceForEachItem",
          jsCode:
            `// Extract error and execution metadata\n` +
            `const exec = $json.execution || {};\n` +
            `const wf = $json.workflow || {};\n` +
            `const err = exec.error || {};\n\n` +
            `const workflowName = wf.name || "Unknown Workflow";\n` +
            `const workflowId = wf.id || "N/A";\n` +
            `const executionId = exec.id || "N/A";\n` +
            `const executionUrl = exec.url || ($env.N8N_BASE_URL ? $env.N8N_BASE_URL + '/execution/' + executionId : '');\n` +
            `const lastNode = exec.lastNodeExecuted || "Unknown Node";\n` +
            `const errorMessage = err.message || err.description || "An unexpected error occurred during workflow execution.";\n` +
            `const errorStack = err.stack || err.context?.stack || "No stack trace available.";\n` +
            `const timestamp = new Date().toISOString();\n\n` +
            `// Recipient email: configurable via environment variable, defaults to hello@datiq.app\n` +
            `const toEmail = $env.ERROR_ALERT_EMAIL || $env.OPS_ALERT_EMAIL || "hello@datiq.app";\n` +
            `const fromEmail = $env.ALERT_EMAIL_FROM || "DatIQ Alerts <alerts@datiq.app>";\n\n` +
            `const html = \`<!DOCTYPE html>\n` +
            `<html>\n` +
            `<head>\n` +
            `  <meta charset="utf-8">\n` +
            `  <style>\n` +
            `    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0c0e12; color: #e2e8f0; margin: 0; padding: 24px; }\n` +
            `    .card { background-color: #14171f; border: 1px solid #2d3748; border-radius: 8px; max-width: 680px; margin: 0 auto; overflow: hidden; }\n` +
            `    .header { background-color: #7f1d1d; border-bottom: 1px solid #991b1b; padding: 18px 24px; }\n` +
            `    .header h2 { margin: 0; font-size: 18px; color: #fecaca; display: flex; align-items: center; gap: 8px; }\n` +
            `    .content { padding: 24px; }\n` +
            `    .meta-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 14px; }\n` +
            `    .meta-table td { padding: 8px 0; border-bottom: 1px solid #1e293b; }\n` +
            `    .meta-label { color: #94a3b8; width: 140px; font-weight: 600; }\n` +
            `    .meta-value { color: #f1f5f9; word-break: break-all; }\n` +
            `    .error-box { background-color: #1e1e24; border-left: 4px solid #ef4444; padding: 14px 16px; border-radius: 4px; margin-bottom: 20px; }\n` +
            `    .error-title { font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; color: #f87171; font-weight: 700; margin-bottom: 6px; }\n` +
            `    .error-msg { font-size: 15px; color: #ffffff; font-family: monospace; white-space: pre-wrap; word-break: break-word; }\n` +
            `    .stack-box { background-color: #090a0f; border: 1px solid #1e293b; border-radius: 4px; padding: 14px; overflow-x: auto; max-height: 280px; }\n` +
            `    .stack-title { font-size: 12px; color: #64748b; font-weight: 600; margin-bottom: 8px; text-transform: uppercase; }\n` +
            `    .stack-trace { font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; font-size: 12px; color: #cbd5e1; line-height: 1.5; margin: 0; white-space: pre-wrap; }\n` +
            `    .btn { display: inline-block; background-color: #3b82f6; color: #ffffff !important; text-decoration: none; padding: 10px 18px; border-radius: 6px; font-weight: 600; font-size: 14px; margin-top: 16px; }\n` +
            `    .footer { padding: 16px 24px; background-color: #0f1218; border-top: 1px solid #1e293b; font-size: 12px; color: #64748b; text-align: center; }\n` +
            `  </style>\n` +
            `</head>\n` +
            `<body>\n` +
            `  <div class="card">\n` +
            `    <div class="header">\n` +
            `      <h2>🚨 Workflow Execution Failure</h2>\n` +
            `    </div>\n` +
            `    <div class="content">\n` +
            `      <table class="meta-table">\n` +
            `        <tr><td class="meta-label">Workflow:</td><td class="meta-value"><strong>\${workflowName}</strong></td></tr>\n` +
            `        <tr><td class="meta-label">Failed Node:</td><td class="meta-value"><code>\${lastNode}</code></td></tr>\n` +
            `        <tr><td class="meta-label">Execution ID:</td><td class="meta-value">\${executionId}</td></tr>\n` +
            `        <tr><td class="meta-label">Timestamp:</td><td class="meta-value">\${timestamp}</td></tr>\n` +
            `      </table>\n\n` +
            `      <div class="error-box">\n` +
            `        <div class="error-title">Error Details</div>\n` +
            `        <div class="error-msg">\${errorMessage}</div>\n` +
            `      </div>\n\n` +
            `      <div class="stack-box">\n` +
            `        <div class="stack-title">Stack Trace</div>\n` +
            `        <pre class="stack-trace">\${errorStack}</pre>\n` +
            `      </div>\n\n` +
            `      \${executionUrl ? \`<p><a href="\${executionUrl}" class="btn" target="_blank">View Execution in n8n &rarr;</a></p>\` : ''}\n` +
            `    </div>\n` +
            `    <div class="footer">\n` +
            `      DatIQ Automation Reliability Engine &bull; Environment: \${$env.NODE_ENV || 'production'}\n` +
            `    </div>\n` +
            `  </div>\n` +
            `</body>\n` +
            `</html>\`;\n\n` +
            `return [{\n` +
            `  json: {\n` +
            `    emailPayload: {\n` +
            `      from: fromEmail,\n` +
            `      to: [toEmail],\n` +
            `      subject: \`🚨 [DatIQ Workflow Error] \${workflowName} failed on node "\${lastNode}"\`,\n` +
            `      html: html\n` +
            `    }\n` +
            `  }\n` +
            `}];`,
        },
        position: [500, 300],
      },
      {
        name: "Send via Resend",
        type: "n8n-nodes-base.httpRequest",
        typeVersion: 4.2,
        parameters: {
          method: "POST",
          url: "https://api.resend.com/emails",
          sendHeaders: true,
          headerParameters: {
            parameters: [
              { name: "Authorization", value: "=Bearer {{ $env.RESEND_API_KEY }}" },
              { name: "Content-Type", value: "application/json" },
            ],
          },
          sendBody: true,
          specifyBody: "json",
          jsonBody: "={{ JSON.stringify($json.emailPayload) }}",
          options: {
            continueOnFail: true,
          },
        },
        position: [760, 300],
      },
    ],
    connections: {
      "Error Trigger": { main: [[{ node: "Format error & build Resend email", type: "main", index: 0 }]] },
      "Format error & build Resend email": { main: [[{ node: "Send via Resend", type: "main", index: 0 }]] },
    },
  },
];

// ── Main ────────────────────────────────────────────────────────────────

mkdirSync(OUT_DIR, { recursive: true });

// Wipe only the files this script generates, leave the smoke test alone.
const GENERATED = [
  ...MCP_TOOLS,
  ...SCHEDULE_MCP_TOOLS,
  ...AUTOMATION_WORKFLOWS,
];

const existing = readdirSync(OUT_DIR).filter(
  (f) => f.endsWith(".json") && f !== "00-datiq-smoke-test.json"
);
for (const f of existing) {
  try {
    unlinkSync(join(OUT_DIR, f));
  } catch {
    /* ignore */
  }
}

let written = 0;
for (const spec of GENERATED) {
  const json = toN8nJson(spec, {
    meta: { description: spec.description || "" },
  });
  const file = join(OUT_DIR, `${spec.name}.json`);
  writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
  written++;
}

console.log(`✓ generated ${written} n8n workflow JSONs in ${OUT_DIR}`);
console.log(`  ${MCP_TOOLS.length} pending-event MCP tools`);
console.log(`  ${SCHEDULE_MCP_TOOLS.length} schedule MCP tools`);
console.log(`  ${AUTOMATION_WORKFLOWS.length} automation workflows`);
console.log(`  (plus 00-datiq-smoke-test.json, hand-written)`);
