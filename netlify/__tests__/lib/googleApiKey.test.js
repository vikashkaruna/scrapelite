// googleApiKey.test.js — Google's two key formats, and the response you get
// for using the wrong one.
//
// From a live /admin/ai run: PAGESPEED_API_KEY held `AQ.A…bWeQ` (53 chars) —
// the same shape as the account's working GEMINI_API_KEY — and PageSpeed
// answered "API keys are not supported by this API. Expected OAuth2 access
// token...". The console rendered the generic "Key rejected — reissue it",
// which is the wrong instruction: the key was valid, just not the KIND of
// Google credential this API takes.

import { describe, it, expect } from "vitest";
import {
  googleKeyKind, isCredentialKindRejection, isCredentialRejection, pageSpeedKeyAdvice,
} from "../../functions/lib/googleApiKey.js";

const CLOUD = "AIzaSyD_examplekey_0123456789abcdefg";
const AI_STUDIO = "AQ.Ab8RN6IEXAMPLEexampleEXAMPLEexample_bWeQ";

describe("telling the two formats apart", () => {
  it("recognises a Cloud console API key", () => {
    expect(googleKeyKind(CLOUD)).toBe("cloud");
  });

  it("recognises an AI Studio auth key — the one that belongs in GEMINI_API_KEY", () => {
    expect(googleKeyKind(AI_STUDIO)).toBe("ai_studio");
  });

  it("recognises an OAuth access token, which is not a key at all", () => {
    expect(googleKeyKind("ya29.a0AfB_examples")).toBe("oauth");
  });

  it("reports an unset key as none, never as broken", () => {
    expect(googleKeyKind("")).toBe("none");
    expect(googleKeyKind(undefined)).toBe("none");
    expect(pageSpeedKeyAdvice("")).toBeNull();
  });
});

describe("the advice names the actual remedy", () => {
  it("says nothing when the key is the right shape", () => {
    expect(pageSpeedKeyAdvice(CLOUD)).toBeNull();
  });

  it("tells the operator to mint a Cloud key, not to reissue this one", () => {
    const advice = pageSpeedKeyAdvice(AI_STUDIO);
    expect(advice).toMatch(/AIza/);
    expect(advice).toMatch(/PageSpeed Insights API/);
    // The wrong instruction is the one this whole module exists to replace.
    expect(advice).not.toMatch(/reissue/i);
  });

  it("warns about an unrecognised value rather than staying silent", () => {
    expect(pageSpeedKeyAdvice("jina_abcdef")).toMatch(/AIza/);
  });
});

describe("classifying Google's refusals", () => {
  const kindRejection = { error: { message: "API keys are not supported by this API. Expected OAuth2 access token or other authentication credentials that assert a principal. See https://cloud.google.com/docs/authentication" } };

  it("identifies a wrong-KIND rejection", () => {
    expect(isCredentialKindRejection(403, kindRejection)).toBe(true);
    expect(isCredentialRejection(403, kindRejection)).toBe(true);
  });

  it("identifies an ordinary invalid key too — both are worth a keyless retry", () => {
    expect(isCredentialRejection(400, { error: { message: "API key not valid. Please pass a valid API key." } })).toBe(true);
    expect(isCredentialKindRejection(400, { error: { message: "API key not valid. Please pass a valid API key." } })).toBe(false);
  });

  it("does NOT treat a quota error as a credential problem", () => {
    // Retrying keyless would hit the same per-IP limit and waste the budget.
    expect(isCredentialRejection(429, { error: { message: "Quota exceeded for quota metric 'Queries'" } })).toBe(false);
  });

  it("does NOT treat a 500 or a timeout as a credential problem", () => {
    expect(isCredentialRejection(500, { error: { message: "Internal error" } })).toBe(false);
    expect(isCredentialRejection(0, {})).toBe(false);
  });
});
