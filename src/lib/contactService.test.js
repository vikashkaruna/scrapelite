// contactService.test.js — /contact submission orchestration.
//
// The rules under test:
//   1. POST /api/contact-email (Resend, server-side) is the primary path — its
//      outcome is what the caller sees.
//   2. The CRM webhook and subscriber capture run in parallel and can NEVER
//      fail or delay a submission.
//   3. Routing metadata always matches the enquiry type's inbox.

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  buildContactPayload,
  buildMailtoFallback,
  submitContactForm,
} from "./contactService.js";

const BASE = {
  type: "support",
  name: "Alice",
  email: "alice@example.com",
  subject: "Cannot export CSV",
  message: "The export button does nothing.",
};

function deps(overrides = {}) {
  return {
    sendContactEmail: vi.fn(() => Promise.resolve({ ok: true, inbox: "hello", routeTo: "hello@datiq.app" })),
    notifyContactWebhook: vi.fn(() => Promise.resolve({ delivered: true })),
    captureEmail: vi.fn(() => Promise.resolve({ ok: true })),
    ...overrides,
  };
}

beforeEach(() => { vi.clearAllMocks(); });

describe("contactService — buildContactPayload", () => {
  it("sends the enquiry type, not a recipient — the server addresses the mail", () => {
    const payload = buildContactPayload(BASE);
    expect(payload.type).toBe("support");
    const serialised = JSON.stringify(payload);
    expect(serialised).not.toContain("@datiq.app");
    expect(payload.to).toBeUndefined();
    expect(payload.routeTo).toBeUndefined();
  });

  it("normalises an unknown type before it leaves the browser", () => {
    expect(buildContactPayload({ ...BASE, type: "refund" }).type).toBe("support");
  });

  it("carries the fields the email body needs", () => {
    const payload = buildContactPayload(BASE);
    expect(payload).toMatchObject({
      name: "Alice",
      email: "alice@example.com",
      subject: "Cannot export CSV",
      message: "The export button does nothing.",
      source: "contact-form",
    });
  });

  it("includes an empty botcheck honeypot", () => {
    expect(buildContactPayload(BASE).botcheck).toBe("");
  });

  it("trims whitespace-only name and subject to empty strings", () => {
    const payload = buildContactPayload({ ...BASE, name: "   ", subject: "  " });
    expect(payload.name).toBe("");
    expect(payload.subject).toBe("");
  });

  it("never emits undefined for a field the user left blank", () => {
    const payload = buildContactPayload({ type: "other" });
    expect(Object.values(payload).every((v) => v !== undefined)).toBe(true);
  });
});

describe("contactService — buildMailtoFallback", () => {
  it("addresses the mailto to the routed inbox", () => {
    expect(buildMailtoFallback({ ...BASE, type: "privacy" }))
      .toMatch(/^mailto:admin@datiq\.app\?/);
    expect(buildMailtoFallback(BASE)).toMatch(/^mailto:hello@datiq\.app\?/);
  });

  it("URL-encodes the subject and body", () => {
    const url = buildMailtoFallback(BASE);
    expect(url).toContain("subject=");
    expect(url).toContain("body=");
    expect(url).not.toContain(" ");
  });
});

describe("contactService — submitContactForm", () => {
  it("posts to the contact endpoint and reports the routed inbox", async () => {
    const d = deps({
      sendContactEmail: vi.fn(() => Promise.resolve({
        ok: true, inbox: "admin", routeTo: "admin@datiq.app",
      })),
    });
    const res = await submitContactForm({ ...BASE, type: "enterprise" }, d);

    expect(res).toEqual({ ok: true, inbox: "admin", routeTo: "admin@datiq.app" });
    expect(d.sendContactEmail).toHaveBeenCalledTimes(1);
    expect(d.sendContactEmail.mock.calls[0][0].type).toBe("enterprise");
  });

  it("reports the server's routing when it differs from the local guess", async () => {
    // The server owns the decision; the client only guesses for optimistic UI.
    const d = deps({
      sendContactEmail: vi.fn(() => Promise.resolve({
        ok: true, inbox: "admin", routeTo: "admin@datiq.app",
      })),
    });
    const res = await submitContactForm({ ...BASE, type: "support" }, d);
    expect(res.routeTo).toBe("admin@datiq.app");
  });

  it("falls back to the local routing when the server omits it", async () => {
    const d = deps({ sendContactEmail: vi.fn(() => Promise.resolve({ ok: true })) });
    const res = await submitContactForm({ ...BASE, type: "legal" }, d);
    expect(res).toEqual({ ok: true, inbox: "admin", routeTo: "admin@datiq.app" });
  });

  it("fires the CRM webhook in parallel with the email", async () => {
    const d = deps();
    await submitContactForm(BASE, d);
    expect(d.notifyContactWebhook).toHaveBeenCalledTimes(1);
    expect(d.notifyContactWebhook.mock.calls[0][0]).toMatchObject({
      type: "support", inbox: "hello", routeTo: "hello@datiq.app",
    });
  });

  it("captures the sender's email for the subscriber list, tagged by type", async () => {
    const d = deps();
    await submitContactForm({ ...BASE, type: "billing" }, d);
    expect(d.captureEmail).toHaveBeenCalledWith("alice@example.com", "contact-form:billing");
  });

  it("starts the side-channels before awaiting the email", async () => {
    const order = [];
    const d = deps({
      notifyContactWebhook: vi.fn(() => { order.push("webhook"); return Promise.resolve(); }),
      captureEmail:         vi.fn(() => { order.push("capture"); return Promise.resolve(); }),
      sendContactEmail:     vi.fn(() => { order.push("email");   return Promise.resolve({ ok: true }); }),
    });
    await submitContactForm(BASE, d);
    expect(order).toEqual(["webhook", "capture", "email"]);
  });

  it("a rejected webhook does not fail the submission", async () => {
    const d = deps({ notifyContactWebhook: vi.fn(() => Promise.reject(new Error("boom"))) });
    await expect(submitContactForm(BASE, d)).resolves.toMatchObject({ ok: true });
  });

  it("a rejected email capture does not fail the submission", async () => {
    const d = deps({ captureEmail: vi.fn(() => Promise.reject(new Error("quota"))) });
    await expect(submitContactForm(BASE, d)).resolves.toMatchObject({ ok: true });
  });

  it("skips email capture when no address was supplied", async () => {
    const d = deps();
    await submitContactForm({ ...BASE, email: "" }, d);
    expect(d.captureEmail).not.toHaveBeenCalled();
  });

  it("returns ok:false plus a mailto fallback when the endpoint fails", async () => {
    const d = deps({
      sendContactEmail: vi.fn(() => Promise.reject(new Error("Email delivery is not configured."))),
    });
    const res = await submitContactForm({ ...BASE, type: "privacy" }, d);

    expect(res.ok).toBe(false);
    expect(res.error).toBe("Email delivery is not configured.");
    expect(res.inbox).toBe("admin");
    expect(res.mailto).toMatch(/^mailto:admin@datiq\.app\?/);
  });

  it("still delivers to the CRM webhook when the email fails", async () => {
    const d = deps({ sendContactEmail: vi.fn(() => Promise.reject(new Error("down"))) });
    await submitContactForm(BASE, d);
    expect(d.notifyContactWebhook).toHaveBeenCalledTimes(1);
  });

  it("normalises an unknown enquiry type instead of throwing", async () => {
    const d = deps();
    const res = await submitContactForm({ ...BASE, type: "refund" }, d);
    expect(res.ok).toBe(true);
    expect(res.routeTo).toBe("hello@datiq.app");
  });
});
