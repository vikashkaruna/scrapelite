// netlify/functions/reports.js contract tests.
//
// 0007_public_reports.sql made the slug the only auth and exposed every column
// to anyone holding it. The properties worth pinning are the ones that stop
// that from happening again:
//   - every read goes through resolve_report_access(), never a table select
//   - a denial is a 404, so slugs cannot be enumerated
//   - nothing is cacheable, or revocation cannot be immediate
//   - a report is created PRIVATE regardless of what the caller asks for
//   - branding is re-validated against the plan, never trusted from the body

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let fetchMock;
const FREE_ENT = { plan_id: "free", status: "active", source: "signup", period_end: "2999-01-01" };
const BIZ_ENT = { plan_id: "business", status: "active", source: "payment", period_end: "2999-01-01" };

const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  process.env.SUPABASE_URL = "https://proj.supabase.co";
  process.env.SUPABASE_SERVICE_KEY = "service-key";
  vi.resetModules();
  fetchMock = vi.fn(async (u) => {
    const s = String(u);
    if (s.includes("/entitlements?")) return jsonRes([FREE_ENT]);
    return jsonRes({});
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals(); vi.restoreAllMocks();
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_KEY;
});

async function loadHandler(user = { id: "owner-1", email: "owner@x.com" }) {
  vi.doMock("../functions/lib/supabaseServerClient.js", () => ({
    authenticateBearer: vi.fn(async () =>
      user ? { ok: true, user, client: {} }
           : { ok: false, status: 401, body: { error: "Authentication required" } }),
    getUserScopedClient: vi.fn(() => ({ client: null, problem: null, message: null })),
    bearerToken: vi.fn((h) => String(h || "").replace(/^Bearer\s+/i, "") || null),
  }));
  return (await import("../functions/reports.js")).handler;
}

const AUTH = { authorization: "Bearer t" };
const post = (body, headers = AUTH) => ({ httpMethod: "POST", headers, body: JSON.stringify(body) });

describe("reports — public read goes through the resolver", () => {
  it("returns a permitted report and marks a link report non-indexable", async () => {
    fetchMock.mockImplementation(async (u) =>
      String(u).includes("rpc/resolve_report_access")
        ? jsonRes({ ok: true, report: { id: "r1", slug: "abc", title: "T", visibility: "link", indexable: false } })
        : jsonRes({}));
    const h = await loadHandler(null);
    const r = await h({ httpMethod: "GET", headers: {}, queryStringParameters: { slug: "abc" } });
    const b = JSON.parse(r.body);
    expect(r.statusCode).toBe(200);
    expect(b.indexable).toBe(false);
    expect(b.report.title).toBe("T");
  });

  it("NEVER caches a report body — a cached revoked link is a live revoked link", async () => {
    fetchMock.mockImplementation(async (u) =>
      String(u).includes("rpc/resolve_report_access")
        ? jsonRes({ ok: true, report: { slug: "abc", visibility: "public", indexable: true } })
        : jsonRes({}));
    const h = await loadHandler(null);
    const r = await h({ httpMethod: "GET", headers: {}, queryStringParameters: { slug: "abc" } });
    expect(r.headers["Cache-Control"]).toMatch(/no-store/);
  });

  it("answers 404 for a private report — distinguishing it would confirm the slug is real", async () => {
    fetchMock.mockImplementation(async (u) =>
      String(u).includes("rpc/resolve_report_access")
        ? jsonRes({ ok: false, reason: "private" }) : jsonRes({}));
    const h = await loadHandler(null);
    const r = await h({ httpMethod: "GET", headers: {}, queryStringParameters: { slug: "abc" } });
    expect(r.statusCode).toBe(404);
    expect(r.headers["Cache-Control"]).toMatch(/no-store/);
  });

  it("answers 404 identically for revoked, expired and not-found", async () => {
    for (const reason of ["revoked", "expired", "not_found", "not_granted", "not_in_workspace"]) {
      fetchMock.mockImplementation(async (u) =>
        String(u).includes("rpc/resolve_report_access") ? jsonRes({ ok: false, reason }) : jsonRes({}));
      const h = await loadHandler(null);
      const r = await h({ httpMethod: "GET", headers: {}, queryStringParameters: { slug: "abc" } });
      expect(r.statusCode, reason).toBe(404);
    }
  });

  it("reads a report WITHOUT auth — a link report must open for a logged-out recipient", async () => {
    let sawViewer = "unset";
    fetchMock.mockImplementation(async (u, i) => {
      if (String(u).includes("rpc/resolve_report_access")) {
        sawViewer = JSON.parse(i.body).p_viewer_id;
        return jsonRes({ ok: true, report: { slug: "abc", visibility: "link", indexable: false } });
      }
      return jsonRes({});
    });
    const h = await loadHandler(null);
    const r = await h({ httpMethod: "GET", headers: {}, queryStringParameters: { slug: "abc" } });
    expect(r.statusCode).toBe(200);
    expect(sawViewer).toBeNull();
  });

  it("never selects the reports table directly for a public read", async () => {
    fetchMock.mockImplementation(async (u) =>
      String(u).includes("rpc/resolve_report_access")
        ? jsonRes({ ok: true, report: { slug: "abc", visibility: "link" } }) : jsonRes({}));
    const h = await loadHandler(null);
    await h({ httpMethod: "GET", headers: {}, queryStringParameters: { slug: "abc" } });
    const directSelect = fetchMock.mock.calls.some(([u, i]) =>
      String(u).includes("/rest/v1/reports?") && (!i?.method || i.method === "GET"));
    expect(directSelect).toBe(false);
  });
});

