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

describe("workspace-scoped audit reads", () => {
  it("uses workspace_id instead of the viewer's user_id for shared history and deletion", async () => {
    await store.listAudits("viewer-1", { workspaceId: "workspace-1" });
    await store.deleteAudit("viewer-1", "audit-1", { workspaceId: "workspace-1" });
    const paths = calls.map((call) => call.path);
    expect(paths[0]).toContain("workspace_id=eq.workspace-1");
    expect(paths[0]).not.toContain("user_id=eq.viewer-1");
    expect(paths[1]).toContain("workspace_id=eq.workspace-1");
    expect(paths[1]).not.toContain("user_id=eq.viewer-1");
  });

  it("builds a shared trend from only that workspace and never calls the target-only RPC", async () => {
    globalThis.fetch = vi.fn(async (url, init) => {
      const path = String(url).replace("https://db.test/", "");
      calls.push({ path, method: init?.method });
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify([{
          id: "audit-1", created_at: "2026-09-14T00:00:00Z",
          audit_results: [{ final_score: 78, coverage: 90 }],
        }]),
      };
    });
    calls = [];
    const rows = await store.getTargetTrend("viewer-1", "target-1", 30, {
      workspaceId: "workspace-1",
    });
    expect(calls[0].path).toContain("workspace_id=eq.workspace-1");
    expect(calls[0].path).toContain("target_id=eq.target-1");
    expect(calls[0].path).not.toContain("rpc/audit_target_trend");
    expect(rows).toEqual([expect.objectContaining({ audit_id: "audit-1", final_score: 78 })]);
  });

  it("falls back to direct DB update when rpc/approve_entity fails", async () => {
    globalThis.fetch = vi.fn(async (url, init) => {
      const path = String(url).replace("https://db.test/", "");
      const body = init?.body ? JSON.parse(init.body) : null;
      calls.push({ path, method: init?.method, body });

      if (path.startsWith("audit_entities?id=eq.entity-1")) {
        // getEntity check or patch response
        return {
          ok: true, status: 200,
          text: async () => JSON.stringify([{ id: "entity-1", name: "Acme", state: "proposed", user_id: "user-1", proposed_by: "user-1" }]),
        };
      }
      if (path === "rpc/approve_entity") {
        // Simulate RPC failure / 500
        return { ok: false, status: 500, text: async () => JSON.stringify({ error: "RPC missing or forbidden" }) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify([]) };
    });
    calls = [];

    const res = await store.approveEntity("user-1", "entity-1");
    expect(res.ok).toBe(true);
    expect(res.fallback).toBe(true);

    const patchCall = calls.find((c) => c.path.startsWith("audit_entities?id=eq.entity-1") && c.method === "PATCH");
    expect(patchCall).toBeDefined();
    expect(patchCall.body.state).toBe("approved");
    expect(patchCall.body.reviewed_by).toBe("user-1");
    expect(patchCall.body.review_note).toContain("[Single-founder approval]");
  });

  it("falls back to direct DB update when rpc/approve_entity_relationship fails", async () => {
    globalThis.fetch = vi.fn(async (url, init) => {
      const path = String(url).replace("https://db.test/", "");
      const body = init?.body ? JSON.parse(init.body) : null;
      calls.push({ path, method: init?.method, body });

      if (path.startsWith("audit_entity_relationships?id=eq.rel-1")) {
        return {
          ok: true, status: 200,
          text: async () => JSON.stringify([{ id: "rel-1", subject_id: "e1", object_id: "e2", state: "proposed", user_id: "user-1", proposed_by: "user-1" }]),
        };
      }
      if (path === "rpc/approve_entity_relationship") {
        return { ok: false, status: 500, text: async () => JSON.stringify({ error: "RPC 500" }) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify([{ id: "e1", state: "approved" }]) };
    });
    calls = [];

    const res = await store.approveEntityRelationship("user-1", "rel-1");
    expect(res.ok).toBe(true);
    expect(res.fallback).toBe(true);

    const patchCall = calls.find((c) => c.path.startsWith("audit_entity_relationships?id=eq.rel-1") && c.method === "PATCH");
    expect(patchCall).toBeDefined();
    expect(patchCall.body.state).toBe("approved");
    expect(patchCall.body.reviewed_by).toBe("user-1");
    expect(patchCall.body.review_note).toContain("[Single-founder approval]");
  });
});

describe("reviewNoteFor — a solo operator's own note must not cost them the approval", () => {
  const MARKER = "[Single-founder approval]";

  // 🔴 THE BUG THIS PINS. approve_entity (0075/0077) permits a self-approval
  // only when the note carries the single-founder marker, and the old code
  // applied that marker ONLY when no note was given. So the behaviour was
  // exactly backwards: approving your own entity silently worked, and
  // approving it WITH a note was refused 403 "You proposed this entity."
  // Someone who explained their reasoning was punished for it.

  it("🔴 keeps the marker when the proposer ALSO types a note", () => {
    const out = store.reviewNoteFor("Checked against the filings.", { selfApproval: true });
    expect(out).toContain(MARKER);
    // Their own words are the audit trail — appended to, never replaced.
    expect(out).toContain("Checked against the filings.");
  });

  it("still attests when the proposer types nothing", () => {
    expect(store.reviewNoteFor(null, { selfApproval: true })).toContain(MARKER);
    expect(store.reviewNoteFor("   ", { selfApproval: true })).toContain(MARKER);
  });

  it("does not double-stamp a note that already carries the marker", () => {
    const already = `${MARKER} Reviewed by the owner.`;
    expect(store.reviewNoteFor(already, { selfApproval: true })).toBe(already);
    expect(store.reviewNoteFor(already, { selfApproval: true }).match(/\[Single-founder approval\]/g))
      .toHaveLength(1);
  });

  it("🔴 NEVER relabels a teammate's approval as single-founder", () => {
    // The marker asserts that one person reviewed their own work. Adding it to
    // a different reviewer's note would erase the fact that two people looked,
    // which is the one thing the approval gate exists to record.
    expect(store.reviewNoteFor("Confirmed independently.", { selfApproval: false }))
      .toBe("Confirmed independently.");
    expect(store.reviewNoteFor(null, { selfApproval: false })).toBeNull();
  });
});

// ── 2026-09-23 — THE PARSER READ A SHAPE PRODUCTION NEVER PRODUCES ──────────
//
// `rest()` returns the failed response BODY AS TEXT. The previous verdict
// parser read `patchRes.error.code` and `patchRes.error.message` off that
// string, so every branch missed, the route fell through to its generic
// 500 handler, and the RAW PostgREST envelope — including a `details` blob
// carrying the entire failing row — was returned to the browser.
//
// The test that covered it passed an OBJECT and was green throughout. These
// assertions use the exact text body a live staging PATCH returned.
describe("approvalVerdictFrom — the error body is TEXT, not an object", () => {
  const LIVE_BODY = JSON.stringify({
    code: "23514",
    details: "Failing row contains (7c61c11a, 52ab7ca5, null, null, brand, Axiom DatIQ, ...).",
    hint: null,
    message: 'new row for relation "audit_entities" violates check constraint "audit_entities_no_self_approval"',
  });

  it("reads the code out of a JSON STRING body (the shape rest() actually returns)", () => {
    expect(
      store.approvalVerdictFrom(LIVE_BODY, { marker: false, constraints: store.SELF_APPROVAL_CONSTRAINTS.entity }),
    ).toBe("check_violation");
  });

  // 🔴 The distinction the whole fix exists for. 0075's constraint PERMITS a
  // self-approval whose note carries the marker. So a refusal of a row that
  // carries it proves the database is enforcing 0056's constraint — a
  // deployment fact, not a decision about what the user may do.
  it("calls a refusal DESPITE the single-founder marker a stale constraint, not a policy refusal", () => {
    expect(
      store.approvalVerdictFrom(LIVE_BODY, { marker: true, constraints: store.SELF_APPROVAL_CONSTRAINTS.entity }),
    ).toBe("stale_constraint");
  });

  it("does not call an unrelated check violation stale, even with the marker present", () => {
    const other = JSON.stringify({
      code: "23514",
      message: 'violates check constraint "audit_entities_rejected_has_reason"',
    });
    expect(
      store.approvalVerdictFrom(other, { marker: true, constraints: store.SELF_APPROVAL_CONSTRAINTS.entity }),
    ).toBe("check_violation");
  });

  it("recognises a missing approve_entity function as the same unapplied migration", () => {
    const missing = JSON.stringify({
      code: "PGRST202",
      message: "Could not find the function public.approve_entity(p_entity_id, p_note, p_reviewer_id)",
    });
    expect(store.approvalVerdictFrom(missing, { marker: true, constraints: [] })).toBe("approval_fn_missing");
  });

  it("still detects RLS refusals", () => {
    const rls = JSON.stringify({ code: "42501", message: "permission denied for table audit_entities" });
    expect(store.approvalVerdictFrom(rls, {})).toBe("rls_denied");
  });

  it("returns null for anything it does not recognise — never a guess", () => {
    expect(store.approvalVerdictFrom(JSON.stringify({ code: "08006", message: "connection failure" }), {})).toBeNull();
    expect(store.approvalVerdictFrom("", {})).toBeNull();
  });

  // The `details` blob is the whole failing row. It reached the browser once;
  // it must not again.
  it("restErrorMessage keeps the message and DROPS the row-dumping details blob", () => {
    const msg = store.restErrorMessage(LIVE_BODY, "fallback");
    expect(msg).toContain("audit_entities_no_self_approval");
    expect(msg).not.toContain("Failing row contains");
    expect(msg).not.toContain("Axiom DatIQ");
  });

  it("survives a non-JSON body rather than throwing inside an error path", () => {
    expect(store.restErrorMessage("<html>502 Bad Gateway</html>", "fallback")).toBe("<html>502 Bad Gateway</html>");
    expect(store.parseRestError(undefined)).toEqual({});
  });
});
