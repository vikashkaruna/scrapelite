// emptyEnrichmentMessage — an empty enrichment tab has to say WHICH empty.
//
// Before this, every cause rendered "No data returned for this capability":
// a server with no AI key set, a provider outage, and a page that genuinely
// has no pricing table all looked identical. Only the first is actionable,
// and it was the most likely cause in a fresh deployment — so the one message
// that mattered was the one nobody could see.
import { describe, it, expect } from "vitest";
import { emptyEnrichmentMessage } from "./Preview.jsx";

describe("emptyEnrichmentMessage", () => {
  it("names the env vars an operator must set when AI is unconfigured", () => {
    const msg = emptyEnrichmentMessage("ai_not_configured");
    expect(msg).toMatch(/GEMINI_API_KEY/);
    expect(msg).toMatch(/AI_API_KEY/);
    expect(msg).toMatch(/OPENAI_API_KEY/);
  });

  it("suggests retrying when the provider was unreachable", () => {
    expect(emptyEnrichmentMessage("ai_chain_failed")).toMatch(/try refresh/i);
  });

  it("says the page was read but had nothing, for a genuine no-match", () => {
    const msg = emptyEnrichmentMessage("no_match");
    expect(msg).toMatch(/found nothing/i);
    // Must NOT send the user hunting for a configuration problem.
    expect(msg).not.toMatch(/API_KEY/);
  });

  it("falls back to the original wording for entries saved before this shipped", () => {
    // Enrichments persisted per-URL in localStorage carry no `reason`.
    expect(emptyEnrichmentMessage(undefined)).toBe("No data returned for this capability.");
    expect(emptyEnrichmentMessage(null)).toBe("No data returned for this capability.");
    expect(emptyEnrichmentMessage("something-unrecognised")).toBe(
      "No data returned for this capability.",
    );
  });

  it("gives every known reason a distinct message", () => {
    const msgs = ["ai_not_configured", "ai_chain_failed", "no_match", undefined].map(
      emptyEnrichmentMessage,
    );
    expect(new Set(msgs).size).toBe(msgs.length);
  });
});
