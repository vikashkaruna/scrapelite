// @vitest-environment node
// netlify/__tests__/engagement-webhook.test.js — Resend events against a real
// Postgres, signed exactly as Svix signs them.
//
// Guards review F-5 (auth fails open / rejects real providers) and F-6 (events
// matched to prospects across tenants by address).

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { createHmac } from "node:crypto";
import { createEngagementDb, ENGAGEMENT_TEST_ENV } from "./helpers/engagementDb.js";

let db;
let store;
let handler;
const savedEnv = {};

beforeAll(async () => {
  db = await createEngagementDb();
  for (const [k, v] of Object.entries(ENGAGEMENT_TEST_ENV)) { savedEnv[k] = process.env[k]; process.env[k] = v; }
  store = await import("../functions/lib/engagement/engagementStore.js");
  store.__setServiceDbForTests(() => db.sb);
  ({ handler } = await import("../functions/engagement-webhook.js"));
}, 60_000);

afterAll(() => {
  store.__setServiceDbForTests(null);
  for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

beforeEach(() => {
  process.env.ENGAGEMENT_RESEND_WEBHOOK_SECRET = ENGAGEMENT_TEST_ENV.ENGAGEMENT_RESEND_WEBHOOK_SECRET;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

function sign(body, { secret = ENGAGEMENT_TEST_ENV.ENGAGEMENT_RESEND_WEBHOOK_SECRET, ts = Math.floor(Date.now() / 1000), id = `msg_${Math.random()}` } = {}) {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const sig = createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
  return { "svix-id": id, "svix-timestamp": String(ts), "svix-signature": `v1,${sig}` };
}

function event(type, emailId, data = {}, opts = {}) {
  const body = JSON.stringify({ type, created_at: new Date().toISOString(), data: { email_id: emailId, ...data } });
  return handler({
    httpMethod: "POST",
    queryStringParameters: { provider: "resend" },
    headers: { "content-type": "application/json", ...(opts.headers || sign(body, opts)) },
    body: opts.tamper ? body.replace("email", "EMAIL") : body,
  });
}

/** A tenant with one sent message whose provider id is `emailId`. */
async function sentMessage({ email = "ana@buyer.test", phone = null, emailId = `re_${Math.random().toString(36).slice(2)}` } = {}) {
  const user = await db.createUser();
  const c = await db.one("insert into public.engagement_campaigns (user_id, name) values ($1, 'C') returning id", [user]);
  const p = await db.one(
    "insert into public.engagement_prospects (user_id, campaign_id, email, phone, status) values ($1, $2, $3, $4, 'sent') returning id",
    [user, c.id, email, phone],
  );
  const m = await db.one(
    `insert into public.engagement_messages (user_id, campaign_id, prospect_id, channel, body, status, approval_status, provider, external_message_id, sent_at)
     values ($1, $2, $3, 'email', 'hi', 'sent', 'approved', 'resend', $4, now()) returning id`,
    [user, c.id, p.id, emailId],
  );
  return { user, campaignId: c.id, prospectId: p.id, messageId: m.id, emailId };
}
const prospect = (id) => db.one("select * from public.engagement_prospects where id = $1", [id]);
const message = (id) => db.one("select * from public.engagement_messages where id = $1", [id]);
const suppressions = (user) => db.all("select channel, address, reason from public.engagement_suppressions where user_id = $1", [user]);

describe("F-5 — authentication", () => {
  it("a provider we do not send on is a 404", async () => {
    const r = await handler({ httpMethod: "POST", queryStringParameters: { provider: "twilio" }, headers: {}, body: "{}" });
    expect(r.statusCode).toBe(404);
  });

  it("refuses everything with 503 when the signing secret is unset — never fails open", async () => {
    delete process.env.ENGAGEMENT_RESEND_WEBHOOK_SECRET;
    const s = await sentMessage();
    const r = await event("email.complained", s.emailId);
    expect(r.statusCode).toBe(503);
    expect(await suppressions(s.user)).toHaveLength(0);
  });

  it("refuses an unsigned request", async () => {
    const s = await sentMessage();
    const r = await event("email.complained", s.emailId, {}, { headers: {} });
    expect(r.statusCode).toBe(401);
    expect(await suppressions(s.user)).toHaveLength(0);
  });

  it("refuses a tampered body", async () => {
    const s = await sentMessage();
    expect((await event("email.delivered", s.emailId, {}, { tamper: true })).statusCode).toBe(401);
  });

  it("refuses a replay outside the tolerance window", async () => {
    const s = await sentMessage();
    const r = await event("email.delivered", s.emailId, {}, { ts: Math.floor(Date.now() / 1000) - 3600 });
    expect(r.statusCode).toBe(401);
  });

  it("refuses the old static x-engagement-secret header", async () => {
    const s = await sentMessage();
    const r = await event("email.delivered", s.emailId, {}, { headers: { "x-engagement-secret": "anything" } });
    expect(r.statusCode).toBe(401);
  });
});

describe("F-6 — events correlate by provider message id, within one tenant", () => {
  it("a delivery advances the right message and prospect", async () => {
    const s = await sentMessage();
    const r = await event("email.delivered", s.emailId);
    expect(r.statusCode).toBe(200);
    expect((await message(s.messageId)).status).toBe("delivered");
    expect((await prospect(s.prospectId)).status).toBe("delivered");
  });

  it("an id we never sent is acknowledged and changes nothing", async () => {
    const s = await sentMessage();
    const r = await event("email.complained", "re_not_ours");
    expect(JSON.parse(r.body).status).toBe("unknown_message");
    expect(await suppressions(s.user)).toHaveLength(0);
  });

  it("two tenants with the same contact: a complaint on A's message never touches B", async () => {
    const a = await sentMessage({ email: "shared@buyer.test" });
    const b = await sentMessage({ email: "shared@buyer.test" });
    await event("email.complained", a.emailId);
    expect(await suppressions(a.user)).toEqual([{ channel: "email", address: "shared@buyer.test", reason: "complaint" }]);
    expect(await suppressions(b.user)).toHaveLength(0);
    expect((await prospect(a.prospectId)).status).toBe("opted_out");
    expect((await prospect(b.prospectId)).status).toBe("sent");
  });
});

describe("bounces, complaints, opens", () => {
  it("a permanent bounce suppresses the address; a transient one does not", async () => {
    const hard = await sentMessage();
    await event("email.bounced", hard.emailId, { bounce: { type: "Permanent" } });
    expect((await suppressions(hard.user))[0].reason).toBe("bounce");
    expect((await message(hard.messageId)).failure_code).toBe("bounced");

    const soft = await sentMessage();
    await event("email.bounced", soft.emailId, { bounce: { type: "Transient" } });
    expect(await suppressions(soft.user)).toHaveLength(0);
  });

  it("a bounce on email leaves a phone-reachable prospect in the funnel (per channel)", async () => {
    const s = await sentMessage({ phone: "+15550009999" });
    await event("email.bounced", s.emailId, { bounce: { type: "Permanent" } });
    expect((await prospect(s.prospectId)).status).not.toBe("opted_out");
  });

  it("repeated opens score once (F-24)", async () => {
    const s = await sentMessage();
    await event("email.opened", s.emailId);
    const first = (await prospect(s.prospectId)).engagement_score;
    await event("email.opened", s.emailId);
    await event("email.opened", s.emailId);
    expect((await prospect(s.prospectId)).engagement_score).toBe(first);
  });

  it("a late delivered event never moves a message backwards", async () => {
    const s = await sentMessage();
    await event("email.clicked", s.emailId);
    await event("email.delivered", s.emailId);
    expect((await message(s.messageId)).status).toBe("clicked");
  });
});
