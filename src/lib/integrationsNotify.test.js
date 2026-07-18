// src/lib/integrationsNotify.test.js — F18 (Airtable/Notion waitlist).

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  notifyMeWhenAvailable,
  isWaitlisted,
  getWaitlistedIntegrations,
  _internal,
} from "./integrationsNotify.js";

vi.mock("./emailCaptureService.js", () => ({
  captureEmail: vi.fn(async () => ({ ok: true })),
}));

beforeEach(() => {
  try { localStorage.removeItem("datiq.integrationWaitlist"); } catch {}
});

describe("integrationsNotify (F18)", () => {
  it("rejects an invalid email", async () => {
    await expect(notifyMeWhenAvailable("airtable", "not-an-email"))
      .rejects.toThrow(/Valid email/);
  });

  it("rejects an unknown slug", async () => {
    await expect(notifyMeWhenAvailable("unknown", "you@x.com"))
      .rejects.toThrow(/Unknown integration/);
  });

  it("persists the waitlist entry and reports success", async () => {
    const r = await notifyMeWhenAvailable("airtable", "you@x.com");
    expect(r.ok).toBe(true);
    expect(r.slug).toBe("airtable");
    expect(isWaitlisted("airtable")).toBe(true);
  });

  it("isWaitlisted returns false for slugs not in the waitlist", () => {
    expect(isWaitlisted("notion")).toBe(false);
  });

  it("getWaitlistedIntegrations returns the set of all waitlisted slugs", async () => {
    await notifyMeWhenAvailable("airtable", "a@x.com");
    await notifyMeWhenAvailable("notion", "b@x.com");
    const set = getWaitlistedIntegrations();
    expect(set.has("airtable")).toBe(true);
    expect(set.has("notion")).toBe(true);
    expect(set.has("slack")).toBe(false);
  });

  it("exports the supported slugs", () => {
    expect(_internal.NOTIFY_SOURCES.airtable).toBe("Airtable");
    expect(_internal.NOTIFY_SOURCES.notion).toBe("Notion");
  });
});
