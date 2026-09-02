// aiFailureCopy.test.js — the customer/operator boundary.
//
// This file exists because the boundary was crossed twice in opposite
// directions within one week:
//
//   1. Every AI failure rendered "No data returned for this capability", so a
//      total provider outage was indistinguishable from a page that genuinely
//      had no pricing on it — and stayed invisible for weeks.
//   2. The fix for (1) told the customer the truth: "The AI provider account
//      is out of credit. An administrator needs to top up billing." Accurate,
//      actionable, and none of a customer's business — it disclosed our
//      billing state, our vendors and our env var names to people who could
//      act on none of it.
//
// The invariant these tests hold: a customer learns THAT it failed and whose
// fault it is; an operator learns WHY. Nothing in between.
import { describe, it, expect } from "vitest";
import {
  AI_FAILURE, userFacingMessage, operatorMessage, isOperatorFault,
  isTransient, normaliseFailureCode, publicFailureCode, OPERATOR_COPY,
} from "./aiFailureCopy.js";

// Both vocabularies that reach this module: the provider chain's codes and
// the enrichment layer's `ai_`-prefixed reasons.
const CHAIN_CODES = ["no_credit", "bad_key", "rate_limited", "no_key", "bad_model",
  "provider_down", "timeout", "network", "error", "empty"];
const ENRICH_CODES = Object.values(AI_FAILURE);
const ALL = [...CHAIN_CODES, ...ENRICH_CODES, undefined, null, "", "unrecognised-code"];

// Anything that would tell a customer about our infrastructure or our money.
const FORBIDDEN = [
  /API_KEY/i, /credit/i, /billing/i, /administrator/i, /reissue/i, /top up/i,
  /gemini/i, /anthropic/i, /openai/i, /perplexity/i, /claude/i, /firecrawl/i,
  /env(ironment)? var/i, /rate.?limit/i, /quota/i,
];

describe("nothing operational reaches a customer", () => {
  it.each(ALL)("userFacingMessage(%s) discloses nothing", (code) => {
    const msg = userFacingMessage(code);
    expect(typeof msg).toBe("string");
    expect(msg.length).toBeGreaterThan(20);
    for (const pattern of FORBIDDEN) {
      expect(msg, `${code} leaked ${pattern}`).not.toMatch(pattern);
    }
  });

  it.each(ALL)("publicFailureCode(%s) never carries a cause", (code) => {
    const pub = publicFailureCode(code);
    // Only three codes may ever leave the server on a customer-facing body.
    expect([AI_FAILURE.UNAVAILABLE, AI_FAILURE.ABSENT, AI_FAILURE.NO_CONTENT]).toContain(pub);
    for (const pattern of FORBIDDEN) {
      expect(pub, `${code} leaked ${pattern}`).not.toMatch(pattern);
    }
  });

  it("collapses every operator fault to one code AND one message", () => {
    // Deliberate. Differentiating them is how internal state creeps back out
    // one well-meaning code at a time, and none of the distinctions changes
    // what the reader can do about it.
    const faults = [...CHAIN_CODES, AI_FAILURE.NOT_CONFIGURED, AI_FAILURE.NO_CREDIT,
      AI_FAILURE.BAD_KEY, AI_FAILURE.CHAIN_FAILED, AI_FAILURE.UNPARSEABLE];
    expect(new Set(faults.map(publicFailureCode)).size).toBe(1);
    expect(new Set(faults.map((c) => userFacingMessage(c))).size).toBe(1);
  });
});

describe("the operator still gets the diagnosis", () => {
  it("names the exact action for each cause", () => {
    expect(operatorMessage(AI_FAILURE.NO_CREDIT)).toMatch(/top up/i);
    expect(operatorMessage(AI_FAILURE.BAD_KEY)).toMatch(/reissue/i);
    expect(operatorMessage(AI_FAILURE.NOT_CONFIGURED)).toMatch(/GEMINI_API_KEY/);
    // Chain vocabulary resolves to the same operator copy.
    expect(operatorMessage("no_credit")).toBe(operatorMessage(AI_FAILURE.NO_CREDIT));
  });

  it("covers every code in the vocabulary, so no cause reads as 'unknown'", () => {
    for (const code of ENRICH_CODES) expect(OPERATOR_COPY[code], code).toBeTruthy();
  });

  it("says where to look when handed a redacted code", () => {
    expect(operatorMessage(AI_FAILURE.UNAVAILABLE)).toMatch(/admin\/ai|function log/i);
  });
});

describe("normalisation across the two vocabularies", () => {
  it("maps chain codes onto the enrichment vocabulary", () => {
    expect(normaliseFailureCode("no_credit")).toBe(AI_FAILURE.NO_CREDIT);
    expect(normaliseFailureCode("no_key")).toBe(AI_FAILURE.NOT_CONFIGURED);
    expect(normaliseFailureCode("timeout")).toBe(AI_FAILURE.CHAIN_FAILED);
  });

  it("passes an already-normalised code through untouched", () => {
    for (const code of ENRICH_CODES) expect(normaliseFailureCode(code)).toBe(code);
  });

  // The asymmetry that matters: wrongly telling someone their page is empty is
  // the costlier mistake, and is exactly how the original outage stayed hidden.
  it("FAILS SAFE — an unknown code is our fault, not the page's", () => {
    for (const code of [undefined, null, "", "brand-new-failure-mode"]) {
      expect(normaliseFailureCode(code)).toBe(AI_FAILURE.CHAIN_FAILED);
      expect(isOperatorFault(code)).toBe(true);
      expect(userFacingMessage(code)).toMatch(/our side/i);
    }
  });
});

describe("findings about the page stay specific", () => {
  it("no_match is not our fault and says what we read", () => {
    expect(isOperatorFault(AI_FAILURE.ABSENT)).toBe(false);
    expect(publicFailureCode(AI_FAILURE.ABSENT)).toBe(AI_FAILURE.ABSENT);
    expect(userFacingMessage(AI_FAILURE.ABSENT)).toMatch(/pages it links to/i);
  });

  it("page_no_content tells the user the one thing THEY can change", () => {
    expect(isOperatorFault(AI_FAILURE.NO_CONTENT)).toBe(false);
    expect(userFacingMessage(AI_FAILURE.NO_CONTENT)).toMatch(/JavaScript/i);
  });

  it("names the capability when the caller supplies one", () => {
    expect(userFacingMessage(AI_FAILURE.ABSENT, { what: "pricing" })).toMatch(/pricing/);
  });

  it("transience is an internal signal, not a distinct customer message", () => {
    expect(isTransient(AI_FAILURE.RATE_LIMITED)).toBe(true);
    expect(isTransient(AI_FAILURE.NO_CREDIT)).toBe(false);
    // …but both read identically to the customer.
    expect(userFacingMessage(AI_FAILURE.RATE_LIMITED))
      .toBe(userFacingMessage(AI_FAILURE.NO_CREDIT));
  });
});
