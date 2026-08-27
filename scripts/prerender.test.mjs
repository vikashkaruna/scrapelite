// scripts/prerender.test.mjs
//
// Guards the one behaviour in scripts/prerender.mjs whose failure is invisible.
//
// The output lands in public/, and Netlify serves public/ files BEFORE the SPA
// fallback — that is the point. But it means a naive static server would answer
// /pricing with public/pricing/index.html, i.e. the PREVIOUS run's output. Each
// run would then prerender a prerender: React would boot over already-rendered
// markup, the HTML would degrade slightly every time, and nothing would ever
// throw. serveDist() must force index.html for every prerenderable route.
//
// No browser is launched here — the server is exercised directly over HTTP.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
import { serveDist, forcedShellPaths, normalizeHtml, BANNER } from "./prerender.mjs";
import { prerenderableRoutes, generatedFileFor, REACT_OWNED, STATIC_OWNED } from "./site-routes.mjs";

const SHELL = "<html data-datiq-app><body>SPA SHELL</body></html>";
const STALE = "<html><body>PREVIOUS PRERENDER OUTPUT</body></html>";

let dist, server, port;

beforeAll(async () => {
  dist = mkdtempSync(join(tmpdir(), "datiq-prerender-"));
  writeFileSync(join(dist, "index.html"), SHELL);

  // Seed the trap: a generated file already sitting where a route resolves.
  mkdirSync(join(dist, "pricing"), { recursive: true });
  writeFileSync(join(dist, "pricing", "index.html"), STALE);

  // A static-owned page, which must still be served as itself.
  mkdirSync(join(dist, "vs", "firecrawl"), { recursive: true });
  writeFileSync(join(dist, "vs", "firecrawl", "index.html"), "<html>FIRECRAWL STATIC</html>");
  writeFileSync(join(dist, "robots.txt"), "User-agent: *");

  server = serveDist(dist);
  await new Promise((r) => server.listen(0, r));
  port = server.address().port;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  rmSync(dist, { recursive: true, force: true });
});

const get = async (path) => (await fetch(`http://localhost:${port}${path}`)).text();

describe("prerender server — the degradation trap", () => {
  it("serves the SPA shell for a prerenderable route, NOT its existing output", async () => {
    // The whole test file exists for this assertion.
    const body = await get("/pricing");
    expect(body).toContain("SPA SHELL");
    expect(body).not.toContain("PREVIOUS PRERENDER OUTPUT");
  });

  it("forces the shell for every prerenderable route", () => {
    const forced = forcedShellPaths();
    for (const r of prerenderableRoutes()) {
      expect(forced.has(r.path)).toBe(true);
    }
  });

  it("does not force the shell for static-owned pages", async () => {
    // Those are hand-written and must be served as themselves; prerendering
    // over them would destroy the source.
    const body = await get("/vs/firecrawl");
    expect(body).toContain("FIRECRAWL STATIC");
    for (const s of STATIC_OWNED) {
      expect(forcedShellPaths().has(s.path)).toBe(false);
    }
  });

  it("serves real assets normally", async () => {
    expect(await get("/robots.txt")).toContain("User-agent");
  });

  it("falls back to the shell for an unknown path, like netlify.toml does", async () => {
    expect(await get("/dashboard")).toContain("SPA SHELL");
  });

  it("tolerates a trailing slash", async () => {
    const body = await get("/pricing/");
    expect(body).not.toContain("PREVIOUS PRERENDER OUTPUT");
  });
});

describe("prerender — output stability", () => {
  it("normalizeHtml strips the banner so a re-run is a no-op", () => {
    // Without this, every run would rewrite every file and the pre-push
    // staleness gate would fire constantly and be ignored.
    const once = `${BANNER}\n<html>x</html>`;
    expect(normalizeHtml(once)).toBe("<html>x</html>");
    expect(normalizeHtml(normalizeHtml(once))).toBe("<html>x</html>");
  });

  it("strips the private-route guard from public pages", () => {
    // It can never fire on a prerendered page, and leaving it in publishes the
    // internal route list into every marketing page — which the release
    // readiness audit flags as admin leakage, correctly.
    //
    // Matched loosely on purpose: authored as a bare boolean attribute, but
    // the browser serialises it as `data-datiq-private-guard=""` in outerHTML,
    // so an exact-match regex silently fails and the guard ships anyway.
    const html = '<head><script data-datiq-private-guard="">var PRIVATE=["/admin"];</script></head>';
    expect(normalizeHtml(html)).not.toContain("/admin");
    expect(normalizeHtml('<script data-datiq-private-guard>x</script>')).not.toContain("script");
  });

  it("strips Razorpay's pre-mounted checkout DOM", () => {
    // The SDK mounts a full-screen fixed overlay, a "Test Mode" badge, and an
    // iframe whose unified_session_id changes on EVERY render. The volatile id
    // alone made /pricing permanently stale, which would have turned the
    // pre-push gate into noise; the overlay is a rendering hazard besides.
    const html =
      '<div class="razorpay-container"><span>Test Mode</span></div>' +
      '<iframe src="https://api.razorpay.com/v1/checkout/public?unified_session_id=ABC" ' +
      'class="razorpay-checkout-frame"></iframe><main>real content</main>';
    const out = normalizeHtml(html);
    expect(out).not.toContain("unified_session_id");
    expect(out).not.toContain("razorpay-checkout-frame");
    expect(out).toContain("real content");
  });

  it("is idempotent — normalising twice changes nothing", () => {
    // The property the staleness gate depends on.
    const html =
      `${BANNER}\n<div class="razorpay-container">x</div>` +
      '<script data-datiq-private-guard="">y</script><main>keep</main>';
    expect(normalizeHtml(normalizeHtml(html))).toBe(normalizeHtml(html));
  });
});

describe("prerender — route registry agreement", () => {
  it("the homepage IS prerendered", () => {
    // It used to be excluded, because its output file would have been
    // public/index.html and Vite copies public/ over the build output. The
    // clobber risk was real; excluding the route was the wrong remedy. It left
    // the site's highest-priority URL serving `<div id="root"></div>` and
    // nothing else to every crawler that does not run JavaScript.
    expect(prerenderableRoutes().map((r) => r.path)).toContain("/");
  });

  it("routes the homepage away from public/index.html", () => {
    expect(generatedFileFor("/")).toBe("home/index.html");
  });

  it("still throws rather than returning a clobbering path", () => {
    // THE invariant that survives the change: nothing may ever write
    // public/index.html, because that replaces Vite's entry point with a
    // snapshot of itself.
    expect(() => generatedFileFor("")).toThrow(/overwrite Vite/);
    expect(() => generatedFileFor("///")).toThrow(/overwrite Vite/);
  });

  it("forces the homepage rewrite so a real dist/index.html cannot win", () => {
    const toml = readFileSync(join(ROOT, "netlify.toml"), "utf8");
    expect(toml).toMatch(/to = "\/home\/index\.html"[\s\S]{0,60}force = true/);
  });

  it("maps routes to nested index.html files", () => {
    expect(generatedFileFor("/pricing")).toBe("pricing/index.html");
    expect(generatedFileFor("/use-cases/seo-audit")).toBe("use-cases/seo-audit/index.html");
  });

  it("every React-owned route is prerendered", () => {
    // Nothing is opted out any more. If a route ever needs to be, it must say
    // why here — a silently unprerendered public route is invisible to every
    // crawler that does not execute JavaScript.
    const skipped = REACT_OWNED.filter((r) => r.prerender === false).map((r) => r.path);
    expect(skipped).toEqual([]);
  });
});
