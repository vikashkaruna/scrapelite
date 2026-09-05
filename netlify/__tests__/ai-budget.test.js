// C-05b — /api/ai wall-clock budget.
//
// Regression cover for the template-run 504. `runChain` is a serial fallback
// over three providers and this endpoint passed it no signal, so its cost was
// unbounded on a function Netlify kills at 10s. The platform then answered with
// an HTML error page rather than JSON, and apiClient fell through to the
// generic "(504) problem on our side" copy — observed against notion.so AND
// our own prerendered datiq.app, which is what ruled out a slow scrape.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let fetchMock;

beforeEach(() => {
  for (const k of ["GEMINI_API_KEY", "AI_API_KEY", "OPENAI_API_KEY", "VITE_AI_API_KEY",
                   "SUPABASE_URL", "SUPABASE_SERVICE_KEY", "AI_BUDGET_MS"]) delete process.env[k];
  vi.resetModules();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const load = async () => (await import("../functions/ai.js")).handler;

const post = (h) => h({
  httpMethod: "POST",
  body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
});

describe("/api/ai — wall-clock budget", () => {
  it("a provider that never answers is aborted and reported as OUR limit, not theirs", async () => {
    process.env.GEMINI_API_KEY = "gem";
    process.env.AI_BUDGET_MS = "3000"; // floor; keeps the test quick

    // Hangs until the request is aborted — the pre-fix code had no signal to
    // abort with, so this never settled and the platform killed the function.
    fetchMock.mockImplementation((_url, opts) => new Promise((_res, rej) => {
      opts?.signal?.addEventListener("abort", () =>
        rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }));

    const r = await post(await load());
    const body = JSON.parse(r.body);

    expect(r.statusCode).toBe(504);
    expect(body.code).toBe("ai_timeout");
    // The body must be JSON with a code — an HTML error page is what sent the
    // client to the generic copy in the first place.
    expect(r.headers["Content-Type"]).toContain("application/json");
    // Never blames the caller or their page.
    expect(body.error).toMatch(/limit on our side/i);
    expect(body.error).not.toMatch(/your page|not found|invalid/i);
  }, 10_000);

  it("does not fire the budget when a provider answers in time", async () => {
    process.env.GEMINI_API_KEY = "gem";
    fetchMock.mockResolvedValueOnce(new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: "fast" }] } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));

    const r = await post(await load());
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).content[0].text).toBe("fast");
  });
});
