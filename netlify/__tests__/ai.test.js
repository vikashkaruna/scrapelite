// netlify/functions/ai.test.js
// C-05..07 — Multi-provider chain (gemini → anthropic → openai); per-provider model from
// loadAiConfig(); client `model` ignored; 503 when no key is set.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultModel } from "../../src/lib/providerRegistry.js";

let fetchMock;
let handler;

function anthropicOk(text = "ok") {
  return new Response(
    JSON.stringify({ content: [{ type: "text", text }] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}
function geminiOk(text = "gem-ok") {
  return new Response(
    JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

beforeEach(() => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.AI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.VITE_AI_API_KEY; // local-dev fallback that aiProviders.js reads
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  vi.resetModules();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function loadHandler() {
  const mod = await import("../functions/ai.js");
  return mod.handler;
}

describe("ai — request validation (C-05)", () => {
  it("missing messages → 400", async () => {
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      body: JSON.stringify({}),
    });
    expect(r.statusCode).toBe(400);
  });

  it("empty messages array → 400", async () => {
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      body: JSON.stringify({ messages: [] }),
    });
    expect(r.statusCode).toBe(400);
  });

  it("invalid JSON → 400", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "POST", body: "not json" });
    expect(r.statusCode).toBe(400);
  });

  it("GET → 405", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "GET" });
    expect(r.statusCode).toBe(405);
  });
});

describe("ai — multi-provider chain (C-05)", () => {
  it("first provider (gemini) success → returns immediately, no anthropic call", async () => {
    process.env.GEMINI_API_KEY = "gem";
    process.env.AI_API_KEY = "ant";
    fetchMock.mockResolvedValueOnce(geminiOk("gemini-ok"));
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.content[0].text).toBe("gemini-ok");
    expect(body._provider).toBe("gemini");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gemini 500 → falls through to anthropic; openai never tried", async () => {
    process.env.GEMINI_API_KEY = "gem";
    process.env.AI_API_KEY = "ant";
    process.env.OPENAI_API_KEY = "oai";
    fetchMock
      .mockResolvedValueOnce(new Response("oops", { status: 500 }))
      .mockResolvedValueOnce(anthropicOk("anthropic-ok"));
    const h = await loadHandler();
    const r = await h({
      httpMethod: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    const body = JSON.parse(r.body);
    expect(body._provider).toBe("anthropic");
    expect(body.content[0].text).toBe("anthropic-ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("all providers fail → 502 carrying the CODE and nothing else", async () => {
    // ⚠️ `detail.attempts` used to travel here, carrying each vendor's own
    // error prose — "Your credit balance is too low to access the Anthropic
    // API" — to every signed-in user and every /api/v1 key holder. That is our
    // billing state, not theirs. The code is all the client needs to pick a
    // generic message; the diagnosis goes to the log and to /admin/ai.
    process.env.GEMINI_API_KEY = "AIza";
    process.env.AI_API_KEY = "sk-ant";
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { message: "credit balance is too low" } }), { status: 400 }));
    const h = await loadHandler();
    const r = await h({ httpMethod: "POST", body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }) });
    expect(r.statusCode).toBe(502);
    const body = JSON.parse(r.body);
    expect(body.code).toBeTruthy();
    expect(body.detail).toBeUndefined();
    expect(body.hint).toBeUndefined();
    // Nothing in the whole body names a vendor or our billing.
    expect(r.body).not.toMatch(/credit|anthropic|gemini|openai|api key/i);
  });
});

describe("ai — client model is ignored (C-06)", () => {
  it("the response reports the per-provider model from config, not the client's", async () => {
    process.env.AI_API_KEY = "ant";
    fetchMock.mockResolvedValueOnce(anthropicOk("ok"));
    const h = await loadHandler();
    // Client requests a specific model — the server ignores it and uses the
    // configured per-provider default.
    const r = await h({
      method: "POST",
      httpMethod: "POST",
      body: JSON.stringify({
        model: "client-pretends-this-exists",
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    const body = JSON.parse(r.body);
    // Asserted against the REGISTRY, not a literal, so raising a default model
    // is a one-line change rather than a test failure. The contract under test
    // is "the client's model is ignored", not "the default is this string".
    expect(body._model).toBe(defaultModel("anthropic", "deep"));
    expect(body._model).not.toBe("client-pretends-this-exists");
  });
});

describe("ai — 503 when no key is set (C-07)", () => {
  it("returns 503 with a generic message and a machine-readable code", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "POST", body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }) });
    expect(r.statusCode).toBe(503);
    const body = JSON.parse(r.body);
    expect(body.code).toBe("no_key");
    // The customer is told it is unavailable, NOT which env vars to set.
    expect(body.error).toMatch(/temporarily unavailable/i);
    expect(r.body).not.toMatch(/API_KEY|administrator/i);
  });
});

describe("ai — CORS preflight", () => {
  it("OPTIONS → 204", async () => {
    const h = await loadHandler();
    const r = await h({ httpMethod: "OPTIONS" });
    expect(r.statusCode).toBe(204);
  });
});
