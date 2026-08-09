// healthModel.test.js — the service-health classification contract.
//
// The property under test throughout: "we could not check" and "it is broken"
// must never collapse into each other, in either direction.

import { describe, it, expect } from "vitest";
import {
  HEALTH_COMPONENTS, HEALTH_COMPONENT_IDS, HEALTH_GROUPS,
  componentById, componentsInGroup,
  HEALTH_STATUS, statusRank, healthStatusMeta,
  gradeLatency, latencyBudget, DEFAULT_LATENCY_BUDGET,
  classifyProbe, overallHealth, summarizeHealth,
  computeUptime, uptimeByComponent,
  statusPageIndicatorToStatus,
} from "./healthModel.js";

const NOW = new Date("2026-07-27T12:00:00.000Z");
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();
const MIN = 60_000;

// ── Registry ─────────────────────────────────────────────────────────────────

describe("HEALTH_COMPONENTS registry (H-01)", () => {
  it("covers hosting, data and external services", () => {
    expect(HEALTH_COMPONENT_IDS).toEqual([
      "netlify-site", "netlify-platform", "functions-runtime",
      "supabase-db", "supabase-auth", "supabase-platform",
      "email-resend", "payments-razorpay", "ai-providers", "scrape-providers",
    ]);
  });

  it("gives every component a label, group and description", () => {
    for (const c of HEALTH_COMPONENTS) {
      expect(c.label).toBeTruthy();
      expect(HEALTH_GROUPS.map((g) => g.id)).toContain(c.group);
      expect(c.description.length).toBeGreaterThan(10);
    }
  });

  it("marks the components whose failure actually breaks the product", () => {
    const critical = HEALTH_COMPONENTS.filter((c) => c.critical).map((c) => c.id);
    expect(critical).toEqual(["netlify-site", "functions-runtime", "supabase-db", "supabase-auth"]);
  });

  it("never marks a third-party status page as critical", () => {
    // A vendor status page being unreachable says nothing about our uptime.
    for (const id of ["netlify-platform", "supabase-platform", "payments-razorpay"]) {
      expect(componentById(id).critical).toBeFalsy();
    }
  });

  it("groups components without losing any", () => {
    const grouped = HEALTH_GROUPS.flatMap((g) => componentsInGroup(g.id));
    expect(grouped).toHaveLength(HEALTH_COMPONENTS.length);
  });

  it("returns null for an unknown id", () => {
    expect(componentById("nope")).toBeNull();
  });
});

// ── Latency ──────────────────────────────────────────────────────────────────

describe("gradeLatency (H-02)", () => {
  it("grades against the component's own budget, not a global one", () => {
    // 400ms is slow for a same-region database and fine for a status page.
    expect(gradeLatency(400, "supabase-db")).toBe("ok");
    expect(gradeLatency(900, "supabase-db")).toBe("slow");
    expect(gradeLatency(900, "netlify-platform")).toBe("ok");
  });

  it("grades fast/ok/slow at the boundaries", () => {
    const { fast, slow } = latencyBudget("supabase-db");
    expect(gradeLatency(fast, "supabase-db")).toBe("fast");
    expect(gradeLatency(fast + 1, "supabase-db")).toBe("ok");
    expect(gradeLatency(slow, "supabase-db")).toBe("slow");
  });

  it("falls back to the default budget for an unbudgeted component", () => {
    expect(latencyBudget("ai-providers")).toEqual(DEFAULT_LATENCY_BUDGET);
  });

  it("returns null when there is no measurement", () => {
    expect(gradeLatency(null, "supabase-db")).toBeNull();
    expect(gradeLatency(undefined, "supabase-db")).toBeNull();
    expect(gradeLatency("abc", "supabase-db")).toBeNull();
    expect(gradeLatency(-1, "supabase-db")).toBeNull();
  });
});

// ── Probe classification ─────────────────────────────────────────────────────

