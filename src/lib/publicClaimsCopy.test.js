// src/lib/publicClaimsCopy.test.js — plan §22: the public pages must describe
// what the code actually ships.
//
// Same idea as publicPricingCopy.test.js, for the claims Phase D2 added:
//   - the role list is DERIVED from PERSONAS, so a new or renamed role fails
//     here until every public surface names it;
//   - any "N templates" / "N ship today" claim must equal the catalogue size —
//     the FAQ and llms files said "Seven ship today" for weeks after the
//     catalogue reached twenty;
//   - the /vs/* pages must not carry retired DatIQ prices. They are hand-written
//     HTML, which is why they still quoted $4.80 / $44.40 / $106.80 and
//     "10 extractions" after the repricing that the pricing guard enforced
//     everywhere else.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { PERSONAS } from "./personaConfig.js";
import { SEED_TEMPLATES } from "./templates/seedTemplates.js";

const read = (p) => readFileSync(resolve(process.cwd(), p), "utf8");
const decode = (s) => s.replace(/&amp;/g, "&");

const ROLE_SURFACES = [
  "public/faq/index.html",
  "public/llms.txt",
  "public/llms-full.txt",
  "docs/DatIQ-User-Guide.md",
  "src/pages/Changelog.jsx",
  "src/pages/Blog.jsx",
];

describe("public copy — roles match PERSONAS", () => {
  for (const file of ROLE_SURFACES) {
    it(`${file} names every offered role`, () => {
      const text = decode(read(file));
      const missing = PERSONAS.map((p) => p.label).filter((l) => !text.includes(l));
      expect(missing).toEqual([]);
    });
  }
});

const WORDS = { seven: 7, ten: 10, twelve: 12, fifteen: 15, twenty: 20, "twenty-one": 21 };
const COUNT_SURFACES = [
  "public/faq/index.html", "public/llms.txt", "public/llms-full.txt",
  "docs/DatIQ-User-Guide.md", "src/pages/Changelog.jsx", "src/lib/pageSeo.js",
  "src/pages/UseCases.jsx",
  ...readdirSync(resolve(process.cwd(), "public/vs"))
    .map((d) => join("public/vs", d, "index.html"))
    .filter((p) => existsSync(resolve(process.cwd(), p))),
];

/** Every template-count claim in a text, as numbers. */
export function templateCountClaims(text) {
  const out = [];
  for (const m of text.matchAll(/\b(\d+)\s+(?:end-to-end\s+)?(?:workflow\s+)?templates\b/gi)) out.push(Number(m[1]));
  for (const m of text.matchAll(/\b([A-Za-z-]+)\s+ship today\b/g)) {
    const n = WORDS[m[1].toLowerCase()];
    if (n) out.push(n);
  }
  return out;
}

describe("public copy — template count matches the catalogue", () => {
  it("the detector finds both spellings", () => {
    expect(templateCountClaims("Seven ship today. 7 end-to-end workflow templates. 20 templates")).toEqual([7, 20, 7]);
  });
  for (const file of COUNT_SURFACES) {
    it(`${file}`, () => {
      const wrong = templateCountClaims(read(file)).filter((n) => n !== SEED_TEMPLATES.length);
      expect(wrong).toEqual([]);
    });
  }
});

describe("comparison pages carry no retired DatIQ prices", () => {
  const RETIRED = ["$4.80", "$44.40", "$106.80", "10 extractions", "25 trial credits"];
  const dir = resolve(process.cwd(), "public/vs");
  const statics = ["browse-ai", "clay", "firecrawl", "apify", "phantombuster"];
  for (const slug of statics) {
    it(`/vs/${slug}`, () => {
      const text = readFileSync(join(dir, slug, "index.html"), "utf8");
      expect(RETIRED.filter((r) => text.includes(r))).toEqual([]);
    });
  }
});
