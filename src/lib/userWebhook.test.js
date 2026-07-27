// userWebhook.test.js — coverage for per-user webhook URL storage.
//
// U-44 — per-user webhook URL:
//   1. Validation accepts http(s) URLs only
//   2. localStorage round-trip works
//   3. getUserWebhookUrl() returns null for unset / invalid
//   4. setUserWebhookUrl() throws on invalid input (UI catches + shows)
//   5. clearUserWebhookUrl() removes the key

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isValidWebhookUrl,
  getUserWebhookUrl,
  setUserWebhookUrl,
  clearUserWebhookUrl,
  STORAGE_KEY,
} from "./userWebhook.js";

function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
    _map: map,
  };
}

let storage;
beforeEach(() => { storage = makeStorage(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("isValidWebhookUrl", () => {
  it("accepts an https URL", () => {
    expect(isValidWebhookUrl("https://hooks.zapier.com/abc")).toBe(true);
  });
  it("accepts an http URL (private networks, n8n localhost via tunnel)", () => {
    expect(isValidWebhookUrl("http://10.0.0.5:5678/webhook/test")).toBe(true);
  });
  it("trims whitespace before validating", () => {
    expect(isValidWebhookUrl("  https://x.com/y  ")).toBe(true);
  });
  it("rejects javascript: protocol (XSS guard)", () => {
    expect(isValidWebhookUrl("javascript:alert(1)")).toBe(false);
  });
  it("rejects data: protocol", () => {
    expect(isValidWebhookUrl("data:text/html,foo")).toBe(false);
  });
  it("rejects ftp: protocol", () => {
    expect(isValidWebhookUrl("ftp://x.com/y")).toBe(false);
  });
  it("rejects relative URLs", () => {
    expect(isValidWebhookUrl("/api/hook")).toBe(false);
    expect(isValidWebhookUrl("hooks/x")).toBe(false);
  });
  it("rejects empty string", () => {
    expect(isValidWebhookUrl("")).toBe(false);
    expect(isValidWebhookUrl("   ")).toBe(false);
  });
  it("rejects non-strings", () => {
    expect(isValidWebhookUrl(undefined)).toBe(false);
    expect(isValidWebhookUrl(null)).toBe(false);
    expect(isValidWebhookUrl(42)).toBe(false);
    expect(isValidWebhookUrl({})).toBe(false);
  });
  it("rejects malformed strings", () => {
    expect(isValidWebhookUrl("not a url at all")).toBe(false);
    expect(isValidWebhookUrl("https//missing-colon.com")).toBe(false);
  });
  it("rejects URLs whose hostname is just a dot (pathological)", () => {
    // The URL constructor is lenient; the only "no real hostname" case
    // it surfaces is the pathological "https://./path" form, where
    // hostname is literally ".". Anything else with a parseable host
    // is let through — operators can detect a bad URL at fetch time.
    expect(isValidWebhookUrl("https://./path")).toBe(false);
  });
});

describe("localStorage round-trip", () => {
  it("stores and reads back the URL", () => {
    setUserWebhookUrl("https://hooks.zapier.com/abc", storage);
    expect(storage.getItem(STORAGE_KEY)).toBe("https://hooks.zapier.com/abc");
    expect(getUserWebhookUrl(storage)).toBe("https://hooks.zapier.com/abc");
  });
  it("trims whitespace on save", () => {
    setUserWebhookUrl("  https://x.com/y  ", storage);
    expect(storage.getItem(STORAGE_KEY)).toBe("https://x.com/y");
  });
  it("returns null when unset", () => {
    expect(getUserWebhookUrl(storage)).toBeNull();
  });
  it("returns null when the stored value is invalid (corrupt or tampered)", () => {
    storage.setItem(STORAGE_KEY, "javascript:alert(1)");
    expect(getUserWebhookUrl(storage)).toBeNull();
  });
  it("clearUserWebhookUrl removes the key", () => {
    setUserWebhookUrl("https://x.com/y", storage);
    expect(getUserWebhookUrl(storage)).toBe("https://x.com/y");
    clearUserWebhookUrl(storage);
    expect(getUserWebhookUrl(storage)).toBeNull();
  });
  it("setUserWebhookUrl(null) clears the key", () => {
    setUserWebhookUrl("https://x.com/y", storage);
    setUserWebhookUrl(null, storage);
    expect(getUserWebhookUrl(storage)).toBeNull();
  });
  it("setUserWebhookUrl('') clears the key (treat empty as 'unset')", () => {
    setUserWebhookUrl("https://x.com/y", storage);
    setUserWebhookUrl("", storage);
    expect(getUserWebhookUrl(storage)).toBeNull();
  });
});

describe("error handling", () => {
  it("setUserWebhookUrl throws on invalid URL", () => {
    expect(() => setUserWebhookUrl("not a url", storage)).toThrow(/not a valid http/);
  });
  it("setUserWebhookUrl throws on javascript: protocol", () => {
    expect(() => setUserWebhookUrl("javascript:alert(1)", storage)).toThrow(/not a valid http/);
  });
  it("getUserWebhookUrl returns null when storage is null (SSR or no localStorage)", () => {
    expect(getUserWebhookUrl(null)).toBeNull();
  });
  it("setUserWebhookUrl throws when storage is null", () => {
    expect(() => setUserWebhookUrl("https://x.com", null)).toThrow(/no storage/);
  });
});
