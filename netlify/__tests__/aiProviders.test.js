// netlify/functions/lib/aiProviders.test.js
// C-33 — runChain tries providers in order; skips disabled; skips missing-key;
// 502 when all fail. C-06 also tested: per-provider model from config.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ORDER, loadAiConfig, runChain } from "../functions/lib/aiProviders.js";

/**
 * Stub the global `fetch` (Node 18+ built-in) so the chain's adapter
 * HTTP calls are intercepted. The adapters normalise each provider's
 * reply into the Anthropic shape BEFORE runChain checks ok; tests
 * therefore return raw provider shapes (gemini candidates, anthropic
 * content[], openai choices).
 */

let fetchMock;

beforeEach(() => {
  // Reset env between tests so we can simulate "no key" or specific keys.
  delete process.env.GEMINI_API_KEY;
  delete process.env.AI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.VITE_AI_API_KEY;
  delete process.env.AI_PROVIDER_ORDER;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  // Reset the module's internal cache (loadAiConfig uses module-level _cache).
  vi.resetModules();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function load() {
  // Re-import after env mutations + cache reset.
  return import("../functions/lib/aiProviders.js");
}

describe("runChain (C-33)", () => {
  /**
   * Per-provider success response. The adapters normalise each provider's
   * shape into an Anthropic-style { content: [{ text }] } reply BEFORE
   * checking ok. Tests should return the raw provider shape.
   */
  function geminiOk(text) {
    return new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }),
      { status: 200 },
    );
  }
  function anthropicOk(text) {
    return new Response(
      JSON.stringify({ content: [{ type: "text", text }] }),
      { status: 200 },
    );
  }
  function openaiOk(text) {
    return new Response(
      JSON.stringify({ choices: [{ message: { content: text } }] }),
      { status: 200 },
    );
  }

  it("tries providers in DEFAULT_ORDER (gemini → anthropic → openai)", async () => {
    process.env.GEMINI_API_KEY = "gem-key";
    process.env.AI_API_KEY = "ant-key";
    process.env.OPENAI_API_KEY = "oai-key";

    fetchMock.mockResolvedValue(geminiOk("hello"));
    const { runChain } = await load();
    const r = await runChain([{ role: "user", content: "hi" }]);
    expect(r.ok).toBe(true);
    // First provider in the chain is gemini
    expect(r.provider).toBe(DEFAULT_ORDER[0]);
    expect(r.text).toBe("hello");
  });

  it("skips providers with no API key", async () => {
    process.env.AI_API_KEY = "ant-key"; // only anthropic configured
    fetchMock.mockResolvedValue(anthropicOk("from-anthropic"));
    const { runChain } = await load();
    const r = await runChain([{ role: "user", content: "hi" }]);
    expect(r.ok).toBe(true);
    expect(r.provider).toBe("anthropic");
    // gemini is logged as skipped (no key) — it's the first in DEFAULT_ORDER
    expect(r.attempts.find((a) => a.provider === "gemini")?.skipped).toBe("no-key");
    // openai was never tried (chain short-circuits on anthropic success)
    expect(r.attempts.find((a) => a.provider === "openai")).toBeUndefined();
  });

  it("when NO provider has a key, all three are logged as skipped (no early return)", async () => {
    // No env keys set
    const { runChain } = await load();
    const r = await runChain([{ role: "user", content: "hi" }]);
    expect(r.ok).toBe(false);
    expect(r.attempts.length).toBe(3);
    expect(r.attempts.every((a) => a.skipped === "no-key")).toBe(true);
  });

  it("first success short-circuits the chain", async () => {
    process.env.GEMINI_API_KEY = "gem-key";
    process.env.AI_API_KEY = "ant-key";
    // Gemini fails (500), Anthropic succeeds — must NOT call openai
    fetchMock
      .mockResolvedValueOnce(new Response("oops", { status: 500 }))
      .mockResolvedValueOnce(anthropicOk("anthropic wins"));

    const { runChain } = await load();
    const r = await runChain([{ role: "user", content: "hi" }]);
    expect(r.ok).toBe(true);
    expect(r.provider).toBe("anthropic");
    // openai was never tried
    expect(r.attempts.find((a) => a.provider === "openai")).toBeUndefined();
  });

  it("provider-error continues the chain (does not throw)", async () => {
    process.env.GEMINI_API_KEY = "gem-key";
    process.env.AI_API_KEY = "ant-key";
    // First fetch: gemini returns 503
    // Second fetch: anthropic returns 200
    fetchMock
      .mockResolvedValueOnce(new Response("overloaded", { status: 503 }))
      .mockResolvedValueOnce(anthropicOk("fallback"));
    const { runChain } = await load();
    const r = await runChain([{ role: "user", content: "hi" }]);
    expect(r.ok).toBe(true);
    expect(r.provider).toBe("anthropic");
    expect(r.attempts.find((a) => a.provider === "gemini")?.status).toBe(503);
  });

  it("returns ok:false with all attempts logged when every provider fails", async () => {
    process.env.GEMINI_API_KEY = "gem-key";
    process.env.AI_API_KEY = "ant-key";
    process.env.OPENAI_API_KEY = "oai-key";
    fetchMock.mockResolvedValue(new Response("server error", { status: 500 }));
    const { runChain } = await load();
    const r = await runChain([{ role: "user", content: "hi" }]);
    expect(r.ok).toBe(false);
    expect(r.attempts.length).toBe(3);
    expect(r.error).toMatch(/All AI providers failed/);
  });

  it("returns ok:false with empty attempts when no provider has a key", async () => {
    // No env keys set
    const { runChain } = await load();
    const r = await runChain([{ role: "user", content: "hi" }]);
    expect(r.ok).toBe(false);
    expect(r.attempts.every((a) => a.skipped === "no-key")).toBe(true);
  });

  it("skips providers marked enabled:false in admin config (C-05)", async () => {
    process.env.GEMINI_API_KEY = "gem-key";
    process.env.AI_API_KEY = "ant-key";
    // Stub Supabase fetch + admin-ai-config load
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "service-key";
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              value: {
                order: ["anthropic"],
                enabled: { gemini: false, anthropic: true, openai: true },
              },
            },
          ]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(anthropicOk("anthropic-ok"));
    const { runChain, loadAiConfig } = await load();
    const cfg = await loadAiConfig();
    expect(cfg.order).toEqual(["anthropic"]);
    const r = await runChain([{ role: "user", content: "hi" }]);
    expect(r.ok).toBe(true);
    expect(r.provider).toBe("anthropic");
  });
});