describe("classifyProbe (H-03)", () => {
  it("classifies a fast reachable component as operational", () => {
    const c = classifyProbe({ id: "supabase-db", configured: true, reachable: true, latencyMs: 80 });
    expect(c.status).toBe(HEALTH_STATUS.OK);
    expect(c.latencyGrade).toBe("fast");
    expect(c.critical).toBe(true);
    expect(c.label).toBe("Supabase database");
  });

  // The whole point of the file.
  it("reports an unconfigured component as unknown, never as down", () => {
    const c = classifyProbe({ id: "email-resend", configured: false });
    expect(c.status).toBe(HEALTH_STATUS.UNKNOWN);
    expect(c.status).not.toBe(HEALTH_STATUS.DOWN);
  });

  it("names the missing env vars in the unconfigured note", () => {
    const c = classifyProbe({ id: "supabase-db", configured: false });
    expect(c.note).toContain("SUPABASE_URL");
    expect(c.note).toContain("SUPABASE_SERVICE_KEY");
  });

  it("reports an unreachable component as down", () => {
    const c = classifyProbe({ id: "supabase-db", configured: true, reachable: false, note: "ETIMEDOUT" });
    expect(c.status).toBe(HEALTH_STATUS.DOWN);
    expect(c.note).toBe("ETIMEDOUT");
  });

  it("reports a reachable-but-slow component as degraded", () => {
    const c = classifyProbe({ id: "supabase-db", configured: true, reachable: true, latencyMs: 3000 });
    expect(c.status).toBe(HEALTH_STATUS.DEGRADED);
    expect(c.note).toContain("3000ms");
  });

  it("lets a probe classify itself when latency cannot express the answer", () => {
    // A status page saying "partial outage" answers fast and is still not OK.
    const c = classifyProbe({
      id: "netlify-platform", configured: true, reachable: true,
      latencyMs: 120, status: HEALTH_STATUS.DEGRADED,
    });
    expect(c.status).toBe(HEALTH_STATUS.DEGRADED);
  });

  it("ignores a self-reported status that is not in the vocabulary", () => {
    const c = classifyProbe({
      id: "supabase-db", configured: true, reachable: true, latencyMs: 50, status: "probably-fine",
    });
    expect(c.status).toBe(HEALTH_STATUS.OK);
  });

  it("carries detail and checkedAt through untouched", () => {
    const c = classifyProbe({
      id: "netlify-site", configured: true, reachable: true, latencyMs: 100,
      detail: { state: "current", branch: "main" }, checkedAt: NOW.toISOString(),
    });
    expect(c.detail).toEqual({ state: "current", branch: "main" });
    expect(c.checkedAt).toBe(NOW.toISOString());
  });

  it("survives an id that is not in the registry", () => {
    const c = classifyProbe({ id: "future-thing", configured: true, reachable: true, latencyMs: 10 });
    expect(c.label).toBe("future-thing");
    expect(c.critical).toBe(false);
    expect(c.status).toBe(HEALTH_STATUS.OK);
  });
});

// ── Overall verdict ──────────────────────────────────────────────────────────

const comp = (id, status, critical) => ({ id, status, critical });

describe("overallHealth (H-04)", () => {
  it("is operational when everything known is operational", () => {
    expect(overallHealth([
      comp("supabase-db", HEALTH_STATUS.OK, true),
      comp("email-resend", HEALTH_STATUS.OK, false),
    ])).toBe(HEALTH_STATUS.OK);
  });

  it("is down when a critical component is down", () => {
    expect(overallHealth([
      comp("supabase-db", HEALTH_STATUS.DOWN, true),
      comp("email-resend", HEALTH_STATUS.OK, false),
    ])).toBe(HEALTH_STATUS.DOWN);
  });

  // Mail being down is real, and it is not an outage of the product.
  it("caps a non-critical failure at degraded", () => {
    expect(overallHealth([
      comp("supabase-db", HEALTH_STATUS.OK, true),
      comp("email-resend", HEALTH_STATUS.DOWN, false),
    ])).toBe(HEALTH_STATUS.DEGRADED);
  });

  it("is degraded when a critical component is merely slow", () => {
    expect(overallHealth([comp("supabase-db", HEALTH_STATUS.DEGRADED, true)]))
      .toBe(HEALTH_STATUS.DEGRADED);
  });

  // Unchecked components must not be able to move the headline in either
  // direction — neither manufacturing an outage nor masking one.
  it("ignores unknown components entirely", () => {
    expect(overallHealth([
      comp("supabase-db", HEALTH_STATUS.OK, true),
      comp("payments-razorpay", HEALTH_STATUS.UNKNOWN, false),
    ])).toBe(HEALTH_STATUS.OK);

    expect(overallHealth([
      comp("supabase-db", HEALTH_STATUS.DOWN, true),
      comp("payments-razorpay", HEALTH_STATUS.UNKNOWN, false),
    ])).toBe(HEALTH_STATUS.DOWN);
  });

  it("is unknown when nothing at all could be checked", () => {
    expect(overallHealth([
      comp("a", HEALTH_STATUS.UNKNOWN, true), comp("b", HEALTH_STATUS.UNKNOWN, false),
    ])).toBe(HEALTH_STATUS.UNKNOWN);
    expect(overallHealth([])).toBe(HEALTH_STATUS.UNKNOWN);
  });
});

