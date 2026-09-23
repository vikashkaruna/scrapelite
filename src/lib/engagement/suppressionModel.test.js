// src/lib/engagement/suppressionModel.test.js
import { describe, it, expect } from "vitest";
import {
  normalizeAddress, addressFor, optOutRows, indexSuppressions, findSuppression,
  consentStatus, canLiftSuppression, SUPPRESSION_CHANNELS, LIVE_CHANNELS,
} from "./suppressionModel.js";

describe("normalizeAddress — a suppression that misses on formatting is a message to someone who said stop", () => {
  it("lower-cases email and refuses non-addresses", () => {
    expect(normalizeAddress("email", "  Ana@Buyer.TEST ")).toBe("ana@buyer.test");
    expect(normalizeAddress("email", "not-an-email")).toBeNull();
  });
  it("reduces phones to digits with one leading plus", () => {
    expect(normalizeAddress("sms", "+91 80 4718-2200")).toBe("+918047182200");
    expect(normalizeAddress("whatsapp", "whatsapp:+15550001111")).toBe("+15550001111");
    expect(normalizeAddress("sms", "12")).toBeNull();
  });
  it("treats a Telegram address as a chat id, never a phone number", () => {
    expect(addressFor({ phone: "+15550001111" }, "telegram")).toBeNull();
    expect(addressFor({ custom_attributes: { telegram_chat_id: "123456789" } }, "telegram")).toBe("123456789");
  });
});

describe("optOutRows — per channel", () => {
  const prospect = { id: "p1", email: "A@x.test", phone: "+1 555 000 1111" };
  it("writes one row per channel that has an address", () => {
    const rows = optOutRows({ userId: "u1", prospect, channels: ["email", "sms", "telegram"], reason: "manual", source: "dashboard" });
    expect(rows.map((r) => [r.channel, r.address])).toEqual([["email", "a@x.test"], ["sms", "+15550001111"]]);
  });
  it("ignores unknown channels and duplicates", () => {
    expect(optOutRows({ userId: "u1", prospect, channels: ["email", "email", "fax"], reason: "manual", source: "x" })).toHaveLength(1);
  });
});

describe("findSuppression / consentStatus", () => {
  const prospect = { email: "a@x.test", phone: "+15550001111" };
  const index = indexSuppressions([{ id: "s1", channel: "email", address: "a@x.test", reason: "unsubscribe", created_at: "2026-09-01T00:00:00Z" }]);

  it("blocks only the channel that was opted out", () => {
    expect(findSuppression(index, prospect, "email")?.id).toBe("s1");
    expect(findSuppression(index, prospect, "sms")).toBeNull();
  });

  it("reports every channel, including the ones with no address", () => {
    const rows = consentStatus(prospect, index);
    expect(rows.map((r) => r.channel)).toEqual(SUPPRESSION_CHANNELS);
    const email = rows.find((r) => r.channel === "email");
    expect(email).toMatchObject({ suppressed: true, reasonLabel: "Unsubscribed", live: true });
    expect(rows.find((r) => r.channel === "sms")).toMatchObject({ suppressed: false, live: LIVE_CHANNELS.includes("sms") });
    expect(rows.find((r) => r.channel === "telegram").address).toBeNull();
  });
});

describe("canLiftSuppression — the owner's policy", () => {
  it("always answers with a boolean", () => {
    for (const reason of ["unsubscribe", "stop_keyword", "bounce", "complaint", "manual"]) {
      expect(typeof canLiftSuppression({ reason })).toBe("boolean");
    }
  });
  it("never lets a tenant undo a spam complaint", () => {
    expect(canLiftSuppression({ reason: "complaint" })).toBe(false);
  });
});