describe("loadAiConfig (C-06)", () => {
  it("uses per-provider model from the merged config, not from the client", async () => {
    process.env.GEMINI_API_KEY = "gem-key";
    process.env.GEMINI_MODEL = "gemini-2.0-flash-exp";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "service-key";
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              value: {
                order: ["gemini"],
                models: { gemini: "gemini-1.5-flash" },
                enabled: { gemini: true, anthropic: false, openai: false },
              },
            },
          ]),
          { status: 200 },
        ),
      )
      // The actual chain call uses the Supabase model
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }),
          { status: 200 },
        ),
      );

    const { loadAiConfig, runChain } = await load();
    const cfg = await loadAiConfig();
    expect(cfg.models.gemini).toBe("gemini-1.5-flash"); // Supabase config wins
    // The client may pass its own model; the chain ignores it.
    const r = await runChain([{ role: "user", content: "hi" }], /* clientMaxTokens */ 999);
    expect(r.ok).toBe(true);
    expect(r.model).toBe("gemini-1.5-flash");
  });

  it("falls back to env config when Supabase is unconfigured", async () => {
    process.env.GEMINI_API_KEY = "gem-key";
    process.env.AI_PROVIDER_ORDER = "anthropic,gemini";
    // No Supabase env
    const { loadAiConfig } = await load();
    const cfg = await loadAiConfig();
    expect(cfg.order).toEqual(["anthropic", "gemini"]);
  });
});
