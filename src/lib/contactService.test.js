// contactService.test.js — /contact submission orchestration.
//
// The rules under test:
//   1. Web3Forms is the primary path — its outcome is what the caller sees.
//   2. The CRM webhook and subscriber capture run in parallel and can NEVER
//      fail or delay a submission.
//   3. Routing metadata always matches the enquiry type's inbox.

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  accessKeyForInbox,
  buildMailtoFallback,
  buildWeb3FormsFields,
  submitContactForm,
} from "./contactService.js";
import { WEB3FORMS_ACCESS_KEY } from "./config.js";

const BASE = {
  type: "support",
  name: "Alice",
  email: "alice@example.com",
  subject: "Cannot export CSV",
  message: "The export button does nothing.",
};

function deps(overrides = {}) {
  return {
    submitToWeb3Forms: vi.fn(() => Promise.resolve({ ok: true })),
    notifyContactWebhook: vi.fn(() => Promise.resolve({ delivered: true })),
    captureEmail: vi.fn(() => Promise.resolve({ ok: true })),
    ...overrides,
  };
}

beforeEach(() => { vi.clearAllMocks(); });

describe("contactService — buildWeb3FormsFields", () => {
  it("carries the routing metadata for a hello@ enquiry", () => {
    const fields = buildWeb3FormsFields({ ...BASE, inbox: "hello" });
    expect(fields.inbox).toBe("hello");
    expect(fields.route_to).toBe("hello@datiq.app");
    expect(fields.subject).toBe("[HELLO] Product support — Cannot export CSV");
    expect(fields.enquiry_type).toBe("Product support");
  });

  it("carries the routing metadata for an admin@ enquiry", () => {
    const fields = buildWeb3FormsFields({ ...BASE, type: "legal" });
    expect(fields.inbox).toBe("admin");
    expect(fields.route_to).toBe("admin@datiq.app");
    expect(fields.subject).toBe("[ADMIN] Legal & terms — Cannot export CSV");
  });

  it("sets replyto so a reply reaches the sender, not the form", () => {
    expect(buildWeb3FormsFields(BASE).replyto).toBe("alice@example.com");
  });

  it("includes the botcheck honeypot field", () => {
    expect(buildWeb3FormsFields(BASE).botcheck).toBe("");
  });

  it("substitutes a placeholder when no name is given", () => {
    expect(buildWeb3FormsFields({ ...BASE, name: "  " }).name).toBe("(not provided)");
  });

  it("never emits undefined for a field the user left blank", () => {
    const fields = buildWeb3FormsFields({ type: "other" });
    expect(Object.values(fields).every((v) => v !== undefined)).toBe(true);
  });
});

describe("contactService — accessKeyForInbox", () => {
  it("uses the default key for the hello inbox", () => {
    expect(accessKeyForInbox("hello")).toBe(WEB3FORMS_ACCESS_KEY);
  });

  it("falls back to the default key for admin until a second key is registered", () => {
    // VITE_WEB3FORMS_ACCESS_KEY_ADMIN is unset in the test env, so both inboxes
    // share one key — the documented interim behaviour.
    expect(accessKeyForInbox("admin")).toBe(WEB3FORMS_ACCESS_KEY);
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
  it("sends via Web3Forms and reports success with the routed inbox", async () => {
    const d = deps();
    const res = await submitContactForm({ ...BASE, type: "enterprise" }, d);

    expect(res).toEqual({ ok: true, inbox: "admin", routeTo: "admin@datiq.app" });
    expect(d.submitToWeb3Forms).toHaveBeenCalledTimes(1);
    const [fields, opts] = d.submitToWeb3Forms.mock.calls[0];
    expect(fields.route_to).toBe("admin@datiq.app");
    expect(opts.accessKey).toBe(WEB3FORMS_ACCESS_KEY);
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
      submitToWeb3Forms:    vi.fn(() => { order.push("email");   return Promise.resolve({ ok: true }); }),
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

  it("returns ok:false plus a mailto fallback when Web3Forms fails", async () => {
    const d = deps({
      submitToWeb3Forms: vi.fn(() => Promise.reject(new Error("Invalid Access Key"))),
    });
    const res = await submitContactForm({ ...BASE, type: "privacy" }, d);

    expect(res.ok).toBe(false);
    expect(res.error).toBe("Invalid Access Key");
    expect(res.inbox).toBe("admin");
    expect(res.mailto).toMatch(/^mailto:admin@datiq\.app\?/);
  });

  it("still delivers to the CRM webhook when the email fails", async () => {
    const d = deps({ submitToWeb3Forms: vi.fn(() => Promise.reject(new Error("down"))) });
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
