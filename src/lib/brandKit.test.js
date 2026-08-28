// src/lib/brandKit.test.js — Phase 2 structured Brand Kit (whiteLabelTemplate.js),
// additive alongside the existing raw-PDF-upload white-label feature.

import { describe, expect, it, beforeEach } from "vitest";
import { validateBrandKit, writeBrandKit, readBrandKit, clearBrandKit } from "./whiteLabelTemplate.js";

const VALID_KIT = {
  companyName: "Acme Research Co.",
  tagline: "Market Intelligence, Delivered.",
  accentColor: "#0f766e",
  footerText: "Confidential — prepared exclusively for Acme Research clients.",
  website: "https://acmeresearch.example.com",
  contactEmail: "reports@acmeresearch.example.com",
};

const SMALL_LOGO_DATA_URL = "data:image/png;base64," + "A".repeat(100);

beforeEach(() => {
  try { localStorage.clear(); } catch {}
});

describe("validateBrandKit", () => {
  it("accepts a fully-populated, valid kit", () => {
    const r = validateBrandKit(VALID_KIT);
    expect(r.ok).toBe(true);
    expect(r.value.companyName).toBe("Acme Research Co.");
  });

  it("accepts an empty object — every field is optional", () => {
    const r = validateBrandKit({});
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({});
  });

  it("rejects a text field over the length cap", () => {
    const r = validateBrandKit({ companyName: "x".repeat(200) });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("FIELD_TOO_LONG");
  });

  it("rejects a website that isn't a full https:// URL", () => {
    expect(validateBrandKit({ website: "acmeresearch.example.com" }).ok).toBe(false);
    expect(validateBrandKit({ website: "https://acmeresearch.example.com" }).ok).toBe(true);
  });

  it("rejects an invalid contact email", () => {
    expect(validateBrandKit({ contactEmail: "not-an-email" }).ok).toBe(false);
    expect(validateBrandKit({ contactEmail: "a@b.com" }).ok).toBe(true);
  });

  it("rejects a non-hex accent color", () => {
    expect(validateBrandKit({ accentColor: "teal" }).ok).toBe(false);
    expect(validateBrandKit({ accentColor: "#0f766e" }).ok).toBe(true);
  });

  it("accepts a small PNG logo and carries its dimensions through", () => {
    const r = validateBrandKit({ logo: { dataUrl: SMALL_LOGO_DATA_URL, width: 120, height: 40 } });
    expect(r.ok).toBe(true);
    expect(r.value.logo).toEqual({ dataUrl: SMALL_LOGO_DATA_URL, width: 120, height: 40 });
  });

  it("rejects a logo that isn't PNG/JPEG/SVG", () => {
    const r = validateBrandKit({ logo: { dataUrl: "data:application/pdf;base64,AAAA" } });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("INVALID_LOGO_TYPE");
  });

  it("rejects a logo over the size cap", () => {
    const bigDataUrl = "data:image/png;base64," + "A".repeat(300 * 1024); // ~225KB decoded
    const r = validateBrandKit({ logo: { dataUrl: bigDataUrl } });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("LOGO_TOO_LARGE");
  });
});

describe("writeBrandKit / readBrandKit / clearBrandKit", () => {
  it("round-trips a saved kit", () => {
    const w = writeBrandKit(VALID_KIT);
    expect(w.ok).toBe(true);
    const read = readBrandKit();
    expect(read.companyName).toBe("Acme Research Co.");
    expect(read.accentColor).toBe("#0f766e");
    expect(read.updatedAt).toBeTypeOf("string");
  });

  it("readBrandKit returns null when nothing has been saved", () => {
    expect(readBrandKit()).toBeNull();
  });

  it("does not persist an invalid kit", () => {
    const w = writeBrandKit({ accentColor: "not-a-color" });
    expect(w.ok).toBe(false);
    expect(readBrandKit()).toBeNull();
  });

  it("a whole-object save replaces the previous kit rather than merging", () => {
    writeBrandKit({ companyName: "Acme", tagline: "Old tagline" });
    writeBrandKit({ companyName: "Acme" }); // no tagline this time
    expect(readBrandKit().tagline).toBeUndefined();
  });

  it("clearBrandKit removes it and is idempotent", () => {
    writeBrandKit(VALID_KIT);
    expect(clearBrandKit().ok).toBe(true);
    expect(readBrandKit()).toBeNull();
    expect(clearBrandKit().ok).toBe(true); // calling again doesn't throw
  });
});
