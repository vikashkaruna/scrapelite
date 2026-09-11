import { describe, it, expect } from "vitest";
import { geminiSearchTool, geminiGroundingCitations } from "../../functions/lib/aiProviders.js";
import { LIVE_ENGINES, isLiveEngine, resolveEngine } from "../../functions/lib/audit/citationSampling.js";

// W6.1 — D4 chose Perplexity + Gemini with Google Search grounding. The
// Perplexity adapter already shipped; grounding did not exist at all, so until
// now a lapsed Perplexity key took every citation metric to `live: false`.

describe("geminiSearchTool", () => {
  it("uses the name each model family actually accepts", () => {
    // ⚠️ The wrong name is REJECTED, not ignored — a 400 on every call, which
    // reads as a bad key rather than a misnamed tool.
    expect(geminiSearchTool("gemini-1.5-flash")).toBe("google_search_retrieval");
    expect(geminiSearchTool("gemini-1.5-pro")).toBe("google_search_retrieval");
    expect(geminiSearchTool("gemini-2.0-flash")).toBe("google_search");
    expect(geminiSearchTool("gemini-2.5-flash")).toBe("google_search");
  });

  it("assumes the current name for an unrecognised model", () => {
    // A model id we have never seen is far more likely to be newer than older.
    expect(geminiSearchTool("gemini-9-ultra")).toBe("google_search");
    expect(geminiSearchTool("")).toBe("google_search");
  });
});

describe("geminiGroundingCitations", () => {
  it("pulls the retrieved sources out of groundingMetadata", () => {
    const data = {
      candidates: [{
        groundingMetadata: {
          groundingChunks: [
            { web: { uri: "https://a.com/x", title: "A" } },
            { web: { uri: "https://b.com/y", title: "B" } },
          ],
        },
      }],
    };
    expect(geminiGroundingCitations(data)).toEqual([
      { url: "https://a.com/x", title: "A" },
      { url: "https://b.com/y", title: "B" },
    ]);
  });

  it("🔴 returns nothing for an answer that was never grounded", () => {
    // Gemini answers from its own weights when Search returns nothing useful,
    // and signals that ONLY by omitting groundingMetadata. Inventing a citation
    // here would credit the open web for something the model merely remembers.
    expect(geminiGroundingCitations({ candidates: [{ content: { parts: [{ text: "hi" }] } }] })).toEqual([]);
    expect(geminiGroundingCitations({})).toEqual([]);
    expect(geminiGroundingCitations(null)).toEqual([]);
  });

  it("skips a chunk with no uri rather than emitting a blank source", () => {
    const data = { candidates: [{ groundingMetadata: { groundingChunks: [{ web: { title: "no uri" } }, { web: { uri: "https://c.com" } }] } }] };
    expect(geminiGroundingCitations(data)).toEqual([{ url: "https://c.com", title: null }]);
  });
});

describe("engine resolution", () => {
  it("counts both retrieval engines as live, and the chain as not", () => {
    expect(LIVE_ENGINES).toEqual(["perplexity", "gemini"]);
    expect(isLiveEngine("perplexity")).toBe(true);
    expect(isLiveEngine("gemini")).toBe(true);
    expect(isLiveEngine("ai-chain")).toBe(false);
  });

  it("prefers Perplexity, where citations are the product not a mode", () => {
    expect(resolveEngine({ PERPLEXITY_API_KEY: "p", GEMINI_API_KEY: "g" })).toBe("perplexity");
  });

  it("🔴 falls to grounded Gemini when Perplexity has no key", () => {
    // The whole reason D4 chose two engines: one lapsed key must degrade the
    // measurement, not blind it.
    expect(resolveEngine({ GEMINI_API_KEY: "g" })).toBe("gemini");
  });

  it("falls to the non-live chain only when neither retrieval key exists", () => {
    expect(resolveEngine({})).toBe("ai-chain");
  });

  it("honours an explicit engine request, and refuses it without a key", () => {
    expect(resolveEngine({ GEMINI_API_KEY: "g" }, "gemini")).toBe("gemini");
    expect(resolveEngine({}, "gemini")).toBeNull();
    expect(resolveEngine({ GEMINI_API_KEY: "g" }, "perplexity")).toBeNull();
    expect(resolveEngine({ PERPLEXITY_API_KEY: "p" }, "none")).toBeNull();
  });
});
