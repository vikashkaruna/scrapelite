// @vitest-environment node
// netlify/__tests__/account-brand-kit.test.js — the account Brand Kit's server copy (0083),
// against real Postgres, with the plan gate mocked per test.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { createEngagementDb } from "./helpers/engagementDb.js";

const mocks = vi.hoisted(() => ({ authenticateBearer: vi.fn(), requireCapabilityForUser: vi.fn() }));
vi.mock("../functions/lib/supabaseServerClient.js", () => ({ authenticateBearer: mocks.authenticateBearer }));
vi.mock("../functions/lib/requireEntitlement.js", () => ({ requireCapabilityForUser: mocks.requireCapabilityForUser }));

let db; let handler; let store; let A; let B;
beforeAll(async () => {
  db = await createEngagementDb();
  store = await import("../functions/lib/engagement/engagementStore.js");
  store.__setServiceDbForTests(() => db.sb);
  ({ handler } = await import("../functions/account-brand-kit.js"));
}, 60_000);
afterAll(() => store.__setServiceDbForTests(null));
beforeEach(async () => {
  A = await db.createUser(); B = await db.createUser();
  mocks.authenticateBearer.mockReset().mockImplementation(async (event) => {
    const tok = (event.headers?.Authorization || "").replace("Bearer ", "");
    return tok ? { ok: true, user: { id: tok } } : { ok: false, status: 401, body: { error: "unauthenticated" } };
  });
  mocks.requireCapabilityForUser.mockReset().mockResolvedValue({ check: { allowed: true } });
});

const call = async (user, method, body) => {
  const r = await handler({ httpMethod: method, headers: user ? { Authorization: `Bearer ${user}` } : {}, body: body ? JSON.stringify(body) : null });
  return { status: r.statusCode, body: JSON.parse(r.body || "{}") };
};

describe("account-brand-kit", () => {
  it("needs a session", async () => {
    expect((await call(null, "GET")).status).toBe(401);
  });

  it("saves only the validated text fields — never the logo", async () => {
    const r = await call(A, "PUT", { kit: { companyName: " Acme ", website: "https://acme.test", contactEmail: "hi@acme.test", logo: { dataUrl: "data:image/png;base64,AAAA" }, extra: "x" } });
    expect(r.status).toBe(200);
    expect(r.body.kit).toEqual({ companyName: "Acme", website: "https://acme.test", contactEmail: "hi@acme.test" });
    const g = await call(A, "GET");
    expect(g.body).toMatchObject({ ok: true, allowed: true, kit: { companyName: "Acme" } });
    expect(g.body.kit.logo).toBeUndefined();
  });

  it("refuses a write on a plan without the brand kit, and says which plans have it", async () => {
    mocks.requireCapabilityForUser.mockResolvedValue({ check: { allowed: false } });
    const r = await call(A, "PUT", { kit: { companyName: "Acme" } });
    expect(r.status).toBe(402);
    expect(r.body.error).toMatch(/Business and Agency/);
    expect((await call(A, "GET")).body).toMatchObject({ allowed: false, kit: null });
  });

  it("fails closed when the plan cannot be read", async () => {
    mocks.requireCapabilityForUser.mockRejectedValue(new Error("down"));
    expect((await call(A, "PUT", { kit: { companyName: "Acme" } })).status).toBe(402);
  });

  it("rejects an invalid field with the reason", async () => {
    const r = await call(A, "PUT", { kit: { website: "acme.test" } });
    expect([r.status, r.body.error]).toEqual([400, "Website must be a full https:// URL."]);
  });

  it("keeps each account's kit to itself, and deletes it", async () => {
    await call(A, "PUT", { kit: { companyName: "Acme" } });
    expect((await call(B, "GET")).body.kit).toBeNull();
    expect((await call(A, "DELETE")).status).toBe(200);
    expect((await call(A, "GET")).body.kit).toBeNull();
  });
});
