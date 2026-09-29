// netlify/__tests__/aiGeminiStructuredOutput.test.js
//
// 🔴 THE REGRESSION THIS FILE EXISTS FOR
//
// Gemini's `responseSchema` is not JSON Schema. It is a proto message whose
// `type` is a single enum and whose `items` is a single message, so a
// JSON-Schema type UNION — `type: ["string", "null"]`, which is the idiomatic
// way to write a nullable field and which src/lib/extractionSchemas.js does 44
// times — is a guaranteed 400:
//
//   Invalid JSON payload received. Unknown name "type" at
//   'generation_config.response_schema.properties[0].value.items…'
//   Proto field is not repeating, cannot start list.
//
// That 400 is not a warning. It is the provider's ONLY response, so Gemini
// drops out of the chain, the run loses its structured facts, and the template
// reports "This run is incomplete" — while /admin/health stays green, because
// the liveness probe used to call every adapter with NO schema and therefore
// never touched the code path that was broken.
//
// The assertions below read the request body the adapter ACTUALLY built, off a
// stubbed fetch. They deliberately do not re-implement the translation and
// assert against itself — that is how the original shipped: the suite was
// green against a module that 400'd on every nullable field in the product.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROVIDERS, keyEnvNames, readKey } from "../../src/lib/providerRegistry.js";
import { PING_SCHEMA, pingProvider, runChain } from "../functions/lib/aiProviders.js";

let fetchMock;

beforeEach(() => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.AI_API_KEY;
  delete process.env.VITE_AI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  vi.resetModules();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Walk a parsed responseSchema and collect every `type` value found. */
function collectTypes(node, path = "", acc = []) {
  if (Array.isArray(node)) {
    node.forEach((n, i) => collectTypes(n, `${path}[${i}]`, acc));
    return acc;
  }
  if (!node || typeof node !== "object") return acc;
  for (const [k, v] of Object.entries(node)) {
    if (k === "type") acc.push({ path: path ? `${path}.${k}` : k, value: v });
    else collectTypes(v, path ? `${path}.${k}` : k, acc);
  }
  return acc;
}

/** Run the chain far enough to capture the Gemini request body. */
async function captureGeminiBody(schema) {
  process.env.GEMINI_API_KEY = "gem-key";
  process.env.ANTHROPIC_API_KEY = "ant-key";
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"title":"Acme"}' }] } }] }), { status: 200 }),
  );
  await runChain([{ role: "user", content: "Extract it." }], 256, { schema, tier: "deep" });
  const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("generativelanguage"));
  expect(call, "no Gemini request was made — the chain skipped it").toBeTruthy();
  return JSON.parse(call[1].body);
}

describe("Gemini structured output (the 400 that ate every nullable field)", () => {
  it("sends NO list-valued `type` — the exact shape proto rejects", async () => {
    const body = await captureGeminiBody({
      type: "object",
      properties: {
        title: { type: ["string", "null"] },
        score: { type: ["number", "null"] },
        people: {
          type: "array",
          items: { type: "object", properties: { name: { type: "string" }, role: { type: ["string", "null"] } } },
        },
      },
      required: ["title"],
    });
    const types = collectTypes(body.generationConfig.responseSchema);
    const lists = types.filter((t) => Array.isArray(t.value));
    expect(lists, `list-valued type survived translation: ${JSON.stringify(lists)}`).toEqual([]);
    expect(types.length).toBeGreaterThan(3);
  });

  it("collapses a union to the member that carries information, not to `null`", async () => {
    const body = await captureGeminiBody({
      type: "object",
      properties: { title: { type: ["string", "null"] } },
    });
    expect(body.generationConfig.responseSchema.properties.title.type).toBe("string");
  });

  it("collapses a union with a non-string first member correctly", async () => {
    const body = await captureGeminiBody({
      type: "object",
      properties: { n: { type: ["number", "null"] } },
    });
    expect(body.generationConfig.responseSchema.properties.n.type).toBe("number");
  });

  it("keeps a nested union inside array items (the path in the 400's own message)", async () => {
    // The production error was `…properties[0].value.items…` — i.e. the bad
    // type sat under items, which is exactly this shape.
    const body = await captureGeminiBody({
      type: "object",
      properties: {
        people: { type: "array", items: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
      },
    });
    expect(collectTypes(body.generationConfig.responseSchema).filter((t) => Array.isArray(t.value))).toEqual([]);
  });

  it("does NOT turn an array-valued `properties` into numeric keys", async () => {
    // The old translation ran Object.entries() over `properties` unconditionally,
    // so malformed-but-plausible input came out as {"0": …, "1": …} — a map to
    // every reader and a 400 to the API.
    const body = await captureGeminiBody({
      type: "object",
      properties: [{ type: "string" }],
    });
    const props = body.generationConfig.responseSchema.properties;
    expect(props === undefined || !Array.isArray(props)).toBe(true);
    if (props) expect(Object.keys(props)).not.toContain("0");
  });

  it("drops the JSON-Schema combinators Gemini has no field for", async () => {
    const body = await captureGeminiBody({
      type: "object",
      properties: { x: { anyOf: [{ type: "string" }, { type: "number" }] } },
      $schema: "https://json-schema.org/draft/2020-12/schema",
      additionalProperties: false,
    });
    const s = body.generationConfig.responseSchema;
    expect(s.anyOf).toBeUndefined();
    expect(s.$schema).toBeUndefined();
    expect(s.additionalProperties).toBeUndefined();
  });

  it("normalises tuple-form `items` to the single schema Gemini accepts", async () => {
    const body = await captureGeminiBody({
      type: "object",
      properties: { pair: { type: "array", items: [{ type: "string" }] } },
    });
    expect(Array.isArray(body.generationConfig.responseSchema.properties.pair.items)).toBe(false);
  });
});

describe("the liveness probe exercises the path that was broken", () => {
  it("PING_SCHEMA carries the union shape that used to 400", () => {
    // If this stops holding, the probe has quietly gone back to proving nothing.
    const unions = collectTypes(PING_SCHEMA).filter((t) => Array.isArray(t.value));
    expect(unions.length).toBeGreaterThan(0);
  });

  it("sends a schema to a provider that has native structured output", async () => {
    process.env.GEMINI_API_KEY = "gem-key";
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }), { status: 200 }),
    );
    await pingProvider("gemini");
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("generativelanguage"));
    expect(call).toBeTruthy();
    const body = JSON.parse(call[1].body);
    expect(body.generationConfig.responseSchema, "probe sent no schema — it proves nothing about production").toBeTruthy();
    expect(collectTypes(body.generationConfig.responseSchema).filter((t) => Array.isArray(t.value))).toEqual([]);
  });

  it("can be turned off for a caller that wants a bare key/model check", async () => {
    process.env.GEMINI_API_KEY = "gem-key";
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }), { status: 200 }),
    );
    await pingProvider("gemini", { withSchema: false });
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("generativelanguage"));
    expect(JSON.parse(call[1].body).generationConfig.responseSchema).toBeUndefined();
  });
});

