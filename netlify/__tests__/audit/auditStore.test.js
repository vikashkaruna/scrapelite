import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocked at the CONNECTION boundary, not at `fetch`, so the real request
// shaping — paths, Prefer headers, body serialisation — is exercised.
const serviceDb = vi.fn();
vi.mock("../../functions/lib/requireEntitlement.js", () => ({
  getServiceDb: (...a) => serviceDb(...a),
}));

const store = await import("../../functions/lib/audit/auditStore.js");

/** Every POST/PATCH this test saw, in order. */
let calls = [];

function mockFetch({ issueIds = ["issue-uuid-1", "issue-uuid-2"] } = {}) {
  calls = [];
  globalThis.fetch = vi.fn(async (url, init) => {
    const path = String(url).replace("https://db.test/", "");
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ path, method: init?.method, prefer: init?.headers?.Prefer, body });

    // PostgREST returns the inserted rows when asked for a representation.
    if (path === "audit_issues" && init?.method === "POST") {
      const rows = body.map((r, i) => ({ ...r, id: issueIds[i] ?? `issue-${i}` }));
      return { ok: true, status: 201, text: async () => JSON.stringify(rows) };
    }
    return { ok: true, status: 200, text: async () => "" };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  serviceDb.mockReturnValue({ base: "https://db.test", headers: { apikey: "k" } });
  mockFetch();
});

const RESULT = {
  finalScore: 61, seoScore: 60, aeoScore: 62, geoScore: 59,
  pillars: {}, coverage: 90, penaltyMultiplier: 1,
  scoreMath: { prePenaltyTotal: 61 },
  scoringModelVersion: "v2",
  facts: {}, evidence: {}, meta: { engine: {} },
  target: { page_type: "article" },
  issues: [
    {
      code: "EA-11", pillar: "entity_authority", severity: "critical",
      frameworks: ["seo", "geo"], title: "Entity markup is unusable",
      evidence: "Organization markup carries no name.",
      observed: "Organization markup carries no name.",
      inference: "A resolver has a node to build and no identity to attach.",
      rootCause: "entity_ambiguity", module: "schema_intelligence",
      owner: "seo", status: "open",
    },
    {
      code: "SH-01", pillar: "structural_hierarchy", severity: "critical",
      frameworks: ["seo"], title: "The page has no H1",
      evidence: "No H1 element is present.",
      observed: "No H1 element is present.",
      inference: "Nothing states the page's subject in one line.",
      rootCause: "weak_page_structure", module: "recommendation_studio",
      owner: "content", status: "open",
    },
  ],
  recommendations: [
    { code: "EA-11", pillar: "entity_authority", priority: "high", title: "Name the organization" },
    { code: "SH-01", pillar: "structural_hierarchy", priority: "high", title: "Add an H1" },
    // A recommendation whose code is not in the issue list. The unreachable
    // page path produces exactly this.
    { code: "TA-04", pillar: "technical_accessibility", priority: "high", title: "Return a 200" },
  ],
};

const rowsFor = (table) => calls.find((c) => c.path === table && c.method === "POST")?.body || [];

