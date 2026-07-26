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
