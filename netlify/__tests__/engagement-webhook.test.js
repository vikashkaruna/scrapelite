// netlify/__tests__/engagement-webhook.test.js
import { describe, it, expect } from "vitest";
import {
  detectProvider,
  parseWebhookEvent,
  handler,
} from "../functions/engagement-webhook.js";

describe("engagement-webhook — provider detection", () => {
  it("detects Resend from event payload", () => {
    const event = { queryStringParameters: {} };
    const payload = { type: "email.delivered", data: { id: "res_123" } };
    expect(detectProvider(event, payload)).toBe("resend");
  });

  it("detects Twilio from MessageSid or AccountSid", () => {
    const event = { queryStringParameters: {} };
    const payload = { MessageSid: "SM12345", From: "+15551234567" };
    expect(detectProvider(event, payload)).toBe("twilio");
  });

  it("detects Telegram from update_id or message", () => {
    const event = { queryStringParameters: {} };
    const payload = { update_id: 10001, message: { text: "Hello", chat: { id: 123 } } };
    expect(detectProvider(event, payload)).toBe("telegram");
  });
});

describe("engagement-webhook — event parsing", () => {
  it("parses Resend open, click, and bounce events", () => {
    const openPayload = { type: "email.opened", data: { to: ["buyer@acme.test"] } };
    const parsedOpen = parseWebhookEvent("resend", openPayload);
    expect(parsedOpen.channel).toBe("email");
    expect(parsedOpen.eventType).toBe("open");
    expect(parsedOpen.email).toBe("buyer@acme.test");

    const clickPayload = { type: "email.clicked", data: { to: ["buyer@acme.test"] } };
    const parsedClick = parseWebhookEvent("resend", clickPayload);
    expect(parsedClick.eventType).toBe("click");

    const bouncePayload = { type: "email.bounced", data: { to: ["buyer@acme.test"] } };
    const parsedBounce = parseWebhookEvent("resend", bouncePayload);
    expect(parsedBounce.eventType).toBe("bounce");
  });

  it("parses Twilio inbound reply and identifies STOP keyword as opt-out", () => {
    const replyPayload = {
      From: "whatsapp:+15559876543",
      Body: "Interested in learning more, can you send details?",
    };
    const parsedReply = parseWebhookEvent("twilio", replyPayload);
    expect(parsedReply.channel).toBe("whatsapp");
    expect(parsedReply.eventType).toBe("reply");
    expect(parsedReply.isOptOut).toBe(false);

    const stopPayload = {
      From: "whatsapp:+15559876543",
      Body: "STOP",
    };
    const parsedStop = parseWebhookEvent("twilio", stopPayload);
    expect(parsedStop.isOptOut).toBe(true);
  });

  it("parses Telegram message and /stop command", () => {
    const msgPayload = {
      message: {
        text: "Please send the report",
        from: { username: "techlead" },
      },
    };
    const parsed = parseWebhookEvent("telegram", msgPayload);
    expect(parsed.channel).toBe("telegram");
    expect(parsed.eventType).toBe("reply");
    expect(parsed.text).toBe("Please send the report");
    expect(parsed.isOptOut).toBe(false);

    const stopMsg = {
      message: {
        text: "/stop",
        from: { username: "techlead" },
      },
    };
    const parsedStop = parseWebhookEvent("telegram", stopMsg);
    expect(parsedStop.isOptOut).toBe(true);
  });
});

describe("engagement-webhook — handler execution", () => {
  it("processes inbound Resend open event cleanly", async () => {
    const res = await handler({
      httpMethod: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "email.opened",
        data: { to: ["buyer@acme.test"] },
      }),
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.ok).toBe(true);
  });

  it("processes inbound Twilio URL-encoded STOP reply", async () => {
    const body = new URLSearchParams({
      From: "whatsapp:+15559876543",
      Body: "STOP",
    }).toString();

    const res = await handler({
      httpMethod: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.ok).toBe(true);
  });

  it("processes inbound Telegram /stop command", async () => {
    const res = await handler({
      httpMethod: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: { text: "/stop", from: { username: "user" } }
      })
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).ok).toBe(true);
  });

  it("returns 200 with ignored status for malformed JSON payload", async () => {
    const res = await handler({
      httpMethod: "POST",
      headers: { "content-type": "application/json" },
      body: "{ badly_formed: true",
    });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.ok).toBe(true);
    expect(data.status).toBe("ignored_unrecognized_event");
  });
});

describe("engagement-webhook — security validation", () => {
  it("rejects webhook with invalid signature when env var is set", async () => {
    process.env.ENGAGEMENT_WEBHOOK_SECRET = "secret";
    const res = await handler({
      httpMethod: "POST",
      headers: { "x-engagement-secret": "wrong" },
      body: "{}",
    });
    expect(res.statusCode).toBe(401);
    delete process.env.ENGAGEMENT_WEBHOOK_SECRET;
  });

  it("accepts webhook with valid signature when env var is set", async () => {
    process.env.ENGAGEMENT_WEBHOOK_SECRET = "secret";
    const res = await handler({
      httpMethod: "POST",
      headers: { "x-engagement-secret": "secret" },
      body: JSON.stringify({ type: "email.opened", data: { to: ["a@a.com"] } }),
    });
    expect(res.statusCode).toBe(200);
    delete process.env.ENGAGEMENT_WEBHOOK_SECRET;
  });
});