describe("reports — creation is private by default (decision D3)", () => {
  it("creates PRIVATE even when the body asks for public", async () => {
    let inserted = null;
    fetchMock.mockImplementation(async (u, i) => {
      if (String(u).includes("/rest/v1/reports") && i?.method === "POST") {
        inserted = JSON.parse(i.body); return jsonRes([{ id: "r1" }]);
      }
      if (String(u).includes("/entitlements?")) return jsonRes([FREE_ENT]);
      return jsonRes({});
    });
    const h = await loadHandler();
    const r = await h(post({ action: "create", title: "My brief", visibility: "public" }));
    expect(r.statusCode).toBe(200);
    expect(inserted.visibility).toBe("private");
  });

  it("takes the owner from the JWT, never the body", async () => {
    let inserted = null;
    fetchMock.mockImplementation(async (u, i) => {
      if (String(u).includes("/rest/v1/reports") && i?.method === "POST") {
        inserted = JSON.parse(i.body); return jsonRes([{ id: "r1" }]);
      }
      if (String(u).includes("/entitlements?")) return jsonRes([FREE_ENT]);
      return jsonRes({});
    });
    const h = await loadHandler({ id: "real-owner", email: "o@x.com" });
    await h(post({ action: "create", title: "T", owner_id: "attacker", ownerId: "attacker" }));
    expect(inserted.owner_id).toBe("real-owner");
  });

  it("requires a title", async () => {
    const h = await loadHandler();
    expect((await h(post({ action: "create" }))).statusCode).toBe(400);
  });

  it("requires auth", async () => {
    const h = await loadHandler(null);
    expect((await h({ httpMethod: "POST", headers: {}, body: JSON.stringify({ action: "create", title: "T" }) })).statusCode).toBe(401);
  });
});

describe("reports — branding is re-validated against the plan", () => {
  async function createWith(ent, branding) {
    let inserted = null;
    fetchMock.mockImplementation(async (u, i) => {
      if (String(u).includes("/entitlements?")) return jsonRes([ent]);
      if (String(u).includes("/rest/v1/reports") && i?.method === "POST") {
        inserted = JSON.parse(i.body); return jsonRes([{ id: "r1" }]);
      }
      return jsonRes({});
    });
    const h = await loadHandler();
    await h(post({ action: "create", title: "T", branding }));
    return inserted;
  }

  it("DROPS a brand kit on a plan that has not paid for it", async () => {
    // The Brand Kit lives in localStorage, so the client must send it — which
    // means a hand-built request could otherwise brand a free-tier report.
    const row = await createWith(FREE_ENT, { companyName: "Sneaky Ltd", hideAttribution: true });
    expect(row.branding).toEqual({});
  });

  it("keeps it on a plan that has", async () => {
    const row = await createWith(BIZ_ENT, { companyName: "Acme" });
    expect(row.branding).toEqual({ companyName: "Acme" });
  });

  it("dropping branding does NOT fail the whole publish", async () => {
    fetchMock.mockImplementation(async (u, i) => {
      if (String(u).includes("/entitlements?")) return jsonRes([FREE_ENT]);
      if (String(u).includes("/rest/v1/reports") && i?.method === "POST") return jsonRes([{ id: "r1" }]);
      return jsonRes({});
    });
    const h = await loadHandler();
    const r = await h(post({ action: "create", title: "T", branding: { companyName: "X" } }));
    expect(r.statusCode).toBe(200);
  });
});

