// @vitest-environment node
// netlify/__tests__/engagement-guards.test.js — beta gate, sender validation,
// unsubscribe tokens and Svix signature verification.

import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import {
  engagementAccess, validateSender, signUnsubscribeToken, verifyUnsubscribeToken,
  unsubscribeUrl, verifyResendSignature,
} from "../functions/lib/engagement/engagementGuards.js";
import { withUnsubscribe, mockSendingEnabled } from "../functions/lib/engagement/emailSender.js";

const env = {
  ENGAGEMENT_ENABLED: "1",
  ENGAGEMENT_ALLOWLIST: "u1,u2",
  ENGAGEMENT_SENDER_DOMAINS: "outreach.example.com, mail.acme.test",
  ENGAGEMENT_UNSUBSCRIBE_SECRET: "a-long-enough-test-secret",
  ENGAGEMENT_PUBLIC_URL: "https://app.example.com/",
};

describe("engagementAccess — the beta gate reads env, so it cannot fail open", () => {
  it("off unless explicitly enabled", () => {
    expect(engagementAccess("u1", { ...env, ENGAGEMENT_ENABLED: undefined }).code).toBe("engagement_disabled");
    expect(engagementAccess("u1", { ...env, ENGAGEMENT_ENABLED: "true" }).code).toBe("engagement_disabled");
  });
  it("only allow-listed accounts, or everyone with *", () => {
    expect(engagementAccess("u1", env).ok).toBe(true);
    expect(engagementAccess("u9", env).code).toBe("engagement_beta");
    expect(engagementAccess("u9", { ...env, ENGAGEMENT_ALLOWLIST: "*" }).ok).toBe(true);
    expect(engagementAccess(null, env).ok).toBe(false);
  });
});

describe("validateSender", () => {
  it("accepts a verified domain and normalises case", () => {
    const r = validateSender({ from_email: "Priya@Outreach.Example.com", from_name: "Priya" }, env);
    expect(r.ok).toBe(true);
    expect(r.sender.from_email).toBe("priya@outreach.example.com");
  });
  it("refuses an unverified domain, including a subdomain that was not listed", () => {
    expect(validateSender({ from_email: "a@example.com" }, env).code).toBe("sender_domain_not_allowed");
    expect(validateSender({ from_email: "a@evil.outreach.example.com" }, env).code).toBe("sender_domain_not_allowed");
  });
  it("refuses header injection in the display name", () => {
    expect(validateSender({ from_email: "a@mail.acme.test", from_name: "A\nBcc: x@y" }, env).code).toBe("sender_name_invalid");
    expect(validateSender({ from_email: "a@mail.acme.test", from_name: 'A" <evil@x>' }, env).code).toBe("sender_name_invalid");
  });
  it("says so when no domain is verified at all", () => {
    expect(validateSender({ from_email: "a@b.test" }, {}).error).toMatch(/No sending domain/);
  });
});

describe("unsubscribe tokens", () => {
  const claims = { userId: "u1", prospectId: "p1", channel: "email", address: "ana@buyer.test" };
  it("round-trips", () => {
    expect(verifyUnsubscribeToken(signUnsubscribeToken(claims, env), env)).toEqual(claims);
  });
  it("rejects a tampered payload or a different secret", () => {
    const t = signUnsubscribeToken(claims, env);
    const [payload, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ v: 1, u: "u2", p: "p1", c: "email", a: "ana@buyer.test" })).toString("base64url");
    expect(verifyUnsubscribeToken(`${forged}.${sig}`, env)).toBeNull();
    expect(verifyUnsubscribeToken(t, { ...env, ENGAGEMENT_UNSUBSCRIBE_SECRET: "another-long-secret-value" })).toBeNull();
    expect(verifyUnsubscribeToken(payload, env)).toBeNull();
  });
  it("will not sign without a real secret", () => {
    expect(signUnsubscribeToken(claims, { ENGAGEMENT_UNSUBSCRIBE_SECRET: "short" })).toBeNull();
  });
  it("builds a URL on the public origin", () => {
    expect(unsubscribeUrl("abc.def", env)).toBe("https://app.example.com/api/engagement-unsubscribe?t=abc.def");
  });
});

describe("verifyResendSignature (Svix)", () => {
  const secret = `whsec_${Buffer.from("svix-test-key").toString("base64")}`;
  const body = '{"type":"email.delivered","data":{"email_id":"re_1"}}';
  const now = 1_800_000_000;
  const sig = (b = body, ts = now, id = "msg_1") =>
    createHmac("sha256", Buffer.from("svix-test-key")).update(`${id}.${ts}.${b}`).digest("base64");
  const headers = (s = sig(), ts = now) => ({ "Svix-Id": "msg_1", "svix-timestamp": String(ts), "svix-signature": `v1,${s}` });

  it("accepts a valid signature (header names case-insensitively)", () => {
    expect(verifyResendSignature({ headers: headers(), rawBody: body, secret, nowSeconds: now }).ok).toBe(true);
  });
  it("accepts when any of several rotated signatures matches", () => {
    const h = headers();
    h["svix-signature"] = `v1,AAAA v1,${sig()}`;
    expect(verifyResendSignature({ headers: h, rawBody: body, secret, nowSeconds: now }).ok).toBe(true);
  });
  it("rejects a modified body, an old timestamp and a missing secret", () => {
    expect(verifyResendSignature({ headers: headers(), rawBody: body + " ", secret, nowSeconds: now }).code).toBe("signature_mismatch");
    expect(verifyResendSignature({ headers: headers(sig(body, now - 600), now - 600), rawBody: body, secret, nowSeconds: now }).code).toBe("timestamp_out_of_range");
    expect(verifyResendSignature({ headers: headers(), rawBody: body, secret: "", nowSeconds: now }).code).toBe("not_configured");
  });
});

describe("emailSender helpers", () => {
  it("fills the unsubscribe placeholder, or appends one when a body has none", () => {
    expect(withUnsubscribe({ text: "Hi {{unsubscribe_url}}" }, "https://u").text).toBe("Hi https://u");
    expect(withUnsubscribe({ text: "Hi", html: "<p>Hi</p>" }, "https://u").html).toContain('href="https://u"');
  });
  it("mock sending never runs in production", () => {
    expect(mockSendingEnabled({ ENGAGEMENT_MOCK_SEND: "1" })).toBe(true);
    expect(mockSendingEnabled({ ENGAGEMENT_MOCK_SEND: "1", CONTEXT: "production" })).toBe(false);
  });
});
