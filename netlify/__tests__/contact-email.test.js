// netlify/__tests__/contact-email.test.js — POST /api/contact-email.
//
// The contract that matters most here is that ROUTING IS SERVER-SIDE. The
// client sends an enquiry type, never a recipient, so this endpoint can't be
// used as an open relay. Everything else — validation, honeypot, Resend
// payload shape, failure codes — hangs off that.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handler } from "../functions/contact-email.js";

function makeEvent(overrides = {}, httpMethod = "POST") {
  return {
    httpMethod,
    body: JSON.stringify({
      type: "support",
      name: "Alice",
      email: "alice@example.com",
      subject: "Cannot export CSV",
      message: "The export button does nothing.",
      ...overrides,
    }),
  };
}

const parse = (r) => JSON.parse(r.body);
/** The JSON body handed to Resend on the last fetch call. */
const sentPayload = () => JSON.parse(global.fetch.mock.calls[0][1].body);

function resendOk(id = "re_123") {
  return { ok: true, status: 200, json: () => Promise.resolve({ id }), text: () => Promise.resolve("") };
}

describe("contact-email", () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.RESEND_API_KEY = "resend-key";
    delete process.env.CONTACT_EMAIL_FROM;
    delete process.env.ALERT_EMAIL_FROM;
    global.fetch = vi.fn(() => Promise.resolve(resendOk()));
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  // ── Method + payload validation ────────────────────────────────────────────

  it("rejects non-POST methods", async () => {
    const r = await handler(makeEvent({}, "GET"));
    expect(r.statusCode).toBe(405);
  });

  it("rejects malformed JSON", async () => {
    const r = await handler({ httpMethod: "POST", body: "not-json" });
    expect(r.statusCode).toBe(400);
    expect(parse(r).error).toMatch(/invalid json/i);
  });

  it("requires an email address", async () => {
    const r = await handler(makeEvent({ email: "" }));
    expect(r.statusCode).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("requires a message", async () => {
    const r = await handler(makeEvent({ message: "   " }));
    expect(r.statusCode).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects an implausible email address", async () => {
    const r = await handler(makeEvent({ email: "not-an-email" }));
    expect(r.statusCode).toBe(400);
    expect(parse(r).error).toMatch(/valid/i);
  });

  it("rejects an oversized message rather than forwarding it", async () => {
    const r = await handler(makeEvent({ message: "x".repeat(20001) }));
    expect(r.statusCode).toBe(400);
    expect(parse(r).error).toMatch(/too long/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("accepts a message right at the size limit", async () => {
    const r = await handler(makeEvent({ message: "x".repeat(20000) }));
    expect(r.statusCode).toBe(200);
  });

  // ── Honeypot ───────────────────────────────────────────────────────────────

  it("silently drops a submission with the honeypot filled", async () => {
    const r = await handler(makeEvent({ botcheck: "http://spam.example" }));
    // 200 so the bot thinks it worked and doesn't retry.
    expect(r.statusCode).toBe(200);
    expect(parse(r).skipped).toBe("bot");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("an empty honeypot is the normal path", async () => {
    const r = await handler(makeEvent({ botcheck: "" }));
    expect(r.statusCode).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  // ── Server-authoritative routing ───────────────────────────────────────────

  it.each([
    ["support", "hello@datiq.app"],
    ["bug", "hello@datiq.app"],
    ["billing", "hello@datiq.app"],
    ["feature", "hello@datiq.app"],
    ["other", "hello@datiq.app"],
    ["enterprise", "admin@datiq.app"],
    ["legal", "admin@datiq.app"],
    ["privacy", "admin@datiq.app"],
  ])("routes a '%s' enquiry to %s", async (type, expected) => {
    const r = await handler(makeEvent({ type }));
    expect(r.statusCode).toBe(200);
    expect(sentPayload().to).toEqual([expected]);
    expect(parse(r).routeTo).toBe(expected);
  });

  it("sends to exactly one inbox — never both", async () => {
    await handler(makeEvent({ type: "privacy" }));
    expect(sentPayload().to).toHaveLength(1);
  });

  it("ignores a client-supplied recipient — this is not an open relay", async () => {
    const r = await handler(makeEvent({
      type: "support",
      to: ["attacker@evil.example"],
      routeTo: "attacker@evil.example",
      route_to: "attacker@evil.example",
    }));
    expect(r.statusCode).toBe(200);
    expect(sentPayload().to).toEqual(["hello@datiq.app"]);
    expect(JSON.stringify(sentPayload())).not.toContain("attacker@evil.example");
  });

  it("falls back to the default inbox for an unknown enquiry type", async () => {
    const r = await handler(makeEvent({ type: "refund" }));
    expect(r.statusCode).toBe(200);
    expect(parse(r).routeTo).toBe("hello@datiq.app");
  });

  // ── Resend payload shape ───────────────────────────────────────────────────

  it("calls Resend with a bearer token and JSON content type", async () => {
    await handler(makeEvent());
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer resend-key");
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("sets reply_to to the sender so a mailbox reply reaches them", async () => {
    await handler(makeEvent({ email: "bob@example.com" }));
    expect(sentPayload().reply_to).toBe("bob@example.com");
  });

  it("tags the subject with the routed inbox and the enquiry label", async () => {
    await handler(makeEvent({ type: "legal", subject: "DPA request" }));
    expect(sentPayload().subject).toBe("[ADMIN] Legal & terms — DPA request");
  });

  it("still builds a subject when the user left it blank", async () => {
    await handler(makeEvent({ type: "bug", subject: "" }));
    expect(sentPayload().subject).toBe("[HELLO] Bug report — Contact form submission");
  });

  it("sends both an HTML and a plain-text body", async () => {
    await handler(makeEvent());
    const p = sentPayload();
    expect(p.html).toContain("The export button does nothing.");
    expect(p.text).toContain("The export button does nothing.");
    expect(p.text).toContain("alice@example.com");
  });

  it("attaches Resend tags for stream, inbox and enquiry type", async () => {
    await handler(makeEvent({ type: "enterprise" }));
    expect(sentPayload().tags).toEqual([
      { name: "stream", value: "contact" },
      { name: "inbox", value: "admin" },
      { name: "enquiry_type", value: "enterprise" },
    ]);
  });

  it("escapes HTML in user input so the email can't be injected", async () => {
    await handler(makeEvent({
      name: '<img src=x onerror="alert(1)">',
      message: "<script>alert('xss')</script>",
    }));
    const { html } = sentPayload();
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
  });

  it("shows a placeholder when no name was given", async () => {
    await handler(makeEvent({ name: "" }));
    expect(sentPayload().text).toContain("(not provided)");
  });

  // ── From address ───────────────────────────────────────────────────────────

  it("defaults the From address to the no-reply sender", async () => {
    // Inbound-only mail: the submitter's address is unverified, so this is sent
    // from a no-reply sender to our own inbox. reply_to carries the human.
    const r = await handler(makeEvent());
    expect(r.statusCode).toBe(200);
    expect(sentPayload().from).toBe("DatIQ Contact <noreply@datiq.app>");
  });

  it("CONTACT_EMAIL_FROM overrides the default sender", async () => {
    process.env.CONTACT_EMAIL_FROM = "DatIQ Contact <forms@datiq.app>";
    await handler(makeEvent());
    expect(sentPayload().from).toBe("DatIQ Contact <forms@datiq.app>");
  });

  it("ignores ALERT_EMAIL_FROM — that variable configures OUTBOUND mail", async () => {
    // Guard against the inbound/outbound sender identities bleeding together:
    // pointing ALERT_EMAIL_FROM at hello@ must not make this path mail hello@
    // from hello@.
    process.env.ALERT_EMAIL_FROM = "DatIQ <hello@datiq.app>";
    await handler(makeEvent());
    expect(sentPayload().from).toBe("DatIQ Contact <noreply@datiq.app>");
  });

  // ── Failure modes ──────────────────────────────────────────────────────────

  it("returns 503 when no Resend key is configured", async () => {
    delete process.env.RESEND_API_KEY;
    const r = await handler(makeEvent());
    expect(r.statusCode).toBe(503);
    expect(parse(r).error).toMatch(/not configured/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns 502 when Resend rejects the message", async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: false, status: 422,
      text: () => Promise.resolve("domain not verified"),
      json: () => Promise.resolve({}),
    }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await handler(makeEvent());
    expect(r.statusCode).toBe(502);
    expect(parse(r).error).toMatch(/HTTP 422/);
    warn.mockRestore();
  });

  it("returns 502 when Resend is unreachable", async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error("ECONNREFUSED")));
    const r = await handler(makeEvent());
    expect(r.statusCode).toBe(502);
    expect(parse(r).error).toMatch(/could not reach/i);
  });

  it("never leaks the Resend key in a response body", async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: false, status: 401,
      text: () => Promise.resolve("Invalid API key: resend-key"),
      json: () => Promise.resolve({}),
    }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await handler(makeEvent());
    expect(r.body).not.toContain("resend-key");
    warn.mockRestore();
  });

  // ── Success response ───────────────────────────────────────────────────────

  it("returns ok, the resolved inbox, and the Resend message id", async () => {
    const r = await handler(makeEvent({ type: "privacy" }));
    expect(parse(r)).toEqual({
      ok: true, inbox: "admin", routeTo: "admin@datiq.app", id: "re_123",
    });
  });

  it("still succeeds when Resend's response body is unreadable", async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.reject(new Error("no body")),
      text: () => Promise.resolve(""),
    }));
    const r = await handler(makeEvent());
    expect(r.statusCode).toBe(200);
    expect(parse(r).ok).toBe(true);
    expect(parse(r).id).toBeNull();
  });

  it("responds with a JSON content type", async () => {
    const r = await handler(makeEvent());
    expect(r.headers["Content-Type"]).toBe("application/json");
  });
});
