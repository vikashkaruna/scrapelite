// src/lib/consentService.test.js — analytics consent contract.

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  CONSENT_KEY, GRANTED, DENIED,
  getConsent, hasChosen, analyticsAllowed, setConsent, clearConsent,
} from "./consentService.js";

vi.mock("./apiClient.js", () => ({
  apiClient: {
    recordConsent: vi.fn().mockResolvedValue({ ok: true }),
    linkConsent: vi.fn().mockResolvedValue({ ok: true, linked: true }),
    withdrawConsent: vi.fn().mockResolvedValue({ ok: true, deleted: 3 }),
  },
}));

beforeEach(() => {
  try { localStorage.clear(); } catch { /* noop */ }
  window.__datiqConsent = { set: vi.fn(), clientId: (cb) => cb("GA1.1.test") };
});

describe("consentService — reading state", () => {
  it("reports no choice when nothing is stored", () => {
    expect(getConsent()).toBeNull();
    expect(hasChosen()).toBe(false);
    expect(analyticsAllowed()).toBe(false);
  });

  it("treats a malformed record as no choice rather than guessing", () => {
    // Guessing wrong in the permissive direction is a compliance failure, so
    // an unreadable record must mean "ask again", never "assume granted".
    localStorage.setItem(CONSENT_KEY, "{not json");
    expect(getConsent()).toBeNull();
    expect(hasChosen()).toBe(false);
  });

  it("treats an unrecognised choice value as no choice", () => {
    localStorage.setItem(CONSENT_KEY, JSON.stringify({ analytics: "maybe" }));
    expect(getConsent()).toBeNull();
  });

  it("distinguishes a stored denial from no choice at all", () => {
    // These must not collapse: "declined" is an answer and must stop the
    // banner returning; "unset" is not.
    setConsent(DENIED);
    expect(hasChosen()).toBe(true);
    expect(analyticsAllowed()).toBe(false);
  });
});

describe("consentService — recording a choice", () => {
  it("persists the choice with a timestamp and policy version", () => {
    const rec = setConsent(GRANTED);
    expect(rec.analytics).toBe(GRANTED);
    expect(rec.policyVersion).toBeTruthy();
    expect(Date.parse(rec.ts)).not.toBeNaN();
    expect(JSON.parse(localStorage.getItem(CONSENT_KEY)).analytics).toBe(GRANTED);
  });

  it("pushes the Consent Mode update through the analytics.js bridge", () => {
    setConsent(GRANTED);
    expect(window.__datiqConsent.set).toHaveBeenCalledWith(GRANTED);
  });

  it("rejects an invalid choice without touching storage", () => {
    expect(setConsent("sure why not")).toBeNull();
    expect(localStorage.getItem(CONSENT_KEY)).toBeNull();
  });

  it("mirrors the choice to the server", async () => {
    const { apiClient } = await import("./apiClient.js");
    setConsent(DENIED, "privacy_page");
    await Promise.resolve();
    expect(apiClient.recordConsent).toHaveBeenCalled();
    const payload = apiClient.recordConsent.mock.calls.at(-1)[0];
    expect(payload.analytics).toBe(DENIED);
    expect(payload.source).toBe("privacy_page");
    // Never sent: the function resolves the user from the JWT. A client that
    // could name its own user_id could forge consent for somebody else.
    expect(payload).not.toHaveProperty("userId");
    expect(payload).not.toHaveProperty("user_id");
  });

  it("still records locally when the server write fails", async () => {
    const { apiClient } = await import("./apiClient.js");
    apiClient.recordConsent.mockRejectedValueOnce(new Error("offline"));
    expect(() => setConsent(GRANTED)).not.toThrow();
    await Promise.resolve();
    expect(analyticsAllowed()).toBe(true);
  });

  it("works when analytics.js is absent entirely", () => {
    // The module must be usable in tests and in a build without the tag.
    delete window.__datiqConsent;
    expect(() => setConsent(GRANTED)).not.toThrow();
    expect(analyticsAllowed()).toBe(true);
  });
});

describe("consentService — changing your mind", () => {
  it("clearConsent re-opens the question without erasing anything", () => {
    setConsent(GRANTED);
    clearConsent();
    expect(hasChosen()).toBe(false);
  });

  it("clearConsent is not the same act as withdrawal", async () => {
    // Re-opening the banner must not delete a user's data as a side effect.
    const { apiClient } = await import("./apiClient.js");
    apiClient.withdrawConsent.mockClear();
    setConsent(GRANTED);
    clearConsent();
    expect(apiClient.withdrawConsent).not.toHaveBeenCalled();
  });
});

describe("consentService — withdrawal", () => {
  it("denies consent and reports how much was erased", async () => {
    const { withdrawAndErase } = await import("./consentService.js");
    const res = await withdrawAndErase();
    expect(res.ok).toBe(true);
    expect(res.deleted).toBe(3);
    // The denial is recorded locally too, so a failed round-trip still leaves
    // the visitor opted out rather than silently still tracked.
    expect(analyticsAllowed()).toBe(false);
  });

  it("surfaces a server failure instead of claiming success", async () => {
    const { apiClient } = await import("./apiClient.js");
    const { withdrawAndErase } = await import("./consentService.js");
    apiClient.withdrawConsent.mockRejectedValueOnce(new Error("boom"));
    const res = await withdrawAndErase();
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/boom/);
    // …but consent is still withdrawn locally.
    expect(analyticsAllowed()).toBe(false);
  });
});
