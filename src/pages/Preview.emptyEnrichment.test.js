// emptyEnrichmentMessage — what an empty enrichment tab may say to a CUSTOMER.
//
// ── TWO WRONG VERSIONS PRECEDED THIS ONE, IN OPPOSITE DIRECTIONS ─────────────
//  1. "No data returned for this capability" for every cause — so a dead
//     provider account and a page with genuinely no pricing table looked
//     identical, and a total AI outage stayed invisible for weeks.
//  2. Then, over-correcting: "The AI provider account is out of credit. An
//     administrator needs to top up billing." True, actionable — and none of a
//     customer's business. It disclosed our billing state, our vendors and our
//     environment variable names to people who could act on none of it.
//
// The rule now: customers get ONE honest generic sentence for anything that is
// our fault; operators get the diagnosis on /admin/ai and /admin/health.
// These tests exist mostly to keep a well-meaning future change from
// reintroducing (2) one code at a time.
import { describe, it, expect } from "vitest";
import { emptyEnrichmentMessage, isEnrichmentOurFault } from "./Preview.jsx";

// Everything an operator can act on and a customer cannot.
const OPERATOR_FAULTS = [
  "ai_not_configured", "ai_chain_failed", "ai_no_credit", "ai_bad_key",
  "ai_rate_limited", "ai_empty_reply", "ai_unparseable",
  // The provider-chain vocabulary reaches this function too, and must be
  // treated identically — it is the same failure described by a different layer.
  "no_credit", "bad_key", "rate_limited", "no_key", "timeout", "network", "provider_down",
];

// Strings that must never reach a customer, in any message, for any code.
const FORBIDDEN = [
  /API_KEY/i, /credit/i, /billing/i, /administrator/i, /reissue/i,
  /gemini/i, /anthropic/i, /openai/i, /perplexity/i, /claude/i,
  /env(ironment)? var/i, /top up/i,
];

describe("customer-facing copy discloses nothing operational", () => {
  it.each(OPERATOR_FAULTS)("says nothing an attacker or a competitor could use: %s", (code) => {
    const msg = emptyEnrichmentMessage(code);
    for (const pattern of FORBIDDEN) {
      expect(msg, `${code} leaked ${pattern}`).not.toMatch(pattern);
    }
  });

  it("gives every operator fault the SAME message", () => {
    // Deliberate. Differentiating them is how internal state leaks back out one
    // well-intentioned code at a time, and none of the distinctions changes
    // what the reader can do.
    const msgs = new Set(OPERATOR_FAULTS.map((c) => emptyEnrichmentMessage(c)));
    expect(msgs.size).toBe(1);
  });

  it("blames us, not the page, and points at a retry", () => {
    const msg = emptyEnrichmentMessage("ai_no_credit");
    expect(msg).toMatch(/our side/i);
    expect(msg).toMatch(/not with your page/i);
    expect(msg).toMatch(/try again/i);
  });

  it("an unknown or missing reason is treated as OUR fault, not the page's", () => {
    // Fail safe: a code we do not recognise is far more likely to be a new
    // infrastructure failure than a new fact about the customer's page, and
    // wrongly telling someone their page is empty is the costlier mistake.
    for (const code of [undefined, null, "", "something-unrecognised"]) {
      expect(isEnrichmentOurFault(code)).toBe(true);
      expect(emptyEnrichmentMessage(code)).toMatch(/our side/i);
    }
  });
});

describe("findings about the page are still specific", () => {
  it("a genuine no-match says what we read, so the claim is checkable", () => {
    const msg = emptyEnrichmentMessage("no_match");
    expect(msg).toMatch(/read this page and the pages it links to/i);
    expect(msg).toMatch(/found nothing/i);
    // Not our fault, so no retry framing and no configuration hunt.
    expect(isEnrichmentOurFault("no_match")).toBe(false);
    expect(msg).not.toMatch(/API_KEY/);
  });

  it("an unreadable page tells the user the one thing THEY can change", () => {
    const msg = emptyEnrichmentMessage("page_no_content");
    expect(msg).toMatch(/JavaScript/i);
    expect(isEnrichmentOurFault("page_no_content")).toBe(false);
  });

  it("names what was being looked for when the caller supplies it", () => {
    expect(emptyEnrichmentMessage("no_match", { what: "pricing" })).toMatch(/pricing/);
  });
});
