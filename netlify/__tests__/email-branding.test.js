import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { wrapEmail, emailHeader, emailFooter, textSignature, esc } from "../../src/lib/emailBranding.js";
import { BRAND, TAGLINE, COMPANY, COMPANY_URL, SITE_URL } from "../../src/lib/exportBranding.js";
import { brandingEmailHtml, brandingEmailText, buildBrandingContext } from "../../src/lib/exportBranding.js";

describe("the branded shell", () => {
  const html = wrapEmail("<p>Body</p>");

  it("carries the mark, the exact brand and the exact tagline in the header", () => {
    expect(html).toContain(`${SITE_URL}/favicon.png`);
    expect(html).toContain(BRAND);
    expect(html).toContain(TAGLINE);
  });

  it("carries the company and its website in the footer", () => {
    expect(html).toContain(COMPANY);
    expect(html).toContain(COMPANY_URL);
  });

  // Most clients block remote images by default. Branding that vanishes when
  // images are blocked is not branding.
  it("degrades without images — the wordmark and tagline are TEXT", () => {
    const noImages = html.replace(/<img[^>]*>/g, "");
    expect(noImages).toContain(BRAND);
    expect(noImages).toContain(TAGLINE);
    expect(noImages).toContain(COMPANY);
  });

  // Gmail strips <head>; Outlook renders through Word. Table-based, inline
  // styles. "Tidying" this into semantic CSS breaks Outlook silently.
  it("is table-based with inline styles, not flexbox", () => {
    expect(html).toMatch(/<table role="presentation"/);
    expect(html).not.toMatch(/display:\s*flex/);
    expect(html).not.toMatch(/<style[\s>]/);
  });

  it("escapes caller content", () => {
    expect(wrapEmail("<p>ok</p>", { preheader: '<img onerror="x">' })).not.toContain('onerror="x"');
    expect(esc('<script>&"')).toBe("&lt;script&gt;&amp;&quot;");
  });

  it("the plain-text signature carries the same attribution", () => {
    const sig = textSignature();
    for (const n of [BRAND, TAGLINE, COMPANY, COMPANY_URL]) expect(sig).toContain(n);
  });

  it("header and footer render standalone", () => {
    expect(emailHeader()).toContain(TAGLINE);
    expect(emailFooter({ extra: "note" })).toContain("note");
  });
});

describe("exportBranding's own email builder signs with the company too", () => {
  const ctx = buildBrandingContext({});
  it("html", () => {
    const h = brandingEmailHtml(ctx, { heading: "Report" });
    expect(h).toContain(COMPANY);
    expect(h).toContain(COMPANY_URL);
  });
  it("text", () => {
    const t = brandingEmailText(ctx, { heading: "Report" });
    expect(t).toContain(COMPANY);
    expect(t).toContain(COMPANY_URL);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE SWEEP. Six independent mail builders had drifted so far apart that ONE
// had a logo, ONE had the tagline, and NOT ONE carried the company. The
// welcome email — the first thing a customer ever sees from us — was a purple
// band reading "DATIQ" with no mark and no signature. This makes a seventh
// unbranded builder a build failure.
// ─────────────────────────────────────────────────────────────────────────────
describe("every mail-sending function uses the shared branding", () => {
  const roots = ["netlify/functions", "netlify/functions/lib"];
  const files = roots.flatMap((r) =>
    readdirSync(resolve(process.cwd(), r))
      .filter((f) => f.endsWith(".js"))
      .map((f) => ({ rel: `${r}/${f}`, src: readFileSync(resolve(process.cwd(), r, f), "utf8") })),
  );

  // Detect SENDERS, not markup. The first version of this keyed off the
  // hand-rolled header shape — and once every builder was converted it matched
  // nothing and passed vacuously, which is the failure mode its own first
  // assertion exists to catch. A file that posts an `html:` body to Resend is
  // a mail builder no matter what that HTML looks like.
  const senders = files.filter((f) => /resend\.com\/emails/.test(f.src) && /\bhtml:/.test(f.src));

  it("finds the mail builders at all (a sweep that matches nothing proves nothing)", () => {
    expect(senders.length).toBeGreaterThanOrEqual(5);
  });

  it.each(senders.map((b) => b.rel))("%s renders through the shared shell", (rel) => {
    const src = files.find((f) => f.rel === rel).src;
    const usesShell = /wrapEmail\(|brandingEmailHtml\(/.test(src);
    expect(usesShell, `${rel} hand-rolls an email instead of using wrapEmail/brandingEmailHtml`).toBe(true);
  });

  it("no mail builder hand-rolls its own brand header", () => {
    for (const b of senders) {
      const handRolled = /background:#4f46e5[^`]*>DatIQ</.test(b.src);
      expect(handRolled, `${b.rel} still hand-rolls a DatIQ header`).toBe(false);
    }
  });

  it("no stale tagline survives anywhere in the mail path", () => {
    for (const f of files) {
      expect(f.src, `${f.rel} carries a stale tagline`).not.toMatch(/Intelligence from every URL/);
      expect(f.src, `${f.rel} carries a stale tagline`).not.toMatch(/Intelligence from Web(?!\w)/);
    }
  });
});
