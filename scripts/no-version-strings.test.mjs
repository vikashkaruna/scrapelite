// scripts/no-version-strings.test.mjs — plan §22, decision D22a.
//
// Product version numbers are not shown to visitors any more. A "V1.0.0" tag
// in the footer read as a mystery link, and every release number on a public
// page went stale the day after it shipped. This fails the build if one
// comes back.
//
// ⚠️ `/api/v1` and the developer page's API version are API PATHS, not product
// versions, and are allowed — the pattern is an upper-case V followed by
// "digits.digits", which an API path never is.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..") + "/";
const VERSION = /(?<![\w.])V\d+\.\d+/g;

function walk(dir, keep) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, keep));
    else if (keep(p)) out.push(p);
  }
  return out;
}

const isSource = (p) => /\.(jsx?|mjs)$/.test(p) && !/\.test\.|\.spec\./.test(p);
const SURFACES = [
  ...walk(join(ROOT, "src/pages"), isSource).filter((p) => !p.includes("/admin/")),
  ...walk(join(ROOT, "src/components"), isSource),
  join(ROOT, "src/lib/pageSeo.js"),
  join(ROOT, "public/llms.txt"),
  join(ROOT, "public/llms-full.txt"),
  join(ROOT, "docs/DatIQ-User-Guide.md"),
  ...walk(join(ROOT, "public"), (p) => p.endsWith(".html")),
].filter((p) => existsSync(p));

describe("no product version numbers on public surfaces (D22a)", () => {
  it("scans a real set of files", () => {
    expect(SURFACES.length).toBeGreaterThan(50);
  });

  it.each(SURFACES.map((p) => [p.slice(ROOT.length), p]))("%s", (_rel, p) => {
    const hits = readFileSync(p, "utf8").match(VERSION) || [];
    expect(hits).toEqual([]);
  });

  it("the pattern catches a version and ignores an API path or SVG path data", () => {
    expect("DatIQ V1.0.0".match(VERSION)).toEqual(["V1.0"]);
    expect("GET /api/v1/audits".match(VERSION)).toBeNull();
    expect('d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09V7.07H2.18"'.match(VERSION)).toBeNull();
  });
});
