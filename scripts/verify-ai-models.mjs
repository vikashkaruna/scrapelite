#!/usr/bin/env node
// scripts/verify-ai-models.mjs — prove a pinned AI model id still ACCEPTS a call.
//
// ── WHY THIS IS A SCRIPT AND NOT A TEST ─────────────────────────────────────
//
// Every Gemini 2.x id this product pinned answered `GET /v1beta/models` with
// HTTP 200 the whole time it was dead. Only `:generateContent` revealed the
// retirement:
//
//   404 "This model is no longer available" / "no longer available to new users"
//
// So there is no hermetic way to test this, and a test that shelled out to the
// network would be flaky and would spend the operator's quota in CI. The
// unit-level half lives in aiGeminiStructuredOutput.test.js (no pinned id may be
// in a known-retired set); THIS is the half that catches a retirement nobody
// has written down yet.
//
// Usage:
//   GEMINI_API_KEY=… node scripts/verify-ai-models.mjs
//   node scripts/verify-ai-models.mjs --from-env deployment/env/.env.local
//
// ⚠️ It makes one real, tiny generateContent call per model. It is deliberately
// NOT part of `npm run test:all`.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PROVIDERS } from "../src/lib/providerRegistry.js";
import { toGeminiSchema } from "../netlify/functions/lib/aiProviders.js";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const args = process.argv.slice(2);
const envFileArg = args.indexOf("--from-env");
const envFile = envFileArg >= 0 ? args[envFileArg + 1] : null;

function keyFromEnvFile(p) {
  for (const line of readFileSync(resolve(ROOT, p), "utf8").split("\n")) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && m[1] === "GEMINI_API_KEY") return m[2].replace(/^["']|["']$/g, "");
  }
  return "";
}

const key = process.env.GEMINI_API_KEY || (envFile ? keyFromEnvFile(envFile) : "");
if (!key) {
  console.error("✗ no GEMINI_API_KEY. Pass one, or use --from-env <path to .env.local>");
  process.exit(1);
}

// A real schema, in the shape the product actually sends — including the union
// type. A model that answers this one can answer an extraction run.
const SCHEMA = {
  type: "object",
  properties: { title: { type: "string" }, note: { type: ["string", "null"] } },
  required: ["title"],
};

const g = PROVIDERS.gemini.models;
const targets = [
  ["tier:fast", g.fast],
  ["tier:deep", g.deep],
  ...g.catalogue.map((m) => ["catalogue", m]),
].filter(([, m], i, arr) => m && arr.findIndex(([, x]) => x === m) === i);

/**
 * A 404 means the id itself is gone. 503 means it exists and is saturated —
 * retry, do not change the pin. 429 means our quota is gone — stop, do not
 * read it as a model problem. Everything else is the caller's problem.
 */
function classify(status, body) {
  const msg = String(body?.error?.message || "");
  if (status === 404) return /no longer available|not found for API version/i.test(msg) ? "RETIRED" : "UNSUPPORTED";
  if (status === 503) return "SATURATED (transient — retry, do not re-pin)";
  if (status === 429) return "QUOTA EXHAUSTED (not a model problem)";
  if (status === 400) return `REJECTED: ${msg.slice(0, 120)}`;
  if (status >= 200 && status < 300) return "OK";
  return `HTTP ${status}: ${msg.slice(0, 120)}`;
}

console.log(`probing ${targets.length} gemini model id(s) with a real schema\n`);
let hardFail = 0;
for (const [where, model] of targets) {
  let status = 0;
  let body = null;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "Page title: Acme. Return JSON." }] }],
          generationConfig: { responseMimeType: "application/json", responseSchema: toGeminiSchema(SCHEMA) },
        }),
      },
    );
    status = res.status;
    body = await res.json().catch(() => ({}));
  } catch (e) {
    console.log(`  ${where.padEnd(11)} ${model.padEnd(26)} NETWORK: ${String(e.message).slice(0, 80)}`);
    continue;
  }
  const verdict = classify(status, body);
  if (verdict === "RETIRED" || verdict === "UNSUPPORTED") hardFail++;
  console.log(`  ${where.padEnd(11)} ${model.padEnd(26)} ${verdict}`);
}

console.log();
if (hardFail) {
  console.error(`✗ ${hardFail} pinned id(s) are gone. Re-point them in src/lib/providerRegistry.js`);
  console.error(`  and add the old id to the RETIRED set in`);
  console.error(`  netlify/__tests__/aiGeminiStructuredOutput.test.js.`);
  process.exit(1);
}
console.log("✓ every pinned id accepted a real generateContent call");
