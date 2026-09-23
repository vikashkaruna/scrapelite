// src/lib/engagement/channelRouter.test.js
import { describe, it, expect } from "vitest";
import * as router from "./channelRouter.js";
import { resolveChannelForProspect } from "./channelRouter.js";

describe("channelRouter — channel resolution", () => {
  it("honours the prospect's preference when it has an address there", () => {
    const prospect = { email: "a@x.com", phone: "+15551234567", channel_preference: "whatsapp" };
    expect(resolveChannelForProspect(prospect)).toBe("whatsapp");
  });

  it("falls through to the campaign priority when the preferred channel has no address", () => {
    const prospect = { email: "a@x.com", phone: null, channel_preference: "whatsapp" };
    expect(resolveChannelForProspect(prospect, ["whatsapp", "email"])).toBe("email");
  });

  it("returns null when nothing can reach the prospect", () => {
    expect(resolveChannelForProspect({ email: null, phone: null })).toBe(null);
  });

  it("an address that does not normalise is not an address", () => {
    expect(resolveChannelForProspect({ email: "not-an-email", phone: "12" })).toBe(null);
  });

  it("liveOnly restricts to channels that can send today (Phase 1: email)", () => {
    const prospect = { email: "a@x.com", phone: "+15551234567", channel_preference: "sms" };
    expect(resolveChannelForProspect(prospect, ["sms", "email"], { liveOnly: true })).toBe("email");
    expect(resolveChannelForProspect({ phone: "+15551234567" }, ["sms"], { liveOnly: true })).toBe(null);
  });
});

// 🔴 F-4 — the module that decides a channel must not be able to send, and must
// never again contain a path that reports an unsent message as sent.
describe("channelRouter — decides, never sends", () => {
  it("exports no dispatch function", () => {
    expect(router.dispatchMessage).toBeUndefined();
    expect(router.DISPATCH_STATUSES).toBeUndefined();
  });
});
