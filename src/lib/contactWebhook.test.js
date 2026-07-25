// contactWebhook.test.js — the parallel, best-effort CRM webhook.
//
// This path is scaffolding for a pipeline that isn't built yet. The contract
// these tests lock down is: it never throws, never blocks, and always emits the
// same envelope shape so the future consumer doesn't need a code change here.

import { describe, expect, it, vi } from "vitest";
import {
  CONTACT_WEBHOOK_EVENT,
  buildContactWebhookPayload,
  notifyContactWebhook,
} from "./contactWebhook.js";

const SUBMISSION = {
  type: "privacy",
  inbox: "admin",
  routeTo: "admin@datiq.app",
  name: "Alice",
  email: "alice@example.com",
  subject: "Erasure request",
  message: "Please delete my data.",
};

describe("contactWebhook — payload contract", () => {
  it("emits the stable event envelope", () => {
    const payload = buildContactWebhookPayload(SUBMISSION, 1_700_000_000_000);
    expect(payload.event).toBe(CONTACT_WEBHOOK_EVENT);
    expect(payload.event).toBe("contact.submitted");
    expect(payload.sent_at).toBe(new Date(1_700_000_000_000).toISOString());
    expect(payload.data).toEqual({
      type: "privacy",
      inbox: "admin",
      route_to: "admin@datiq.app",
      name: "Alice",
      email: "alice@example.com",
      subject: "Erasure request",
      message: "Please delete my data.",
      source: "contact-form",
    });
  });

  it("defaults every field rather than emitting undefined", () => {
    const { data } = buildContactWebhookPayload({}, 0);
    expect(Object.values(data).every((v) => v !== undefined)).toBe(true);
    expect(data.source).toBe("contact-form");
  });

  it("tolerates a null submission", () => {
    expect(() => buildContactWebhookPayload(null, 0)).not.toThrow();
  });

  it("honours an explicit source", () => {
    const { data } = buildContactWebhookPayload({ ...SUBMISSION, source: "pricing-page" }, 0);
    expect(data.source).toBe("pricing-page");
  });
});

describe("contactWebhook — notifyContactWebhook", () => {
  it("POSTs the envelope to the configured URL", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve({ ok: true }));
    const res = await notifyContactWebhook(SUBMISSION, {
      url: "https://hooks.example.com/contact", fetchImpl,
    });

    expect(res).toEqual({ delivered: true });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://hooks.example.com/contact");
    expect(init.method).toBe("POST");
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(init.body).event).toBe("contact.submitted");
  });

  it("skips cleanly when no endpoint is configured yet", async () => {
    const fetchImpl = vi.fn();
    const res = await notifyContactWebhook(SUBMISSION, { url: "", fetchImpl });
    expect(res).toEqual({ delivered: false, skipped: true, reason: "not-configured" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("resolves — never rejects — when the network fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = vi.fn(() => Promise.reject(new Error("ECONNREFUSED")));
    const res = await notifyContactWebhook(SUBMISSION, {
      url: "https://hooks.example.com/contact", fetchImpl,
    });
    expect(res).toEqual({ delivered: false, reason: "network-error" });
    warn.mockRestore();
  });
});
