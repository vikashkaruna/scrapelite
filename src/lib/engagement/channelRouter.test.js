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
});
