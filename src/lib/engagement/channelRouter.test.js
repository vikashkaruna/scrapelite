// src/lib/engagement/channelRouter.test.js
import { describe, it, expect } from "vitest";
import {
  resolveChannelForProspect,
  dispatchMessage,
  DISPATCH_STATUSES,
} from "./channelRouter.js";

describe("channelRouter — channel resolution & cascades", () => {
  it("honors prospect channel preference when contact point exists", () => {
    const prospect = { email: "a@x.com", phone: "+15551234567", channel_preference: "whatsapp" };
    expect(resolveChannelForProspect(prospect)).toBe("whatsapp");
  });

  it("cascades to next available channel when preferred channel lacks contact point", () => {
    const prospectNoPhone = { email: "a@x.com", phone: null, channel_preference: "whatsapp" };
    expect(resolveChannelForProspect(prospectNoPhone, ["whatsapp", "email"])).toBe("email");
  });

  it("returns null when prospect has no reachable contact point", () => {
    const emptyProspect = { email: null, phone: null, channel_preference: "auto" };
    expect(resolveChannelForProspect(emptyProspect)).toBe(null);
  });

  it("cascades through multiple priorities until a valid contact is found", () => {
    const prospect = { email: "a@x.com", phone: null, custom_attributes: {} };
    // 'telegram' needs phone or custom_attributes.telegram_chat_id, 'whatsapp' needs phone, 'email' needs email
    expect(resolveChannelForProspect(prospect, ["telegram", "whatsapp", "email"])).toBe("email");
  });
});

describe("channelRouter — dispatchMessage", () => {
  it("executes mock dispatch cleanly when in mock mode", async () => {
    const prospect = { email: "buyer@corp.com", phone: "+15550001111" };
    const message = { channel: "email", subject: "Hi", body: "Test body" };

    const res = await dispatchMessage(message, prospect, {});
    expect(res.ok).toBe(true);
    expect(res.status).toBe(DISPATCH_STATUSES.SENT);
    expect(res.external_message_id).toContain("mock_email_");
  });

  it("skips dispatch if required contact point is missing", async () => {
    const prospect = { email: null, phone: null };
    const message = { channel: "email", subject: "Hi", body: "Test body" };

    const res = await dispatchMessage(message, prospect, {});
    expect(res.ok).toBe(false);
    expect(res.status).toBe(DISPATCH_STATUSES.SKIPPED);
    expect(res.error).toContain("Missing prospect email");
  });

  it("returns mock success for SMS dispatch with empty credentials", async () => {
    const prospect = { phone: "+15550001111" };
    const message = { channel: "sms", body: "Test SMS" };

    const res = await dispatchMessage(message, prospect, {});
    expect(res.ok).toBe(true);
    expect(res.status).toBe(DISPATCH_STATUSES.SENT);
    expect(res.external_message_id).toContain("mock_sms_");
  });

  it("returns fallback for Telegram dispatch when missing telegram credentials", async () => {
    const prospect = { phone: "+15551112222" };
    const message = { channel: "telegram", body: "Telegram test" };

    const res = await dispatchMessage(message, prospect, { resend_key: "present_so_not_mock" });
    expect(res.ok).toBe(true);
    expect(res.external_message_id).toContain("fallback_telegram_");
  });

  it("returns SKIPPED for WhatsApp dispatch when prospect has no phone", async () => {
    const prospect = { email: "buyer@corp.com", phone: null };
    const message = { channel: "whatsapp", body: "WhatsApp test" };

    const res = await dispatchMessage(message, prospect, {});
    expect(res.ok).toBe(false);
    expect(res.status).toBe(DISPATCH_STATUSES.SKIPPED);
    expect(res.error).toContain("Missing prospect phone number");
  });
});