describe("reports — publish / unpublish / revoke", () => {
  function rpcMock(result) {
    fetchMock.mockImplementation(async (u) => {
      const s = String(u);
      if (s.includes("/entitlements?")) return jsonRes([FREE_ENT]);
      if (s.includes("rpc/set_report_visibility") || s.includes("rpc/revoke_report")) return jsonRes(result);
      return jsonRes({});
    });
  }

  it("publishes to link and returns the slug", async () => {
    rpcMock({ ok: true, visibility: "link", slug: "abc12345" });
    const h = await loadHandler();
    const r = await h(post({ action: "publish", reportId: "r1", visibility: "link" }));
    const b = JSON.parse(r.body);
    expect(b.slug).toBe("abc12345");
    expect(b.indexable).toBe(false);
  });

  it("marks a public publish as indexable — the only state that is", async () => {
    rpcMock({ ok: true, visibility: "public", slug: "abc12345" });
    const h = await loadHandler();
    const r = await h(post({ action: "publish", reportId: "r1", visibility: "public" }));
    expect(JSON.parse(r.body).indexable).toBe(true);
  });

  it("refuses a visibility that is not shareable", async () => {
    const h = await loadHandler();
    for (const v of ["revoked", "private", "telepathy"]) {
      const r = await h(post({ action: "publish", reportId: "r1", visibility: v }));
      expect(r.statusCode, v).toBe(400);
    }
  });

  it("surfaces the database's own refusal reason instead of a generic 500", async () => {
    rpcMock({ ok: false, reason: "revoked" });
    const h = await loadHandler();
    const r = await h(post({ action: "publish", reportId: "r1", visibility: "link" }));
    const b = JSON.parse(r.body);
    expect(r.statusCode).toBe(400);
    expect(b.reason).toBe("revoked");
    expect(b.error).toMatch(/cannot be restored/i);
  });

  it("unpublish asks for private, not for a new slug", async () => {
    let sent = null;
    fetchMock.mockImplementation(async (u, i) => {
      if (String(u).includes("rpc/set_report_visibility")) {
        sent = JSON.parse(i.body); return jsonRes({ ok: true, visibility: "private", slug: "abc12345" });
      }
      if (String(u).includes("/entitlements?")) return jsonRes([FREE_ENT]);
      return jsonRes({});
    });
    const h = await loadHandler();
    const r = await h(post({ action: "unpublish", reportId: "r1" }));
    expect(sent.p_visibility).toBe("private");
    // D3: the slug survives an unpublish so re-publishing revives the link.
    expect(JSON.parse(r.body).slug).toBe("abc12345");
  });

  it("revoke calls the terminal path", async () => {
    let called = false;
    fetchMock.mockImplementation(async (u) => {
      if (String(u).includes("rpc/revoke_report")) { called = true; return jsonRes({ ok: true }); }
      if (String(u).includes("/entitlements?")) return jsonRes([FREE_ENT]);
      return jsonRes({});
    });
    const h = await loadHandler();
    const r = await h(post({ action: "revoke", reportId: "r1", reason: "leaked" }));
    expect(called).toBe(true);
    expect(JSON.parse(r.body).visibility).toBe("revoked");
  });

  it("requires a reportId", async () => {
    const h = await loadHandler();
    expect((await h(post({ action: "revoke" }))).statusCode).toBe(400);
    expect((await h(post({ action: "unpublish" }))).statusCode).toBe(400);
  });

  it("rejects an unknown action", async () => {
    const h = await loadHandler();
    expect((await h(post({ action: "nuke" }))).statusCode).toBe(400);
  });
});

describe("reports — named grants", () => {
  it("refuses to grant on a report the caller does not own", async () => {
    fetchMock.mockImplementation(async (u) => {
      if (String(u).includes("/rest/v1/reports?")) return jsonRes([]); // not mine
      if (String(u).includes("/entitlements?")) return jsonRes([FREE_ENT]);
      return jsonRes({});
    });
    const h = await loadHandler();
    const r = await h(post({ action: "grant", reportId: "r1", email: "x@y.com" }));
    expect(r.statusCode).toBe(404);
  });

  it("lowercases the granted address so matching is case-insensitive", async () => {
    let upserted = null;
    fetchMock.mockImplementation(async (u, i) => {
      if (String(u).includes("/rest/v1/reports?")) return jsonRes([{ id: "r1" }]);
      if (String(u).includes("/rest/v1/report_grants")) { upserted = JSON.parse(i.body); return jsonRes([{}]); }
      if (String(u).includes("/entitlements?")) return jsonRes([FREE_ENT]);
      return jsonRes({});
    });
    const h = await loadHandler();
    await h(post({ action: "grant", reportId: "r1", email: "Mate@X.com" }));
    expect(upserted.email).toBe("mate@x.com");
  });
});
