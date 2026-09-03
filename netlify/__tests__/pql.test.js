import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAuth = vi.fn();
const mockDb = vi.fn();
vi.mock("../functions/lib/supabaseServerClient.js", () => ({
  authenticateBearer: (...a) => mockAuth(...a),
}));
vi.mock("../functions/lib/templateStore.js", () => ({ serviceDb: () => mockDb() }));

const { handler } = await import("../functions/pql.js");

const USER = { id: "11111111-1111-1111-1111-111111111111" };
const post = (path, body) =>
  handler({ httpMethod: "POST", path, headers: {}, body: JSON.stringify(body) });

function fakeDb({ rows = [], insertErr = null, rpcVerdict = "ok", rpcErr = null } = {}) {
  const inserted = [];
  return {
    inserted,
    rpcArgs: [],
    from() {
      const q = {
        select: () => q, eq: () => q, order: () => q,
        limit: async () => ({ data: rows, error: null }),
        insert: async (r) => { inserted.push(...r); return { error: insertErr }; },
      };
      return q;
    },
    rpc(name, args) { this.rpcArgs.push([name, args]); return Promise.resolve({ data: rpcVerdict, error: rpcErr }); },
  };
}

beforeEach(() => { vi.clearAllMocks(); });

describe("POST /api/pql/events", () => {
  // Guests are ACCEPTED AND DROPPED, never 401'd. A PQL score is a claim about
  // an account; an anonymous session is nobody to attribute one to. And an
  // analytics concern must never surface as an error inside a user flow.
  it("does not 401 a guest — it accepts and drops", async () => {
    mockAuth.mockResolvedValue({ ok: false, status: 401 });
    const res = await post("/api/pql/events", { events: [{ name: "pricing_viewed" }] });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ ok: true, recorded: 0, skipped: "not_signed_in" });
  });

  it("fails OPEN when Supabase is unconfigured", async () => {
    mockAuth.mockResolvedValue({ ok: true, user: USER });
    mockDb.mockReturnValue(null);
    const res = await post("/api/pql/events", { events: [{ name: "pricing_viewed" }] });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).skipped).toBe("not_configured");
  });

  it("records declared events against the authenticated user", async () => {
    const db = fakeDb();
    mockAuth.mockResolvedValue({ ok: true, user: USER });
    mockDb.mockReturnValue(db);
    const res = await post("/api/pql/events", { events: [
      { name: "template_run_completed", properties: { templateKey: "account_brief" } },
      { name: "pricing_viewed" },
    ] });
    expect(JSON.parse(res.body).recorded).toBe(2);
    expect(db.inserted.every((r) => r.user_id === USER.id)).toBe(true);
  });

  // The user_id comes from the JWT, never from the body — otherwise anyone
  // could write activation events against somebody else's account and
  // manufacture a PQL.
  it("ignores a client-supplied user_id", async () => {
    const db = fakeDb();
    mockAuth.mockResolvedValue({ ok: true, user: USER });
    mockDb.mockReturnValue(db);
    await post("/api/pql/events", { events: [{ name: "pricing_viewed", user_id: "someone-else" }] });
    expect(db.inserted[0].user_id).toBe(USER.id);
  });

  // An undeclared name can never be read by scoring, so storing it is noise in
  // a table that cascades with an account.
  it("drops event names the vocabulary does not declare", async () => {
    const db = fakeDb();
    mockAuth.mockResolvedValue({ ok: true, user: USER });
    mockDb.mockReturnValue(db);
    const res = await post("/api/pql/events", { events: [
      { name: "not_a_real_event" }, { name: "drop_table" }, { name: "pricing_viewed" },
    ] });
    expect(JSON.parse(res.body).recorded).toBe(1);
    expect(db.inserted[0].name).toBe("pricing_viewed");
  });

  it("caps the batch and refuses an oversized property blob", async () => {
    const db = fakeDb();
    mockAuth.mockResolvedValue({ ok: true, user: USER });
    mockDb.mockReturnValue(db);
    const many = Array.from({ length: 200 }, () => ({ name: "pricing_viewed" }));
    expect(JSON.parse((await post("/api/pql/events", { events: many })).body).recorded).toBe(50);

    db.inserted.length = 0;
    await post("/api/pql/events", { events: [
      { name: "pricing_viewed", properties: { blob: "x".repeat(5000) } },
    ] });
    // Refused, not truncated — a truncated blob parses but means something else.
    expect(db.inserted[0].properties).toEqual({});
  });

  it("degrades rather than erroring when the insert fails", async () => {
    mockAuth.mockResolvedValue({ ok: true, user: USER });
    mockDb.mockReturnValue(fakeDb({ insertErr: { message: "boom" } }));
    const res = await post("/api/pql/events", { events: [{ name: "pricing_viewed" }] });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).degraded).toBe(true);
  });
});

describe("POST /api/pql/score", () => {
  it("computes from stored events and persists via record_pql_score", async () => {
    const db = fakeDb({ rows: [
      { name: "template_run_completed", properties: { templateKey: "account_brief" }, occurred_at: "2026-09-01T10:00:00Z" },
      { name: "integration_push", properties: { provider: "hubspot" }, occurred_at: "2026-09-01T11:00:00Z" },
      { name: "extraction_saved", properties: {}, occurred_at: "2026-09-01T12:00:00Z" },
    ] });
    mockAuth.mockResolvedValue({ ok: true, user: USER });
    mockDb.mockReturnValue(db);
    const res = await post("/api/pql/score", { persona: "sales" });
    expect(res.statusCode).toBe(200);
    const [name, args] = db.rpcArgs[0];
    expect(name).toBe("record_pql_score");
    expect(args.p_user_id).toBe(USER.id);
    expect(args.p_activated).toBe(true);   // the sales definition is satisfied
    expect(Array.isArray(args.p_excluded_signals)).toBe(true);
  });

  // A PQL score is a commercial judgement ABOUT the user. If they can call the
  // endpoint, they must not be able to read how they are ranked as a target.
  it("never returns the score to the caller", async () => {
    mockAuth.mockResolvedValue({ ok: true, user: USER });
    mockDb.mockReturnValue(fakeDb({ rows: [] }));
    const body = JSON.parse((await post("/api/pql/score", { persona: "sales" })).body);
    expect(body).not.toHaveProperty("score");
    expect(body).not.toHaveProperty("points");
    expect(body).not.toHaveProperty("isPql");
    expect(JSON.stringify(body)).not.toMatch(/pql.?:.?true/i);
  });

  it("ignores an unknown persona rather than failing", async () => {
    const db = fakeDb({ rows: [] });
    mockAuth.mockResolvedValue({ ok: true, user: USER });
    mockDb.mockReturnValue(db);
    await post("/api/pql/score", { persona: "not-a-persona" });
    expect(db.rpcArgs[0][1].p_persona).toBeNull();
  });

  it("reports degraded rather than throwing when the RPC errors", async () => {
    mockAuth.mockResolvedValue({ ok: true, user: USER });
    mockDb.mockReturnValue(fakeDb({ rows: [], rpcErr: { message: "nope" } }));
    const res = await post("/api/pql/score", {});
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).degraded).toBe(true);
  });
});

describe("routing", () => {
  it("404s an unknown action", async () => {
    mockAuth.mockResolvedValue({ ok: true, user: USER });
    mockDb.mockReturnValue(fakeDb());
    expect((await post("/api/pql/wat", {})).statusCode).toBe(404);
  });
  it("405s a GET", async () => {
    expect((await handler({ httpMethod: "GET", path: "/api/pql/events", headers: {} })).statusCode).toBe(405);
  });
});
