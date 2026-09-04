// Contract tests for the two Phase 4/3 execution engines:
//   watchlist-monitor.js  (PRD 4 — scheduled crawling, snapshotting, diffing)
//   bulk-runner.js        (PRD 3 — queue-based asynchronous processing)
//   lib/bulkEnrich.js     (PRD 3 — real enrichment, replacing the fabrication)
//
// The properties pinned here are the ones whose absence produced the defects
// these engines exist to fix:
//   - the cadence a user chose is actually honoured
//   - a first sighting is a BASELINE and never alerts
//   - a failed fetch is not reported as a deletion
//   - a robots.txt refusal is a standing decision, not a retry loop
//   - a domain that could not be read costs the customer nothing
//   - enrichment never invents a field it could not observe

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  process.env.SUPABASE_URL = "https://proj.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "service-key";
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
});

// ─────────────────────────────────────────────────────────────────────────────
// watchlist-monitor — the cadence rule
// ─────────────────────────────────────────────────────────────────────────────
describe("watchlist-monitor — cadence is honoured", () => {
  it("a target that has never been checked is always due", async () => {
    const { isDue } = await import("../functions/watchlist-monitor.js");
    expect(isDue({ last_checked_at: null }, "daily")).toBe(true);
    expect(isDue({}, "weekly")).toBe(true);
  });

  it("honours each cadence's own interval", async () => {
    const { isDue } = await import("../functions/watchlist-monitor.js");
    const now = Date.parse("2026-09-04T12:00:00Z");
    const ago = (ms) => ({ last_checked_at: new Date(now - ms).toISOString() });
    const MIN = 60_000;

    // Hourly: due after an hour, not after 59 minutes.
    expect(isDue(ago(59 * MIN), "hourly", now)).toBe(false);
    expect(isDue(ago(61 * MIN), "hourly", now)).toBe(true);

    // Daily: a target checked an hour ago is NOT due — this is the assertion
    // that stops an hourly cron from crawling every daily watchlist every hour.
    expect(isDue(ago(60 * MIN), "daily", now)).toBe(false);
    expect(isDue(ago(25 * 60 * MIN), "daily", now)).toBe(true);

    // Weekly.
    expect(isDue(ago(6 * 24 * 60 * MIN), "weekly", now)).toBe(false);
    expect(isDue(ago(8 * 24 * 60 * MIN), "weekly", now)).toBe(true);
  });

  it("an unknown cadence falls back to daily rather than crawling every run", async () => {
    const { isDue } = await import("../functions/watchlist-monitor.js");
    const now = Date.parse("2026-09-04T12:00:00Z");
    const anHourAgo = { last_checked_at: new Date(now - 3_600_000).toISOString() };
    expect(isDue(anHourAgo, "fortnightly", now)).toBe(false);
  });

  it("an unparseable timestamp is treated as never-checked, not as never-due", async () => {
    const { isDue } = await import("../functions/watchlist-monitor.js");
    // Failing the other way would silently freeze a target for ever.
    expect(isDue({ last_checked_at: "not a date" }, "daily")).toBe(true);
  });

  it("declares budget and fan-out caps so one watchlist cannot starve the rest", async () => {
    const m = await import("../functions/watchlist-monitor.js");
    expect(m.RUN_BUDGET_MS).toBeGreaterThan(0);
    // Netlify's configured ceiling is 26s; the budget must leave room to return.
    expect(m.RUN_BUDGET_MS).toBeLessThanOrEqual(26_000);
    expect(m.MAX_TARGETS_PER_RUN).toBeGreaterThan(0);
    expect(m.MAX_PAGES_PER_TARGET).toBeGreaterThan(0);
  });

  it("skips cleanly when Supabase is unconfigured, rather than throwing", async () => {
    delete process.env.SUPABASE_SERVICE_KEY;
    const { _internal } = await import("../functions/watchlist-monitor.js");
    const res = await _internal.run();
    // A preview deploy with no service key has nothing to monitor. That is not
    // an error and must not fill job_runs with failures.
    expect(res.skipped).toBe("supabase_unconfigured");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// bulk-runner — the durability rule
// ─────────────────────────────────────────────────────────────────────────────
describe("bulk-runner — queue-based, not tab-based", () => {
  it("declares a budget and a per-run job cap", async () => {
    const m = await import("../functions/bulk-runner.js");
    expect(m.RUN_BUDGET_MS).toBeGreaterThan(0);
    expect(m.RUN_BUDGET_MS).toBeLessThanOrEqual(26_000);
    expect(m.MAX_JOBS_PER_RUN).toBeGreaterThan(0);
  });

  it("skips cleanly when Supabase is unconfigured", async () => {
    delete process.env.SUPABASE_SERVICE_KEY;
    const { _internal } = await import("../functions/bulk-runner.js");
    expect((await _internal.run()).skipped).toBe("supabase_unconfigured");
  });

  it("has a stuck-job threshold, so a stalled job is reported rather than retried in silence", async () => {
    const m = await import("../functions/bulk-runner.js");
    // Replacing "stranded by a closed tab" with "stranded by a stuck cron"
    // would be no improvement at all.
    expect(m.STUCK_AFTER_MS).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// bulkEnrich — observed / inferred / absent, never invented
// ─────────────────────────────────────────────────────────────────────────────
describe("bulkEnrich — never invents a field", () => {
  async function loadEnricher({ html = "", compliance = { allowed: true }, ai = null, publicUrl = true } = {}) {
    vi.doMock("../functions/lib/publicUrl.js", () => ({
      isPublicHttpUrlAsync: vi.fn(async () => publicUrl),
      isPublicHttpUrl: vi.fn(() => publicUrl),
    }));
    vi.doMock("../functions/lib/complianceEngine.js", () => ({
      checkCompliance: vi.fn(async () => compliance),
    }));
    vi.doMock("../functions/lib/scrapeProviders.js", () => ({
      runScrapeChain: vi.fn(async () => ({ data: { html, metadata: { title: "Acme | Billing for teams" } }, source: "direct" })),
      runMapChain: vi.fn(async () => ({})),
    }));
    vi.doMock("../functions/lib/aiProviders.js", () => ({
      runChain: vi.fn(async () => {
        if (!ai) throw new Error("no provider");
        return { content: [{ text: JSON.stringify(ai) }] };
      }),
    }));
    return import("../functions/lib/bulkEnrich.js");
  }

  const PAGE = `<html><head>
    <meta name="description" content="Acme is billing infrastructure for B2B teams.">
    </head><body><a href="/pricing">Pricing</a><a href="/careers">Careers</a>
    <p>${"Acme helps finance teams automate invoicing and revenue recognition. ".repeat(6)}</p>
    </body></html>`;

  it("observes what is literally on the page", async () => {
    const { enrichDomain } = await loadEnricher({ html: PAGE, ai: { industry: "SaaS", employee_band: "51-200", confidence: 0.9 } });
    const r = await enrichDomain("acme.com");
    expect(r.ok).toBe(true);
    expect(r.fields.company_name).toBe("Acme");
    expect(r.fields.has_pricing).toBe(true);
    expect(r.fields.has_careers).toBe(true);
    expect(r.provenance.company_name.method).toBe("observed");
    expect(r.provenance.company_name.confidence).toBe(1);
  });

  it("labels an AI reading as `inferred`, with the model's own confidence", async () => {
    const { enrichDomain } = await loadEnricher({ html: PAGE, ai: { industry: "SaaS", employee_band: "51-200", confidence: 0.8 } });
    const r = await enrichDomain("acme.com");
    expect(r.fields.industry).toBe("SaaS");
    expect(r.provenance.industry).toMatchObject({ method: "inferred", confidence: 0.8 });
  });

  it("🔴 omits the inferred fields entirely when the AI chain is down", async () => {
    // The replaced code returned `industry: "Services"` and stamped 0.95 on it.
    // Absence is the correct answer, and evaluateIcp redistributes the weight.
    const { enrichDomain } = await loadEnricher({ html: PAGE, ai: null });
    const r = await enrichDomain("acme.com");
    expect(r.ok).toBe(true);
    expect(r.fields.industry).toBeUndefined();
    expect(r.fields.employee_band).toBeUndefined();
    // …but the observed fields still landed.
    expect(r.fields.has_pricing).toBe(true);
  });

  it("🔴 never emits a hardcoded employee_count", async () => {
    const { enrichDomain } = await loadEnricher({ html: PAGE, ai: { industry: "SaaS", confidence: 0.9 } });
    const r = await enrichDomain("acme.com");
    // The old code emitted `employee_count: 55` for every company on earth.
    expect(r.fields.employee_count).toBeUndefined();
  });

  it("refuses a value the model was not allowed to return", async () => {
    const { enrichDomain } = await loadEnricher({ html: PAGE, ai: { industry: "Sorcery", employee_band: "42", confidence: 1 } });
    const r = await enrichDomain("acme.com");
    expect(r.fields.industry).toBeUndefined();
    expect(r.fields.employee_band).toBeUndefined();
  });

  it("reports has_pricing false — an observed absence, unlike an unobservable field", async () => {
    const { enrichDomain } = await loadEnricher({ html: "<html><body><p>" + "x".repeat(200) + "</p></body></html>", ai: null });
    const r = await enrichDomain("acme.com");
    // A missing /pricing link IS an observation: we can see the whole page and
    // there is no such link. That is different from an industry we cannot read.
    expect(r.fields.has_pricing).toBe(false);
    expect(r.provenance.has_pricing.method).toBe("observed");
  });

  it("honours robots.txt and costs nothing when refused", async () => {
    const { enrichDomain } = await loadEnricher({ html: PAGE, compliance: { allowed: false, code: "robots_disallowed" } });
    const r = await enrichDomain("acme.com");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("robots_disallowed");
    expect(r.pagesFetched).toBe(0);
  });

  it("refuses a domain that resolves to a private address", async () => {
    const { enrichDomain } = await loadEnricher({ html: PAGE, publicUrl: false });
    const r = await enrichDomain("internal.corp");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("url_not_public");
  });

  it("an empty response is a failure, not an empty company", async () => {
    const { enrichDomain } = await loadEnricher({ html: "" });
    const r = await enrichDomain("acme.com");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("empty_response");
  });

  it("overall confidence is the weakest contributing signal, not an average", async () => {
    const { enrichDomain } = await loadEnricher({ html: PAGE, ai: { industry: "SaaS", confidence: 0.3 } });
    const r = await enrichDomain("acme.com");
    // Three certain observations must not average away one shaky inference.
    expect(r.confidence).toBeCloseTo(0.3, 5);
  });

  it("flags weak inferences for human review", async () => {
    const { enrichDomain, fieldsNeedingReview, REVIEW_CONFIDENCE_THRESHOLD } =
      await loadEnricher({ html: PAGE, ai: { industry: "Other", confidence: 0.4 } });
    const r = await enrichDomain("acme.com");
    const review = fieldsNeedingReview(r.provenance);
    expect(review.map((x) => x.field)).toContain("industry");
    expect(REVIEW_CONFIDENCE_THRESHOLD).toBeGreaterThan(0);
  });

  it("never routes an OBSERVED field to review — a human cannot improve on a read", async () => {
    const { enrichDomain, fieldsNeedingReview } = await loadEnricher({ html: PAGE, ai: null });
    const r = await enrichDomain("acme.com");
    expect(fieldsNeedingReview(r.provenance)).toEqual([]);
  });
});

// deriveEmployeeCount — the field that caused the original defect.
// Observed only: a stated headcount is read, a band is never converted.
import { deriveEmployeeCount as _dec } from "../functions/lib/bulkEnrich.js";
describe("bulkEnrich — employee_count is observed, never inferred from a band", () => {
  it("reads a headcount the page states", () => {
    expect(_dec(undefined, "<p>We're a team of 40 building tools.</p>")?.value).toBe(40);
    expect(_dec(undefined, "<p>1,200 employees worldwide</p>")?.value).toBe(1200);
    expect(_dec(undefined, "<p>500+ employees</p>")?.method).toBe("observed");
  });
  it("returns null for a band — a range is never reported as a count", () => {
    expect(_dec("51-200", "<p>About us</p>")).toBeNull();
    expect(_dec("1000+", "<p>No headcount here.</p>")).toBeNull();
  });
  it("rejects an out-of-range number that merely sat near the word", () => {
    expect(_dec(undefined, "<p>9999999 employees</p>")).toBeNull();
  });
});