describe("persistResult — the link that was declared and never written", () => {
  it("writes issue_id on every recommendation whose finding exists", async () => {
    // 🔴 `audit_recommendations.issue_id` existed since migration 0030 and
    // NOTHING wrote it. Every recommendation was an orphan, so "which finding
    // produced this task" had no answer and the validation loop could not close.
    const r = await store.persistResult("user-1", "audit-1", RESULT);
    expect(r.ok).toBe(true);

    const recs = rowsFor("audit_recommendations");
    expect(recs.find((x) => x.code === "EA-11").issue_id).toBe("issue-uuid-1");
    expect(recs.find((x) => x.code === "SH-01").issue_id).toBe("issue-uuid-2");
  });

  it("leaves the link null rather than guessing when no issue matches", async () => {
    const recs = (await store.persistResult("user-1", "audit-1", RESULT), rowsFor("audit_recommendations"));
    expect(recs.find((x) => x.code === "TA-04").issue_id).toBeNull();
  });

  it("asks for the issue rows back, which is what makes the link possible", async () => {
    await store.persistResult("user-1", "audit-1", RESULT);
    const issueCall = calls.find((c) => c.path === "audit_issues");
    expect(issueCall.prefer).toBe("return=representation");
  });

  it("writes issues BEFORE recommendations", async () => {
    // Not an aesthetic ordering: the ids do not exist until the first insert
    // returns, so a concurrent write cannot produce the link at all.
    await store.persistResult("user-1", "audit-1", RESULT);
    const issueIdx = calls.findIndex((c) => c.path === "audit_issues");
    const recIdx = calls.findIndex((c) => c.path === "audit_recommendations");
    expect(issueIdx).toBeGreaterThanOrEqual(0);
    expect(issueIdx).toBeLessThan(recIdx);
  });

  it("still marks the audit completed only AFTER every child is written", async () => {
    // The ordering guarantee this function has always had. A partial failure
    // must leave the audit visibly `running` rather than showing a finished
    // audit with a score and no evidence behind it.
    await store.persistResult("user-1", "audit-1", RESULT);
    const completeIdx = calls.findIndex((c) => c.method === "PATCH" && /audits\?id=/.test(c.path));
    const lastChild = Math.max(
      calls.findIndex((c) => c.path === "audit_issues"),
      calls.findIndex((c) => c.path === "audit_recommendations"),
      calls.findIndex((c) => c.path === "audit_results"),
    );
    expect(completeIdx).toBeGreaterThan(lastChild);
  });

  it("fails the audit and writes no recommendations when the issue insert fails", async () => {
    globalThis.fetch = vi.fn(async (url, init) => {
      const path = String(url).replace("https://db.test/", "");
      calls.push({ path, method: init?.method });
      if (path === "audit_issues") return { ok: false, status: 500, text: async () => "boom" };
      return { ok: true, status: 200, text: async () => "" };
    });
    calls = [];
    const r = await store.persistResult("user-1", "audit-1", RESULT);
    expect(r.ok).toBe(false);
    expect(calls.find((c) => c.path === "audit_recommendations")).toBeUndefined();
    // Marked failed, not left silently running.
    expect(calls.some((c) => c.method === "PATCH")).toBe(true);
  });
});

describe("persistResult — the gap-analysis fields reach the row", () => {
  it("stores the diagnosis, the referral and the owner", async () => {
    await store.persistResult("user-1", "audit-1", RESULT);
    const issue = rowsFor("audit_issues").find((x) => x.code === "EA-11");
    expect(issue.root_cause).toBe("entity_ambiguity");
    expect(issue.recommended_module).toBe("schema_intelligence");
    expect(issue.owner_role).toBe("seo");
    expect(issue.status).toBe("open");
  });

  it("stores observed and inference as two different values", async () => {
    await store.persistResult("user-1", "audit-1", RESULT);
    const issue = rowsFor("audit_issues").find((x) => x.code === "EA-11");
    expect(issue.observed).toBe("Organization markup carries no name.");
    expect(issue.inference).toMatch(/no identity to attach/);
    expect(issue.observed).not.toBe(issue.inference);
  });

  it("keeps the evidence sentence alongside them", async () => {
    await store.persistResult("user-1", "audit-1", RESULT);
    const issue = rowsFor("audit_issues").find((x) => x.code === "EA-11");
    expect(issue.evidence).toBe("Organization markup carries no name.");
  });

  it("falls back to the evidence sentence when observed is absent", async () => {
    // A caller on an older shape still records an observation rather than null.
    const legacy = { ...RESULT, issues: [{ ...RESULT.issues[0], observed: undefined }] };
    await store.persistResult("user-1", "audit-1", legacy);
    expect(rowsFor("audit_issues")[0].observed).toBe("Organization markup carries no name.");
  });

  it("writes no issue insert at all when there are no findings", async () => {
    await store.persistResult("user-1", "audit-1", { ...RESULT, issues: [], recommendations: [] });
    expect(calls.find((c) => c.path === "audit_issues")).toBeUndefined();
    expect(calls.find((c) => c.path === "audit_results")).toBeTruthy();
  });
});
