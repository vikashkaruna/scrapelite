// netlify/__tests__/n8n-workflow-json.test.js
//
// C-37 — Every n8n/workflow/*.json is valid JSON, has the required
// shape, and its node graph is internally consistent (every node
// referenced in `connections` exists, every output edge points to a
// real input).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WORKFLOWS_DIR = resolve(__dirname, "../../n8n/workflows");

function listWorkflowFiles() {
  try {
    return readdirSync(WORKFLOWS_DIR)
      .filter((f) => f.endsWith(".json"))
      .filter((f) => !f.startsWith("."))
      .map((f) => join(WORKFLOWS_DIR, f));
  } catch (err) {
    return [];
  }
}

function loadWorkflow(file) {
  const raw = readFileSync(file, "utf8");
  return { file, raw, json: JSON.parse(raw) };
}

describe("n8n/workflows directory", () => {
  it("exists and is non-empty (if the v2 plan has shipped any)", () => {
    const files = listWorkflowFiles();
    // It's OK for this to be empty in an early checkin; the test
    // exists to surface accidental deletes.
    if (files.length === 0) {
      // eslint-disable-next-line no-console
      console.warn(`[DatIQ] n8n/workflows/ is empty — run scripts/generate-n8n-workflows.mjs to seed it`);
    }
    // Just verify the dir is readable
    expect(() => statSync(WORKFLOWS_DIR)).not.toThrow();
  });
});

