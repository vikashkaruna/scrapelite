// scripts/seo-static-audit.test.mjs — what every crawlable page must carry.
//
// Checks the FILES AS COMMITTED, so it fails on what Google would actually be
// served rather than on what the source intends.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "public");

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (name.endsWith(".html")) acc.push(p);
  }
  return acc;
}

const pages = walk(PUBLIC).map((f) => ({
  file: f,
  rel: relative(PUBLIC, f),
  html: readFileSync(f, "utf8"),
}));

const canonicalOf = (html) =>
  html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/)?.[1] ?? null;

describe("static SEO audit", () => {
  it("found the static pages", () => {
    expect(pages.length).toBeGreaterThan(30);
  });

  it("every page has a canonical", () => {
    // 25 files shipped without one — every page under public/help/, plus
    // dmca.html and four /vs/ pages.
    const missing = pages.filter((p) => !canonicalOf(p.html)).map((p) => p.rel);
    expect(missing).toEqual([]);
  });

  it("no page other than the homepage canonicalises to the homepage", () => {
    // THE defect, asserted against the shipped bytes.
    //
    // `home/index.html` is the ONE legitimate exception: it IS the homepage.
    // It lives at that path only because public/index.html would be copied over
    // dist/index.html and destroy Vite's entry point, and netlify.toml serves it
    // at `/` with a forced 200 rewrite. Its canonical pointing at
    // https://datiq.app/ is therefore correct — and is also what stops /home
    // becoming a duplicate in the index.
    const HOMEPAGE_OUTPUT = "home/index.html";
    const wrong = pages
      .filter((p) => p.rel !== HOMEPAGE_OUTPUT)
      .filter((p) => canonicalOf(p.html) === "https://datiq.app/")
      .map((p) => p.rel);
    expect(wrong).toEqual([]);

    // And the exception must actually be the homepage, not a stray file that
    // happened to be named that.
    const home = pages.find((p) => p.rel === HOMEPAGE_OUTPUT);
    expect(home, "public/home/index.html is missing — run npm run prerender").toBeTruthy();
    expect(canonicalOf(home.html)).toBe("https://datiq.app/");
  });

  it("every canonical is an absolute production URL", () => {
    // Callers used to build these from window.location.origin, which under the
    // prerenderer is http://localhost:4319 — a localhost canonical shipped to
    // production. Also catches a canonical pointing at a branch-deploy host.
    const bad = pages
      .map((p) => [p.rel, canonicalOf(p.html)])
      .filter(([, c]) => c && !c.startsWith("https://datiq.app/"))
      .map(([rel, c]) => `${rel}: ${c}`);
    expect(bad).toEqual([]);
  });

  it("no canonical carries a query string or fragment", () => {
    const bad = pages
      .map((p) => [p.rel, canonicalOf(p.html)])
      .filter(([, c]) => c && /[?#]/.test(c))
      .map(([rel, c]) => `${rel}: ${c}`);
    expect(bad).toEqual([]);
  });

  it("every page loads the shared Google tag", () => {
    const missing = pages.filter((p) => !p.html.includes('src="/analytics.js"')).map((p) => p.rel);
    expect(missing).toEqual([]);
  });

  it("every page loads runtime-config.js before analytics.js", () => {
    // Order decides whether staging traffic lands in the production property.
    const wrong = pages
      .filter((p) => {
        const rc = p.html.indexOf('src="/runtime-config.js"');
        const an = p.html.indexOf('src="/analytics.js"');
        return an > -1 && (rc === -1 || rc > an);
      })
      .map((p) => p.rel);
    expect(wrong).toEqual([]);
  });

  it("every page has a non-empty, unique title", () => {
    const titles = new Map();
    const problems = [];
    for (const p of pages) {
      const t = p.html.match(/<title>([^<]*)<\/title>/)?.[1]?.trim();
      if (!t) { problems.push(`${p.rel}: no title`); continue; }
      // Duplicate titles across URLs are how a crawler decides two pages are
      // the same page — the non-canonical half of the same bug.
      if (titles.has(t)) problems.push(`${p.rel}: title duplicates ${titles.get(t)}`);
      else titles.set(t, p.rel);
    }
    expect(problems).toEqual([]);
  });

  it("every page has a meta description", () => {
    const missing = pages
      .filter((p) => !/<meta[^>]+name=["']description["']/.test(p.html))
      .map((p) => p.rel);
    expect(missing).toEqual([]);
  });
});

describe("sitemap integrity", () => {
  const sitemap = readFileSync(join(PUBLIC, "sitemap.xml"), "utf8");
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

  it("lists a healthy number of URLs", () => {
    expect(locs.length).toBeGreaterThan(30);
  });

  it("every entry has a lastmod", () => {
    // Absent throughout the previous sitemap, and the strongest recrawl signal
    // a crawler has.
    const urls = [...sitemap.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => m[1]);
    const without = urls.filter((u) => !u.includes("<lastmod>"));
    expect(without).toEqual([]);
  });

  it("has no duplicate entries", () => {
    expect(locs.length).toBe(new Set(locs).size);
  });

  it("every listed URL resolves to a file that exists", () => {
    const missing = [];
    for (const loc of locs) {
      const path = loc.replace("https://datiq.app", "") || "/";
      if (path === "/") continue; // served by dist/index.html, not public/
      const clean = path.replace(/^\//, "").replace(/\/$/, "");
      const ok =
        existsSync(join(PUBLIC, clean, "index.html")) ||
        existsSync(join(PUBLIC, `${clean}.html`)) ||
        existsSync(join(PUBLIC, clean));
      if (!ok) missing.push(path);
    }
    expect(missing).toEqual([]);
  });

  it("lists no URL that is 301'd elsewhere", async () => {
    // Listing a redirect wastes crawl budget and muddies the signal the 301
    // is trying to send.
    const { REDIRECTS } = await import("./site-routes.mjs");
    const retired = REDIRECTS.map((r) => `https://datiq.app${r.from}`);
    const leaked = locs.filter((l) => retired.includes(l));
    expect(leaked).toEqual([]);
  });
});
