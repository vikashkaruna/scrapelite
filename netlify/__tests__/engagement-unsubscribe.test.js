// @vitest-environment node
// netlify/__tests__/engagement-unsubscribe.test.js — the recipient's side of
// consent, against a real Postgres.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createEngagementDb, ENGAGEMENT_TEST_ENV } from "./helpers/engagementDb.js";

let db;
let store;
let handler;
let signUnsubscribeToken;
const savedEnv = {};

beforeAll(async () => {
  db = await createEngagementDb();
  for (const [k, v] of Object.entries(ENGAGEMENT_TEST_ENV)) { savedEnv[k] = process.env[k]; process.env[k] = v; }
  store = await import("../functions/lib/engagement/engagementStore.js");
  store.__setServiceDbForTests(() => db.sb);
  ({ handler } = await import("../functions/engagement-unsubscribe.js"));
  ({ signUnsubscribeToken } = await import("../functions/lib/engagement/engagementGuards.js"));
  vi.spyOn(console, "error").mockImplementation(() => {});
}, 60_000);

afterAll(() => {
  store.__setServiceDbForTests(null);
  for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

async function prospectFor({ email = "ana@buyer.test", phone = null, senderName = "Acme <b>Sales</b>" } = {}) {
  const user = await db.createUser();
  const c = await db.one(
    "insert into public.engagement_campaigns (user_id, name, sender) values ($1, 'C', $2) returning id",
    [user, JSON.stringify({ from_name: senderName, from_email: "x@outreach.example.com" })],
  );
  const p = await db.one(
    "insert into public.engagement_prospects (user_id, campaign_id, email, phone) values ($1, $2, $3, $4) returning *",
    [user, c.id, email, phone],
  );
  const token = signUnsubscribeToken({ userId: user, prospectId: p.id, channel: "email", address: email });
  return { user, prospect: p, token };
}
const rows = (user) => db.all("select channel, reason, source from public.engagement_suppressions where user_id = $1 order by channel", [user]);
const call = (method, token, body = "") => handler({
  httpMethod: method,
  queryStringParameters: token ? { t: token } : {},
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body,
});

describe("engagement-unsubscribe", () => {
  it("a tampered or missing token is refused", async () => {
    const { token } = await prospectFor();
    expect((await call("GET", null)).statusCode).toBe(400);
    expect((await call("GET", token.slice(0, -2) + "xx")).statusCode).toBe(400);
  });

  it("GET only shows a confirmation — link scanners must not unsubscribe anyone", async () => {
    const { user, token } = await prospectFor();
    const r = await call("GET", token);
    expect(r.statusCode).toBe(200);
    expect(r.headers["X-Robots-Tag"]).toMatch(/noindex/);
    expect(r.body).toContain('method="post"');
    expect(await rows(user)).toHaveLength(0);
  });

  it("never shows the full email, never shows the phone, and escapes the sender name", async () => {
    const { token } = await prospectFor({ phone: "+15550001234" });
    const r = await call("GET", token);
    expect(r.body).not.toContain("ana@buyer.test");
    expect(r.body).toContain("@buyer.test");
    expect(r.body).not.toContain("5550001234");
    expect(r.body).toContain("Also stop WhatsApp and SMS");
    expect(r.body).not.toContain("<b>Sales</b>");
    expect(r.body).toContain("&lt;b&gt;Sales&lt;/b&gt;");
  });

  it("RFC 8058 one-click unsubscribes the email channel only", async () => {
    const { user, prospect, token } = await prospectFor({ phone: "+15550001234" });
    const r = await call("POST", token, "List-Unsubscribe=One-Click");
    expect(r.statusCode).toBe(200);
    expect(await rows(user)).toEqual([{ channel: "email", reason: "unsubscribe", source: "one_click_header" }]);
    const p = await db.one("select status from public.engagement_prospects where id = $1", [prospect.id]);
    expect(p.status).not.toBe("opted_out");
  });

  it("the page can stop every channel at once", async () => {
    const { user, prospect, token } = await prospectFor({ phone: "+15550001234" });
    const r = await call("POST", token, "also_phone=1");
    expect(r.statusCode).toBe(200);
    expect((await rows(user)).map((x) => x.channel)).toEqual(["email", "sms", "whatsapp"]);
    const p = await db.one("select status from public.engagement_prospects where id = $1", [prospect.id]);
    expect(p.status).toBe("opted_out");
  });

  it("still works after the prospect was deleted", async () => {
    const { user, prospect, token } = await prospectFor();
    await db.pg.query("delete from public.engagement_prospects where id = $1", [prospect.id]);
    expect((await call("POST", token, "")).statusCode).toBe(200);
    expect(await rows(user)).toHaveLength(1);
  });

  it("the opt-out lands only on the tenant named in the token", async () => {
    const a = await prospectFor({ email: "shared@x.test" });
    const b = await prospectFor({ email: "shared@x.test" });
    await call("POST", a.token, "");
    expect(await rows(a.user)).toHaveLength(1);
    expect(await rows(b.user)).toHaveLength(0);
  });
});