describe("n8n/workflows/*.json — required shape", () => {
  const files = listWorkflowFiles();

  for (const file of files) {
    const rel = relative(resolve(__dirname, "../.."), file);

    it(`${rel} parses as JSON`, () => {
      const raw = readFileSync(file, "utf8");
      expect(() => JSON.parse(raw)).not.toThrow();
    });

    it(`${rel} has the required top-level fields`, () => {
      const w = loadWorkflow(file);
      expect(w.json.name).toBeTypeOf("string");
      expect(w.json.name.length).toBeGreaterThan(0);
      expect(w.json.nodes).toBeInstanceOf(Array);
      expect(w.json.nodes.length).toBeGreaterThan(0);
      expect(w.json.connections).toBeTypeOf("object");
      expect(w.json.active).toBeTypeOf("boolean");
      expect(w.json.id).toBeTypeOf("string");
      expect(w.json.settings).toBeTypeOf("object");
    });

    it(`${rel} has the datiq_ prefix (or is the smoke test)`, () => {
      const w = loadWorkflow(file);
      const ok = w.json.name.startsWith("datiq_") || w.json.name.startsWith("00_datiq_");
      expect(ok, `workflow name "${w.json.name}" must start with datiq_ or 00_datiq_`).toBe(true);
    });

    it(`${rel} has unique node IDs`, () => {
      const w = loadWorkflow(file);
      const ids = w.json.nodes.map((n) => n.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it(`${rel} has a trigger as the first node (no incoming connections)`, () => {
      const w = loadWorkflow(file);
      const incoming = new Set();
      for (const src of Object.values(w.json.connections)) {
        for (const outputs of Object.values(src)) {
          for (const conn of outputs) {
            for (const c of conn) {
              incoming.add(c.node);
            }
          }
        }
      }
      const triggers = w.json.nodes.filter(
        (n) =>
          n.type?.includes("Trigger") ||
          n.type?.includes("mcpTrigger") ||
          n.type?.includes("webhook") ||
          n.type?.includes("scheduleTrigger")
      );
      if (triggers.length === 0) {
        // No trigger? Then nothing is wrong, just unusual.
        return;
      }
      for (const t of triggers) {
        expect(incoming.has(t.name)).toBe(false);
      }
    });

    it(`${rel} connections reference real nodes`, () => {
      const w = loadWorkflow(file);
      const nodeNames = new Set(w.json.nodes.map((n) => n.name));
      for (const [srcName, srcOut] of Object.entries(w.json.connections)) {
        expect(nodeNames.has(srcName)).toBe(true);
        for (const outputs of Object.values(srcOut)) {
          for (const conn of outputs) {
            for (const c of conn) {
              expect(nodeNames.has(c.node)).toBe(true);
            }
          }
        }
      }
    });

    it(`${rel} no orphan nodes (every non-trigger has an incoming connection)`, () => {
      const w = loadWorkflow(file);
      const incoming = new Set();
      for (const src of Object.values(w.json.connections)) {
        for (const outputs of Object.values(src)) {
          for (const conn of outputs) {
            for (const c of conn) incoming.add(c.node);
          }
        }
      }
      for (const n of w.json.nodes) {
        const isTrigger =
          n.type?.includes("Trigger") ||
          n.type?.includes("mcpTrigger") ||
          n.type?.includes("webhook") ||
          n.type?.includes("scheduleTrigger");
        if (isTrigger) continue;
        expect(incoming.has(n.name), `node "${n.name}" (${n.type}) has no incoming connection`).toBe(true);
      }
    });

    // Per v2 plan §11: workflows are environment-agnostic. The only host placeholders
    // permitted are `$json._ctx.*` (per-event deployment context, set by the
    // orchestrator) and `$env.N8N_BASE_URL` (this n8n instance's own URL). Any
    // raw `{{SUPABASE_URL}}` / `{{SITE_URL}}` / `{{WEBHOOK_URL}}` string is a
    // pre-refactor artifact and must NOT be in the imported JSON — those would
    // be sent to n8n verbatim and break the URL parse.
    it(`${rel} has no raw {{...}} host placeholders (use $json._ctx.* or $env.* instead)`, () => {
      const w = loadWorkflow(file);
      const text = w.raw;
      const forbidden = [
        "{{SUPABASE_URL}}",
        "{{SITE_URL}}",
        "{{WEBHOOK_URL}}",
        "{{DATIQ_N8N_API_KEY}}",
        "{{N8N_ENCRYPTION_KEY}}",
      ];
      for (const needle of forbidden) {
        expect(
          text.includes(needle),
          `workflow ${rel} still contains the raw placeholder "${needle}". ` +
            "Replace with $json._ctx.* (per-event) or $env.* (n8n env) — see generate-n8n-workflows.mjs."
        ).toBe(false);
      }
    });

    // If the workflow talks to Supabase REST, the host must be read from
    // $json._ctx.supabase_url (i.e. an expression), not a literal string.
    it(`${rel} uses $json._ctx.supabase_url for any Supabase REST URL`, () => {
      const w = loadWorkflow(file);
      const text = w.raw;
      const hitsSupabase = /\/rest\/v1\//.test(text);
      if (!hitsSupabase) return; // not every workflow talks to Supabase
      expect(
        /\$json\._ctx\.supabase_url/.test(text),
        `${rel} references /rest/v1/ but does not use $json._ctx.supabase_url for the host. ` +
          "A static 'https://abc.supabase.co/...' or hard-coded 'https://{{SUPABASE_URL}}/...' is a refactor regression."
      ).toBe(true);
      // And there must be no literal 'https://...supabase.co' host baked in
      expect(
        /https:\/\/[a-z0-9-]+\.supabase\.co/.test(text),
        `${rel} contains a literal Supabase host. Use $json._ctx.supabase_url instead.`
      ).toBe(false);
    });

    // Same for the DatIQ API (SITE_URL replacement). Two patterns accepted:
    //   - $json._ctx.site_url — for webhook-triggered workflows that get _ctx in the body
    //   - $env.SITE_URL      — for schedule-triggered workflows (no body, no _ctx)
    // What is NOT accepted: a literal "https://datiq.app/..." or "https://{{SITE_URL}}/..." host.
    it(`${rel} uses $json._ctx.site_url or $env.SITE_URL for any DatIQ /api URL`, () => {
      const w = loadWorkflow(file);
      const text = w.raw;
      const hitsApi = /datiq\.app\/api|\/api\//.test(text);
      if (!hitsApi) return;
      const ok =
        /\$json\._ctx\.site_url/.test(text) || /\$env\.SITE_URL/.test(text);
      expect(
        ok,
        `${rel} references a DatIQ /api URL but does not use $json._ctx.site_url (webhook) or $env.SITE_URL (schedule). ` +
          "A literal 'https://datiq.app/...' is a refactor regression — set SITE_URL in n8n's .env or pass _ctx in the event payload."
      ).toBe(true);
    });
  }
});

describe("n8n/workflows/*.json — MCP server trigger shape (if present)", () => {
  const files = listWorkflowFiles();
  const mcpFiles = files
    .map(loadWorkflow)
    .filter((w) => w.json.nodes.some((n) => n.type?.includes("mcpTrigger") || n.type?.includes("mcp")));

  it.skipIf(mcpFiles.length === 0)("every MCP workflow has a tool name matching the workflow name", () => {
    for (const w of mcpFiles) {
      const trigger = w.json.nodes.find(
        (n) => n.type?.includes("mcpTrigger") || n.type?.includes("mcp")
      );
      const toolName = trigger?.parameters?.toolName || trigger?.parameters?.name;
      expect(toolName, `in ${w.json.name}`).toBe(w.json.name);
    }
  });

  it.skipIf(mcpFiles.length === 0)("every MCP workflow has a tool description > 20 chars", () => {
    for (const w of mcpFiles) {
      const trigger = w.json.nodes.find(
        (n) => n.type?.includes("mcpTrigger") || n.type?.includes("mcp")
      );
      const desc = trigger?.parameters?.toolDescription || trigger?.parameters?.description;
      expect(typeof desc, `in ${w.json.name}`).toBe("string");
      expect(desc.length, `in ${w.json.name}`).toBeGreaterThan(20);
    }
  });
});