describe("summarizeHealth (H-05)", () => {
  it("counts each status and attaches the headline", () => {
    const out = summarizeHealth([
      comp("a", HEALTH_STATUS.OK, true), comp("b", HEALTH_STATUS.OK, false),
      comp("c", HEALTH_STATUS.DEGRADED, false), comp("d", HEALTH_STATUS.DOWN, false),
      comp("e", HEALTH_STATUS.UNKNOWN, false),
    ]);
    expect(out).toMatchObject({ total: 5, ok: 2, degraded: 1, down: 1, unknown: 1 });
    expect(out.overall).toBe(HEALTH_STATUS.DEGRADED);
  });
});

describe("status vocabulary (H-06)", () => {
  it("ranks down above degraded above ok above unknown", () => {
    expect(statusRank(HEALTH_STATUS.DOWN)).toBeGreaterThan(statusRank(HEALTH_STATUS.DEGRADED));
    expect(statusRank(HEALTH_STATUS.DEGRADED)).toBeGreaterThan(statusRank(HEALTH_STATUS.OK));
    expect(statusRank(HEALTH_STATUS.OK)).toBeGreaterThan(statusRank(HEALTH_STATUS.UNKNOWN));
  });

  it("gives every status a label, tone and icon", () => {
    for (const s of Object.values(HEALTH_STATUS)) {
      const m = healthStatusMeta(s);
      expect(m.label).toBeTruthy();
      expect(["ok", "warn", "danger", "muted"]).toContain(m.tone);
      expect(m.icon).toBeTruthy();
    }
  });

  it("falls back to the unknown presentation for a bad status", () => {
    expect(healthStatusMeta("bananas").label).toBe("Not checked");
  });
});

// ── Uptime ───────────────────────────────────────────────────────────────────

const sample = (status, minsAgo, latency) =>
  ({ component: "supabase-db", status, observed_at: ago(minsAgo * MIN), latency_ms: latency });