describe("Gemini model ids (the whole 2.x line was retired under us)", () => {
  // GET /v1beta/models still answers 200 for every one of these, which is
  // precisely why they were not noticed: only a real :generateContent call
  // reveals the retirement.
  const RETIRED = new Set([
    "gemini-1.5-flash", "gemini-1.5-pro",
    "gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-2.0-flash-exp",
    "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro",
  ]);

  it("pins no retired id at either tier", () => {
    const m = PROVIDERS.gemini.models;
    for (const tier of ["fast", "deep"]) {
      expect(RETIRED.has(m[tier]), `gemini ${tier} pins retired id ${m[tier]}`).toBe(false);
    }
  });

  it("lists no retired id in the catalogue an operator can pick from", () => {
    for (const id of PROVIDERS.gemini.models.catalogue) {
      expect(RETIRED.has(id), `catalogue offers retired id ${id}`).toBe(false);
    }
  });

  it("both tiers name a model (a blank tier silently disables the provider)", () => {
    expect(PROVIDERS.gemini.models.fast).toBeTruthy();
    expect(PROVIDERS.gemini.models.deep).toBeTruthy();
  });
});

describe("server keys never come from a VITE_-prefixed var", () => {
  it("the anthropic provider reads ANTHROPIC_API_KEY first, AI_API_KEY second", () => {
    expect(keyEnvNames("anthropic")).toEqual(["ANTHROPIC_API_KEY", "AI_API_KEY"]);
  });

  it("resolves an Anthropic key when only the conventional name is set", () => {
    // The whole defect: an operator doing the obvious thing — exporting
    // ANTHROPIC_API_KEY — got a silently SKIPPED provider.
    expect(readKey("anthropic", { ANTHROPIC_API_KEY: "sk-ant-x" })).toBe("sk-ant-x");
  });

  it("still resolves the legacy AI_API_KEY so existing deploys keep their key", () => {
    expect(readKey("anthropic", { AI_API_KEY: "sk-ant-legacy" })).toBe("sk-ant-legacy");
  });

  it("prefers the explicit name when both are set", () => {
    expect(readKey("anthropic", { ANTHROPIC_API_KEY: "new", AI_API_KEY: "old" })).toBe("new");
  });

  it("VITE_AI_API_KEY is no longer a source for ANY provider", () => {
    // It is a browser-inlined name: reading an LLM key from it is what put a
    // live `sk-ant-…` inside the public bundle.
    for (const p of ["anthropic", "gemini", "openai"]) {
      expect(keyEnvNames(p)).not.toContain("VITE_AI_API_KEY");
    }
    expect(readKey("anthropic", { VITE_AI_API_KEY: "sk-ant-browser" })).toBe("");
  });
});
