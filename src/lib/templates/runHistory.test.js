import { describe, it, expect } from "vitest";
import {
  filterRuns, summariseRuns, bucketOf, monthOf, monthsIn, templateKeysIn, RUN_FILTERS,
} from "./runHistory.js";
import { RUN_STATUS } from "./templateModel.js";

const run = (o = {}) => ({
  status: "complete", template_key: "account_brief", credits_actual: 8,
  created_at: "2026-09-01T10:00:00Z", input: { domain: "acme.com" }, ...o,
});

describe("buckets", () => {
  it("maps every shipped status to a bucket", () => {
    for (const s of Object.values(RUN_STATUS)) {
      expect(bucketOf({ status: s }), `status ${s}`).not.toBe("unknown");
    }
  });

  // Inventing a verdict about someone's run is worse than saying we don't
  // recognise the status.
  it("reports an unrecognised status as unknown, not as a failure", () => {
    expect(bucketOf({ status: "who_knows" })).toBe("unknown");
    expect(bucketOf({})).toBe("unknown");
  });

  // A partial produced real output AND stated a gap. Calling it success
  // overstates what the user got; calling it failure understates it.
  it("keeps partial as its own bucket, never folded into success or failure", () => {
    expect(bucketOf({ status: RUN_STATUS.PARTIAL })).toBe("partial");
    expect(bucketOf({ status: RUN_STATUS.NEEDS_REVIEW })).toBe("partial");
    expect(RUN_FILTERS.map((f) => f.key)).toContain("partial");
  });
});

describe("summariseRuns", () => {
  const runs = [
    run({ status: "complete", credits_actual: 8 }),
    run({ status: "partial", credits_actual: 5, created_at: "2026-09-02T10:00:00Z" }),
    run({ status: "failed", credits_actual: null, template_key: "discoverability_audit", created_at: "2026-08-30T10:00:00Z" }),
    run({ status: "running", credits_actual: null, credits_estimated: 99, created_at: "2026-09-03T10:00:00Z" }),
  ];

  // An estimate is what we GUESSED before doing the work. Showing it as spend
  // puts a number on a billing surface that no ledger row backs.
  it("sums actual credits and ignores estimates entirely", () => {
    expect(summariseRuns(runs).creditsSpent).toBe(13);
  });

  // Otherwise the rate dips every time someone starts a run and recovers when
  // it lands — movement no outcome caused.
  it("computes success rate over FINISHED runs only", () => {
    expect(summariseRuns(runs).successRate).toBeCloseTo(0.33, 2);
  });

  it("returns null, not 0, when nothing has finished", () => {
    expect(summariseRuns([run({ status: "running" })]).successRate).toBeNull();
    expect(summariseRuns([]).successRate).toBeNull();
    expect(summariseRuns([]).total).toBe(0);
  });

  it("scopes to a month when asked", () => {
    expect(summariseRuns(runs, { month: "2026-08" }).total).toBe(1);
    expect(summariseRuns(runs, { month: "2026-09" }).total).toBe(3);
  });

  it("ranks templates by use", () => {
    const t = summariseRuns(runs).byTemplate;
    expect(t[0]).toEqual({ key: "account_brief", count: 3 });
  });

  it("survives junk", () => {
    expect(() => summariseRuns(null)).not.toThrow();
    expect(() => summariseRuns([null, 7, {}])).not.toThrow();
  });
});

describe("filterRuns", () => {
  const runs = [
    run({ status: "complete", input: { domain: "acme.com" }, output_summary: "Acme sells widgets" }),
    run({ status: "failed", template_key: "competitor_pricing_tracker", input: { domain: "beta.io" }, created_at: "2026-08-01T10:00:00Z" }),
    run({ status: "partial", input: { domain: "gamma.dev" } }),
  ];

  it("filters by bucket, template and month", () => {
    expect(filterRuns(runs, { bucket: "failed" })).toHaveLength(1);
    expect(filterRuns(runs, { templateKey: "competitor_pricing_tracker" })).toHaveLength(1);
    expect(filterRuns(runs, { month: "2026-08" })).toHaveLength(1);
  });

  it("'all' means all", () => {
    expect(filterRuns(runs, { bucket: "all", templateKey: "all", month: "all" })).toHaveLength(3);
    expect(filterRuns(runs, {})).toHaveLength(3);
  });

  // Nobody remembers a run id, so it is deliberately not searchable.
  it("searches what the user can see — target, summary, template — not the id", () => {
    expect(filterRuns(runs, { query: "beta.io" })).toHaveLength(1);
    expect(filterRuns(runs, { query: "widgets" })).toHaveLength(1);
    expect(filterRuns(runs, { query: "ACME" })).toHaveLength(1); // case-insensitive
    expect(filterRuns(runs, { query: "trun_" })).toHaveLength(0);
  });

  // ⚠️ The parameter is `bucket`, not `status`. They coincide for "failed",
  // so confusing them passes a first test and fails later on complete vs
  // succeeded — which is exactly what happened while writing these.
  it("combines filters", () => {
    expect(filterRuns(runs, { bucket: "succeeded", query: "acme" })).toHaveLength(1);
    expect(filterRuns(runs, { bucket: "failed", query: "acme" })).toHaveLength(0);
  });

  it("returns newest first", () => {
    const out = filterRuns([
      run({ created_at: "2026-08-01T10:00:00Z", input: { domain: "old.com" } }),
      run({ created_at: "2026-09-01T10:00:00Z", input: { domain: "new.com" } }),
    ]);
    expect(out[0].input.domain).toBe("new.com");
  });

  it("survives junk without throwing", () => {
    expect(filterRuns(null)).toEqual([]);
    expect(() => filterRuns([null, {}, 5], { query: "x" })).not.toThrow();
  });
});

describe("filter option helpers", () => {
  it("lists the distinct templates and months present", () => {
    const runs = [run({ template_key: "a" }), run({ template_key: "b" }), run({ template_key: "a", created_at: "2026-07-01T00:00:00Z" })];
    expect(templateKeysIn(runs)).toEqual(["a", "b"]);
    expect(monthsIn(runs)).toEqual(["2026-09", "2026-07"]); // newest first
  });
  it("monthOf is UTC, matching the credit ledger's basis", () => {
    expect(monthOf({ created_at: "2026-09-01T00:30:00Z" })).toBe("2026-09");
    expect(monthOf({})).toBe("");
  });
});
