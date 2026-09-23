// credit-chokepoint-parity.test.js — a module that spends money must bill
// somebody, and that has to fail the BUILD rather than be noticed later.
//
// ── WHY THIS TEST EXISTS ────────────────────────────────────────────────────
// docs/CREDITS-UNIFICATION-PROPOSAL.md §5 registers six surfaces that each
// made real provider calls and each charged nobody: enrichment, guests on
// /api/ai, scheduled Discoverability, prompt monitors, bulk enrichment and
// extraction schedules. Not one of them was caught by a test, because a
// surface that bills nobody produces no error — a missing charge looks
// exactly like a free feature.
//
// They were found by reading, one at a time, months apart. This suite is the
// reason the list should not grow again: it reads the real source and asserts
// that every production call to a cost-bearing function carries a metering
// context. A new module that adds an AI call and forgets to meter it goes red
// on the day it lands.
//
// ⚠️ IT ASSERTS THE CALL SITES, NOT A LIST OF MODULES. A hand-written list of
// "modules that should meter" is a copy of the truth and drifts from it — the
// exact defect that made STORE_EXPORTS and EVENT_TO_SOURCE go stale twice
// each. The choke points are discovered by grepping for them.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(process.cwd());

/** The functions that actually spend money. */
const CHOKE_POINTS = ["runChain", "runScrapeChain", "fetchWebVitals", "sampleCitations"];

/**
 * 🔴 THE PROPOSAL SAYS "EXACTLY FOUR FUNCTIONS SPEND MONEY". IT IS FIVE.
 *
 * Three of the four fetches a Discoverability run makes never touch
 * runScrapeChain — the raw HTML read, the robots.txt read behind the crawler
 * check, and the canonical HEAD all call fetchPublicUrl directly. Under the
 * four-choke-point model an audit would have been charged 16 against the 19
 * the same document prices it at, so the metering plan and the recount
 * disagreed with each other.
 *
 * fetchPublicUrl itself is the wrong boundary: it has nine callers, two of
 * which must never be charged (complianceEngine's robots read, which is a
 * gate, and scrapeProviders' own direct adapter, already charged by
 * runScrapeChain). fetchLayer is the narrowest boundary containing only audit
 * spend, so it meters its own three fetches.
 */
const FETCH_LAYER = "netlify/functions/lib/audit/fetchLayer.js";

/** Where each one is DEFINED — those files meter, they do not pass a meter. */
const DEFINITIONS = {
  runChain: "netlify/functions/lib/aiProviders.js",
  runScrapeChain: "netlify/functions/lib/scrapeProviders.js",
  fetchWebVitals: "netlify/functions/lib/audit/webVitals.js",
  sampleCitations: "netlify/functions/lib/audit/citationSampling.js",
};

/**
 * Call sites that legitimately pass no meter, each with a WRITTEN reason.
 *
 * ⚠️ An entry here is a claim that a call costs the customer nothing. It is
 * not a way to silence the test — a surface absent from both this map and the
 * metered set would look identical to one deliberately exempted, which is the
 * distinction UNROUTED_EVENTS had to be invented for in signalDispatch.
 */
const EXEMPT = {
  "netlify/functions/admin-ai-config.js":
    "Operator diagnostics on /admin/ai. A provider test button spends a ~16-token "
    + "completion to answer 'is this key alive'. Billing an admin for checking our "
    + "own configuration would charge a customer for our outage.",
};

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith(".js") && !name.includes(".test.")) out.push(full);
  }
  return out;
}

/** Text of the argument list of `name(` starting at `from`, paren-balanced. */
function argsAt(src, from) {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") {
      depth--;
      if (depth === 0) return src.slice(from, i + 1);
    }
  }
  return src.slice(from, from + 400);
}

const FILES = walk(join(ROOT, "netlify", "functions")).map((f) => ({
  path: relative(ROOT, f),
  src: readFileSync(f, "utf8"),
}));

describe("every cost-bearing function meters at its own choke point", () => {
  for (const fn of CHOKE_POINTS) {
    it(`${fn} records a charge`, () => {
      const src = readFileSync(join(ROOT, DEFINITIONS[fn]), "utf8");
      expect(src).toMatch(/from "\.{1,2}\/(\.\.\/)?creditMeter\.js"/);
      expect(src).toMatch(/meterRecord\(/);
    });
  }

  it("🔴 the audit's own fetch layer meters its three direct fetches", () => {
    const src = readFileSync(join(ROOT, FETCH_LAYER), "utf8");
    // raw HTML, the robots read behind the crawler check, and the canonical
    // HEAD — none of which passes through runScrapeChain.
    for (const stage of ["raw", "crawler", "canonical"]) {
      expect(src).toContain(`stage: "${stage}"`);
    }
    expect((src.match(/meterRecord\(/g) || []).length).toBeGreaterThanOrEqual(3);
  });

  it("does NOT meter inside fetchPublicUrl — two of its callers must stay free", () => {
    const src = readFileSync(join(ROOT, "netlify/functions/lib/publicUrl.js"), "utf8");
    expect(src).not.toMatch(/creditMeter/);
  });
});

describe("🔴 every production call to a cost-bearing function carries a meter", () => {
  const sites = [];
  for (const { path, src } of FILES) {
    if (Object.values(DEFINITIONS).includes(path)) continue;
    for (const fn of CHOKE_POINTS) {
      const re = new RegExp(`(?<![\\w.])${fn}\\s*\\(`, "g");
      let m;
      while ((m = re.exec(src))) {
        // Skip the import statement itself.
        const lineStart = src.lastIndexOf("\n", m.index) + 1;
        const line = src.slice(lineStart, src.indexOf("\n", m.index));
        if (/^\s*(import|export)\b/.test(line)) continue;
        sites.push({ path, fn, args: argsAt(src, m.index + m[0].length - 1) });
      }
    }
  }

  it("finds call sites at all — a parity test that matches nothing is not a test", () => {
    expect(sites.length).toBeGreaterThan(3);
  });

  for (const site of sites) {
    const exempt = EXEMPT[site.path];
    it(`${site.path} → ${site.fn}()${exempt ? " [exempt]" : ""}`, () => {
      if (exempt) {
        expect(exempt.length).toBeGreaterThan(40); // a reason, not a rubber stamp
        return;
      }
      expect(
        /\bmeter\b/.test(site.args),
        `${site.path} calls ${site.fn}() without a metering context, so this provider `
        + `call bills nobody. Pass \`meter: meterContext({ caller: "<surface>", userId })\`, `
        + `or add the path to EXEMPT with a written reason.`,
      ).toBe(true);
    });
  }
});

describe("the exempt list stays honest", () => {
  it("names no path that does not exist", () => {
    const known = new Set(FILES.map((f) => f.path));
    for (const path of Object.keys(EXEMPT)) expect(known.has(path)).toBe(true);
  });
});
