// netlify/functions/lib/aiProviders.test.js
// C-33 — runChain tries providers in order; skips disabled; skips missing-key;
// 502 when all fail. C-06 also tested: per-provider model from config.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ORDER, loadAiConfig, runChain, resolvePillarChain, resolveProvider } from "../functions/lib/aiProviders.js";

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

describe("per-pillar chain overrides (discoverability / citation sampling)", () => {
  it("resolvePillarChain falls back to the global chain when no override exists", async () => {
    const { loadAiConfig, resolvePillarChain: rpc } = await load();
    const cfg = await loadAiConfig();
    const resolved = rpc(cfg, "discoverability");
    expect(resolved.order).toEqual(cfg.order);
    expect(resolved.models).toEqual(cfg.models);
    expect(resolved.enabled).toEqual(cfg.enabled);
  });

  it("resolvePillarChain merges a partial override field-by-field, not all-or-nothing", async () => {
    const { loadAiConfig, resolvePillarChain: rpc } = await load();
    const cfg = await loadAiConfig();
    cfg.pillars = { discoverability: { order: ["perplexity", "gemini"] } }; // no models/enabled override
    const resolved = rpc(cfg, "discoverability");
    expect(resolved.order).toEqual(["perplexity", "gemini"]);
    // models/enabled fell back to the global maps untouched
    expect(resolved.models).toEqual(cfg.models);
    expect(resolved.enabled).toEqual(cfg.enabled);
  });

  it("runChain honours a pillar's own order over the global default", async () => {
    process.env.GEMINI_API_KEY = "gem-key";
    process.env.PERPLEXITY_API_KEY = "px-key";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "service-key";
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([{
            value: {
              order: ["gemini"],
              pillars: { discoverability: { order: ["perplexity"] } },
            },
          }]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: "px-answer" } }] }), { status: 200 }),
      );
    const { runChain } = await load();
    const r = await runChain([{ role: "user", content: "hi" }], 300, { pillar: "discoverability" });
    expect(r.ok).toBe(true);
    expect(r.provider).toBe("perplexity");
    expect(r.text).toBe("px-answer");
  });

  it("runChain with no pillar option is unaffected by a pillar override", async () => {
    process.env.GEMINI_API_KEY = "gem-key";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "service-key";
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([{
            value: {
              order: ["gemini"],
              pillars: { discoverability: { order: ["perplexity"] } },
            },
          }]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "gem-answer" }] } }] }), { status: 200 }),
      );
    const { runChain } = await load();
    const r = await runChain([{ role: "user", content: "hi" }]);
    expect(r.ok).toBe(true);
    expect(r.provider).toBe("gemini");
  });

  it("resolveProvider returns the pillar-resolved model and key presence for a provider", async () => {
    process.env.PERPLEXITY_API_KEY = "px-key";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "service-key";
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify([{
          value: { pillars: { discoverability: { models: { perplexity: "sonar-pro" } } } },
        }]),
        { status: 200 },
      ),
    );
    const { resolveProvider: rp } = await load();
    const info = await rp("perplexity", "discoverability");
    expect(info.model).toBe("sonar-pro");
    expect(info.apiKey).toBe("px-key");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The two live failures on /admin/ai, 2026-09-03. Both keys were valid and
// both accounts were funded:
//
//   OpenAI  "Unsupported parameter: 'max_tokens' is not supported with this
//            model. Use 'max_completion_tokens' instead."
//   Gemini  "Gemini returned no text (MAX_TOKENS)"  ← after 772ms, on a
//            16-token ping, i.e. the reasoning pass ate the whole budget.
//
// Neither is a provider problem, and the console reported both as "the
// provider rejected the request" — the same words a real outage would get.
// ─────────────────────────────────────────────────────────────────────────────

/** Read the JSON body of the Nth fetch call. */
function bodyOf(call) {
  return JSON.parse(call[1].body);
}

describe("OpenAI output-budget parameter", () => {
  const openaiOk = (text) =>
    new Response(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: "stop" }] }), { status: 200 });

  it("sends max_completion_tokens, never the deprecated max_tokens", async () => {
    process.env.OPENAI_API_KEY = "oai-key";
    fetchMock.mockResolvedValue(openaiOk("hi"));
    const { runChain } = await load();
    const r = await runChain([{ role: "user", content: "hi" }], 512);
    expect(r.ok).toBe(true);
    const body = bodyOf(fetchMock.mock.calls[0]);
    expect(body.max_completion_tokens).toBe(512);
    expect(body).not.toHaveProperty("max_tokens");
  });

  it("retries with max_tokens if a deployment rejects the new name", async () => {
    process.env.OPENAI_API_KEY = "oai-key";
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { message: "Unrecognized request argument supplied: max_completion_tokens", param: "max_completion_tokens" },
      }), { status: 400 }))
      .mockResolvedValueOnce(openaiOk("legacy-ok"));
    const { runChain } = await load();
    const r = await runChain([{ role: "user", content: "hi" }], 64);
    expect(r.ok).toBe(true);
    expect(r.text).toBe("legacy-ok");
    expect(bodyOf(fetchMock.mock.calls[1]).max_tokens).toBe(64);
  });

  it("does NOT retry a 400 that is about something else", async () => {
    process.env.OPENAI_API_KEY = "oai-key";
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      error: { message: "Invalid schema for response_format" },
    }), { status: 400 }));
    const { runChain } = await load();
    const r = await runChain([{ role: "user", content: "hi" }], 64);
    expect(r.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports an empty answer with finish_reason 'length' as a truncation, not a rejection", async () => {
    process.env.OPENAI_API_KEY = "oai-key";
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "" }, finish_reason: "length" }],
    }), { status: 200 }));
    const { runChain } = await load();
    const r = await runChain([{ role: "user", content: "hi" }], 16);
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe("truncated");
  });
});

