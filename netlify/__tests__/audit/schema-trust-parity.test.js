import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { INDEPENDENCE_IDS, TRUST_SIGNAL_IDS } from "../../../src/lib/discoverability/trustProof.js";
import { APPROVED_TYPE_IDS } from "../../../src/lib/discoverability/schemaIntelligence.js";

const RAW = readFileSync(
  join(process.cwd(), "supabase", "migrations", "0062_schema_trust.sql"), "utf8");

/**
 * ⚠️ COMMENTS ARE STRIPPED BEFORE MATCHING, and that is not tidiness.
 * An earlier draft asserted the file did not contain "SECURITY DEFINER" and
 * failed — on its own header comment explaining what to do IF one were ever
 * added. A structural test that reads prose is testing the prose.
 */
const SQL = RAW.replace(/^\s*--.*$/gm, "");

/** The values inside a `check (col in (...))`, parsed out of the migration. */
function checkValues(column) {
  const re = new RegExp(`${column}\\s+text\\s+not\\s+null[\\s\\S]{0,120}?check\\s*\\(\\s*${column}\\s+in\\s*\\(([^)]+)\\)`, "i");
  const m = SQL.match(re);
  if (!m) return null;
  return m[1].split(",").map((v) => v.trim().replace(/^'|'$/g, "")).filter(Boolean).sort();
}

describe("🔴 the constraint is PARSED out of the migration, never restated", () => {
  // A copy drifts exactly as EVENT_TO_SOURCE did — eight event kinds querying
  // for a value no row could hold, silently matching nothing. The same reason
  // local-directory-parity.test.js parses 0058's tier CHECK rather than
  // listing the tiers again.
  it("independence in the model matches the CHECK in 0062", () => {
    expect(checkValues("independence")).toEqual([...INDEPENDENCE_IDS].sort());
  });

  it("...and the parser is actually finding something", () => {
    // Guard against the regex silently matching nothing and the test passing
    // by comparing null to null — green for the wrong reason, which this
    // module has now hit three times.
    expect(checkValues("independence")).not.toBeNull();
    expect(checkValues("independence").length).toBe(3);
  });
});

describe("⚠️ `signal` is deliberately NOT constrained", () => {
  it("has no CHECK enumerating the trust signals", () => {
    // A new trust source is a code change, not a migration — the same
    // departure 0058 made for directory source ids. The TIER-equivalent
    // (independence) is constrained instead, because widening THAT is a
    // deliberate scoring change.
    expect(checkValues("signal")).toBeNull();
    for (const id of TRUST_SIGNAL_IDS) {
      expect(SQL).not.toMatch(new RegExp(`check[\\s\\S]{0,200}'${id}'`));
    }
  });
});

describe("the 0062 invariants that carry meaning", () => {
  it("a third_party observation requires a source_url at the DATABASE level", () => {
    // An independent record nobody can check is not an independent record.
    // Enforced in the model AND here, because the model is not the only writer.
    expect(SQL).toMatch(/check\s*\(\s*independence\s*<>\s*'third_party'\s+or\s+source_url\s+is\s+not\s+null\s*\)/i);
  });

  it("both upsert arbiters name COLUMNS with NULLS NOT DISTINCT", () => {
    // 0059's lesson: PostgREST can only name column arbiters, and an
    // expression index over a nullable column enforces the invariant while
    // refusing every save.
    const constraints = SQL.match(/unique\s+nulls\s+not\s+distinct\s*\([^)]+\)/gi) || [];
    expect(constraints).toHaveLength(2);
    expect(SQL).not.toMatch(/create unique index[\s\S]{0,200}coalesce/i);
  });

  it("both tables are RLS-locked to service_role and revoked from anon", () => {
    for (const t of ["audit_schema_entities", "audit_trust_evidence"]) {
      expect(SQL).toMatch(new RegExp(`alter table public\\.${t}\\s+enable row level security`, "i"));
      expect(SQL).toMatch(new RegExp(`revoke all on public\\.${t}\\s+from anon, authenticated`, "i"));
    }
  });

  it("declares no SECURITY DEFINER function — so there is no grant to get wrong", () => {
    // If one is ever added it must revoke from `public`, not just anon, which
    // is a no-op while PUBLIC holds the default grant (0061).
    expect(SQL).not.toMatch(/security\s+definer/i);
  });
});

describe("the approved schema types are a short, deliberate list", () => {
  it("excludes WebSite, exactly as EA-11 does", () => {
    // The sitelinks search-box pattern is a WebSite block with url +
    // potentialAction and no name — common AND correct.
    expect(APPROVED_TYPE_IDS).not.toContain("WebSite");
  });

  it("stays short enough that its findings are readable", () => {
    // schema.org has hundreds of types and almost none decide whether an
    // answer engine can resolve a business. Validating everything buries the
    // two findings that matter.
    expect(APPROVED_TYPE_IDS.length).toBeLessThanOrEqual(12);
  });
});
