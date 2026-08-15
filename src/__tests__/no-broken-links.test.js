// src/__tests__/no-broken-links.test.js
//
// Every client-side navigation target in src/ must resolve to a declared
// <Route>, or be an intentional full page load to a static-owned URL.
//
// ── Why this exists ──────────────────────────────────────────────────────
// src/pages/BattleCard.jsx shipped `<Link to="/vs/firecrawl">` while App.jsx
// had no matching <Route>. Clicking it inside the app landed on NotFound.
// Opening the same URL directly worked perfectly, because a static file serves
// it — so the bug was invisible unless you happened to click it, and its unit
// test passed because it asserted only the href STRING:
//
//     expect(screen.getByText(/DatIQ vs Firecrawl/i).getAttribute("href"))
//       .toBe("/vs/firecrawl");
//
// A string equality check can never catch this. Resolution has to be checked
// against the actual route table, which is what this file does.
//
// The distinction that matters: <Link to> and navigate() are CLIENT-SIDE and
// need a Route. A plain <a href> is a full page load and only needs the URL to
// exist on the server — which is the correct way to link a static-owned page.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = join(ROOT, "src");
const PUBLIC = join(ROOT, "public");

const appJsx = readFileSync(join(ROOT, "src/App.jsx"), "utf8");
const allPaths = [...appJsx.matchAll(/path="([^"]*)"/g)].map((m) => m[1]);
const routes = allPaths.filter((p) => p.startsWith("/"));

// Nested routes are declared RELATIVELY. The admin console lives in its own
// <Routes> under /admin with children like path="revenue", so a
// navigate("/admin/revenue") has no literal path="/admin/revenue" anywhere and
// would otherwise read as broken. Compose the relative paths under each
// absolute parent so they resolve for real, rather than exempting /admin
// wholesale — which would blind the check to a genuinely wrong admin link.
const relative = allPaths.filter((p) => p && !p.startsWith("/") && p !== "*");
const parents = routes.filter((r) => !r.includes(":") && !r.includes("*"));
const composed = parents.flatMap((p) => relative.map((c) => `${p.replace(/\/$/, "")}/${c}`));

const exact = new Set([...routes.filter((r) => !r.includes(":") && !r.includes("*")), ...composed]);
const prefixes = routes.filter((r) => r.includes(":") || r.includes("*")).map((r) => r.split(/[:*]/)[0]);

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === "__tests__" || name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(jsx?|tsx?)$/.test(name) && !/\.test\./.test(name)) acc.push(p);
  }
  return acc;
}

/** Client-side navigation targets: <Link to="…"> and navigate("…"). */
function clientTargets(src) {
  const out = [];
  for (const m of src.matchAll(/\bto=["'](\/[A-Za-z0-9/_-]*)["']/g)) out.push(m[1]);
  for (const m of src.matchAll(/\bnavigate\(\s*["'](\/[A-Za-z0-9/_-]*)["']/g)) out.push(m[1]);
  return out;
}

function resolves(target) {
  if (exact.has(target)) return true;
  return prefixes.some((p) => p && target.startsWith(p));
}

/** Does the URL exist as a real file that the server can return? */
function servedStatically(target) {
  const clean = target.replace(/^\//, "");
  return (
    existsSync(join(PUBLIC, clean, "index.html")) ||
    existsSync(join(PUBLIC, `${clean}.html`))
  );
}

const files = walk(SRC);

describe("no broken in-app links", () => {
  it("found the route table and some source to scan", () => {
    expect(routes.length).toBeGreaterThan(20);
    expect(files.length).toBeGreaterThan(50);
  });

  it("every <Link to> / navigate() target resolves to a declared route", () => {
    const broken = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const target of clientTargets(src)) {
        if (resolves(target)) continue;
        const rel = file.replace(`${ROOT}/`, "");
        broken.push(
          servedStatically(target)
            // The precise shape of the BattleCard bug: the page is real, the
            // client-side link to it is not.
            ? `${rel}: "${target}" is a STATIC page — use <a href> for a full page load, not <Link>/navigate`
            : `${rel}: "${target}" matches no route and no static file`,
        );
      }
    }
    expect(broken).toEqual([]);
  });

  it("resolves nested admin routes without blanket-exempting /admin", () => {
    // Composed from parent "/admin" + relative child "revenue". If this ever
    // stopped working the check would either produce noise or, worse, be
    // "fixed" by exempting /admin entirely and stop catching real admin links.
    expect(exact.has("/admin")).toBe(true);
    expect(exact.has("/admin/revenue")).toBe(true);
    expect(exact.has("/admin/not-a-real-page")).toBe(false);
  });

  it("catches a client-side link to a static-only page", () => {
    // Self-test of the rule that matters, using the exact shape of the bug
    // that shipped. Without this, a regression in the matcher would make the
    // suite silently stop checking anything.
    expect(resolves("/vs/firecrawl")).toBe(false);
    expect(servedStatically("/vs/firecrawl")).toBe(true);
  });
});