describe("Gemini thinking budget", () => {
  const geminiOk = (text) =>
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
  const geminiMaxTokens = () =>
    new Response(JSON.stringify({
      candidates: [{ content: { parts: [] }, finishReason: "MAX_TOKENS" }],
      usageMetadata: { thoughtsTokenCount: 16 },
    }), { status: 200 });

  it("turns thinking OFF for a small answer on a family that allows it", async () => {
    process.env.GEMINI_API_KEY = "gem-key";
    process.env.GEMINI_MODEL = "gemini-2.5-flash";
    fetchMock.mockResolvedValue(geminiOk("ok"));
    const { runChain } = await load();
    await runChain([{ role: "user", content: "hi" }], 64);
    const cfg = bodyOf(fetchMock.mock.calls[0]).generationConfig;
    expect(cfg.thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(cfg.maxOutputTokens).toBe(64);
    delete process.env.GEMINI_MODEL;
  });

  it("RESERVES the thinking budget on top of the caller's, never out of it", async () => {
    process.env.GEMINI_API_KEY = "gem-key";
    process.env.GEMINI_MODEL = "gemini-2.5-pro"; // cannot disable thinking at all
    fetchMock.mockResolvedValue(geminiOk("ok"));
    const { runChain } = await load();
    await runChain([{ role: "user", content: "hi" }], 1000);
    const cfg = bodyOf(fetchMock.mock.calls[0]).generationConfig;
    expect(cfg.thinkingConfig.thinkingBudget).toBe(1000);
    // The caller asked for 1000 tokens of ANSWER — so the request must allow
    // for the reasoning pass as well, or the answer is what gets cut.
    expect(cfg.maxOutputTokens).toBe(2000);
    delete process.env.GEMINI_MODEL;
  });

  it("sends no thinkingConfig to a pre-2.5 model, which would 400 on it", async () => {
    process.env.GEMINI_API_KEY = "gem-key";
    process.env.GEMINI_MODEL = "gemini-2.0-flash";
    fetchMock.mockResolvedValue(geminiOk("ok"));
    const { runChain } = await load();
    await runChain([{ role: "user", content: "hi" }], 64);
    const cfg = bodyOf(fetchMock.mock.calls[0]).generationConfig;
    expect(cfg).not.toHaveProperty("thinkingConfig");
    expect(cfg.maxOutputTokens).toBe(64);
    delete process.env.GEMINI_MODEL;
  });

  it("still reserves headroom for a model id it has never seen", async () => {
    process.env.GEMINI_API_KEY = "gem-key";
    process.env.GEMINI_MODEL = "gemini-9-ultra-preview";
    fetchMock.mockResolvedValue(geminiOk("ok"));
    const { runChain } = await load();
    await runChain([{ role: "user", content: "hi" }], 64);
    const cfg = bodyOf(fetchMock.mock.calls[0]).generationConfig;
    expect(cfg).not.toHaveProperty("thinkingConfig");
    expect(cfg.maxOutputTokens).toBeGreaterThan(64);
    delete process.env.GEMINI_MODEL;
  });

  it("classifies a MAX_TOKENS empty reply as a truncation", async () => {
    process.env.GEMINI_API_KEY = "gem-key";
    fetchMock.mockResolvedValue(geminiMaxTokens());
    const { runChain } = await load();
    const r = await runChain([{ role: "user", content: "hi" }], 16);
    expect(r.ok).toBe(false);
    expect(r.attempts[0].code).toBe("truncated");
    expect(r.attempts[0].error).toMatch(/output budget/i);
  });
});

describe("pingProvider (the /admin/ai Test button)", () => {
  it("retries once with a bigger budget and reports a reasoning model as WORKING", async () => {
    process.env.GEMINI_API_KEY = "gem-key";
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ content: { parts: [] }, finishReason: "MAX_TOKENS" }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: "ok" }] } }] }), { status: 200 }));
    const { pingProvider, PING_TOKENS, PING_RETRY_TOKENS } = await load();
    const r = await pingProvider("gemini");
    expect(r.ok).toBe(true);
    expect(r.code).toBe("ok");
    expect(r.note).toMatch(/reasons before answering/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The retry must actually raise the budget, not just repeat the call.
    const first = bodyOf(fetchMock.mock.calls[0]).generationConfig.maxOutputTokens;
    const second = bodyOf(fetchMock.mock.calls[1]).generationConfig.maxOutputTokens;
    expect(first).toBeLessThan(second);
    expect(PING_RETRY_TOKENS).toBeGreaterThan(PING_TOKENS);
  });

  it("does not retry a real failure — a dead key is still reported dead", async () => {
    process.env.OPENAI_API_KEY = "oai-key";
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      error: { message: "You have no credits remaining" },
    }), { status: 429 }));
    const { pingProvider } = await load();
    const r = await pingProvider("openai");
    expect(r.ok).toBe(false);
    expect(r.code).toBe("no_credit");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up honestly if even the larger budget produces no text", async () => {
    process.env.GEMINI_API_KEY = "gem-key";
    // A fresh Response per call — a body can only be read once.
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [] }, finishReason: "MAX_TOKENS" }],
    }), { status: 200 }));
    const { pingProvider } = await load();
    const r = await pingProvider("gemini");
    expect(r.ok).toBe(false);
    expect(r.code).toBe("truncated");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