describe("computeUptime (H-07)", () => {
  it("computes availability, average and peak latency", () => {
    const out = computeUptime([
      sample(HEALTH_STATUS.OK, 10, 100),
      sample(HEALTH_STATUS.OK, 70, 200),
      sample(HEALTH_STATUS.DOWN, 130, null),
      sample(HEALTH_STATUS.OK, 190, 300),
    ], { now: NOW });
    expect(out.samples).toBe(4);
    expect(out.uptimePct).toBe(75);
    expect(out.avgLatencyMs).toBe(200);
    expect(out.maxLatencyMs).toBe(300);
  });

  // Degraded means it answered. Counting it as downtime would make every slow
  // afternoon look like an outage.
  it("counts a degraded sample as available", () => {
    const out = computeUptime([
      sample(HEALTH_STATUS.OK, 10, 50), sample(HEALTH_STATUS.DEGRADED, 20, 3000),
    ], { now: NOW });
    expect(out.uptimePct).toBe(100);
  });

  // The single most important rule here: an hour with no evidence is not an
  // hour of downtime.
  it("excludes unknown samples from the calculation entirely", () => {
    const out = computeUptime([
      sample(HEALTH_STATUS.OK, 10, 50), sample(HEALTH_STATUS.UNKNOWN, 20, null),
    ], { now: NOW });
    expect(out.samples).toBe(1);
    expect(out.uptimePct).toBe(100);
  });

  it("ignores samples older than the window", () => {
    const out = computeUptime([
      sample(HEALTH_STATUS.OK, 10, 50),
      sample(HEALTH_STATUS.DOWN, 60 * 48, null), // two days ago
    ], { now: NOW });
    expect(out.samples).toBe(1);
    expect(out.uptimePct).toBe(100);
  });

  it("honours a custom window", () => {
    const out = computeUptime([
      sample(HEALTH_STATUS.OK, 10, 50), sample(HEALTH_STATUS.DOWN, 120, null),
    ], { now: NOW, windowMs: 60 * MIN });
    expect(out.samples).toBe(1);
  });

  // "No data" and "0% uptime" are wildly different messages to show an operator.
  it("returns null rather than 0% when there is nothing to measure", () => {
    expect(computeUptime([], { now: NOW })).toBeNull();
    expect(computeUptime([sample(HEALTH_STATUS.UNKNOWN, 5, null)], { now: NOW })).toBeNull();
  });

  it("keeps one decimal place", () => {
    const rows = Array.from({ length: 3 }, (_, i) => sample(HEALTH_STATUS.OK, i + 1, 10));
    rows.push(sample(HEALTH_STATUS.DOWN, 4, null));
    expect(computeUptime(rows, { now: NOW }).uptimePct).toBe(75);
  });

  it("skips rows with an unparseable timestamp", () => {
    const out = computeUptime([
      sample(HEALTH_STATUS.OK, 10, 50), { component: "x", status: "ok", observed_at: "nope" },
    ], { now: NOW });
    expect(out.samples).toBe(1);
  });

  it("accepts camelCase sample rows", () => {
    const out = computeUptime([
      { component: "supabase-db", status: "ok", observedAt: ago(5 * MIN), latencyMs: 42 },
    ], { now: NOW });
    expect(out.samples).toBe(1);
    expect(out.avgLatencyMs).toBe(42);
  });
});

describe("uptimeByComponent (H-08)", () => {
  it("buckets samples per component", () => {
    const out = uptimeByComponent([
      { component: "supabase-db", status: "ok", observed_at: ago(5 * MIN), latency_ms: 100 },
      { component: "supabase-db", status: "down", observed_at: ago(10 * MIN) },
      { component: "netlify-site", status: "ok", observed_at: ago(5 * MIN), latency_ms: 400 },
    ], { now: NOW });
    expect(out["supabase-db"].uptimePct).toBe(50);
    expect(out["netlify-site"].uptimePct).toBe(100);
  });

  it("omits components with no usable samples", () => {
    const out = uptimeByComponent([
      { component: "email-resend", status: "unknown", observed_at: ago(5 * MIN) },
    ], { now: NOW });
    expect(out["email-resend"]).toBeUndefined();
  });

  it("ignores rows with no component id", () => {
    expect(uptimeByComponent([{ status: "ok", observed_at: ago(MIN) }], { now: NOW })).toEqual({});
  });
});

// ── Statuspage translation ───────────────────────────────────────────────────

describe("statusPageIndicatorToStatus (H-09)", () => {
  it("maps every Atlassian Statuspage indicator", () => {
    expect(statusPageIndicatorToStatus("none")).toBe(HEALTH_STATUS.OK);
    expect(statusPageIndicatorToStatus("minor")).toBe(HEALTH_STATUS.DEGRADED);
    expect(statusPageIndicatorToStatus("maintenance")).toBe(HEALTH_STATUS.DEGRADED);
    expect(statusPageIndicatorToStatus("major")).toBe(HEALTH_STATUS.DOWN);
    expect(statusPageIndicatorToStatus("critical")).toBe(HEALTH_STATUS.DOWN);
  });

  it("is case-insensitive", () => {
    expect(statusPageIndicatorToStatus("MAJOR")).toBe(HEALTH_STATUS.DOWN);
  });

  // A vendor adding a new indicator must not silently read as "all clear".
  it("maps an unrecognised indicator to unknown, not ok", () => {
    expect(statusPageIndicatorToStatus("brand-new-thing")).toBe(HEALTH_STATUS.UNKNOWN);
    expect(statusPageIndicatorToStatus(null)).toBe(HEALTH_STATUS.UNKNOWN);
    expect(statusPageIndicatorToStatus(undefined)).toBe(HEALTH_STATUS.UNKNOWN);
  });
});
