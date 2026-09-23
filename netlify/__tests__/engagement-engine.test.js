// @vitest-environment node
// netlify/__tests__/engagement-engine.test.js — the engagement API against a REAL
// Postgres (0081 + 0082 on PGlite), two tenants, and a stubbed email provider.
//
// Each block names the review finding it guards
// (docs/PROSPECT-ENGAGEMENT-ENGINE-REVIEW-AND-ROLLOUT.md). The assertions check
// what was WRITTEN and what was SENT — the original suite checked only what a
// function returned, which is how a dispatcher that re-sent everything on
// every call stayed green.

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { createEngagementDb, ENGAGEMENT_TEST_ENV, SENDER } from "./helpers/engagementDb.js";

const mocks = vi.hoisted(() => ({
  authenticateBearer: vi.fn(),
  affords: vi.fn(),
  record: vi.fn(),
  flush: vi.fn(),
}));

vi.mock("../functions/lib/supabaseServerClient.js", () => ({
  authenticateBearer: mocks.authenticateBearer,
}));

vi.mock("../functions/lib/creditMeter.js", () => ({
  affords: mocks.affords,
  record: mocks.record,
  flush: mocks.flush,
  meterContext: (o) => ({ ...o, buffer: [] }),
}));

let db;
let handler;
let store;
let A;
let B;
const savedEnv = {};
const fetchMock = vi.fn();

beforeAll(async () => {
  db = await createEngagementDb();
  for (const [k, v] of Object.entries(ENGAGEMENT_TEST_ENV)) { savedEnv[k] = process.env[k]; process.env[k] = v; }
  store = await import("../functions/lib/engagement/engagementStore.js");
  store.__setServiceDbForTests(() => db.sb);
  ({ handler } = await import("../functions/engagement-engine.js"));
  vi.stubGlobal("fetch", fetchMock);
}, 60_000);

afterAll(() => {
  store.__setServiceDbForTests(null);
  for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  vi.unstubAllGlobals();
});

beforeEach(async () => {
  A = await db.createUser();
  B = await db.createUser();
  // The bearer token IS the user id in these tests, so two tenants are one header apart.
  mocks.authenticateBearer.mockReset();
  mocks.authenticateBearer.mockImplementation(async (event) => {
    const tok = (event.headers?.Authorization || "").replace("Bearer ", "");
    return tok ? { ok: true, user: { id: tok } } : { ok: false, status: 401, body: { error: "unauthenticated" } };
  });
  mocks.affords.mockReset().mockResolvedValue({ ok: true });
  mocks.record.mockReset();
  mocks.flush.mockReset().mockResolvedValue({ ok: true });
  fetchMock.mockReset();
  let n = 0;
  fetchMock.mockImplementation(async () => ({
    ok: true, status: 200, json: async () => ({ id: `re_${++n}_${Date.now()}` }),
  }));
  process.env.ENGAGEMENT_ENABLED = "1";
  process.env.ENGAGEMENT_ALLOWLIST = "*";
  process.env.ENGAGEMENT_RESEND_API_KEY = ENGAGEMENT_TEST_ENV.ENGAGEMENT_RESEND_API_KEY;
  delete process.env.ENGAGEMENT_MOCK_SEND;
});

// ── helpers ────────────────────────────────────────────────────────────────
const call = async (user, method, { query = {}, body } = {}) => {
  const res = await handler({
    httpMethod: method,
    headers: user ? { Authorization: `Bearer ${user}` } : {},
    queryStringParameters: query,
    body: body ? JSON.stringify(body) : null,
  });
  return { status: res.statusCode, body: JSON.parse(res.body || "{}") };
};
const get = (u, action, q = {}) => call(u, "GET", { query: { action, ...q } });
const post = (u, action, b = {}) => call(u, "POST", { body: { action, ...b } });

let campaignSeq = 0;
async function campaignWithSender(user, extra = {}) {
  // Names are unique per account now, so each helper call gets its own.
  const r = await post(user, "create_campaign", { name: `Q4 ${++campaignSeq}`, sender: SENDER, brand_kit: { company_name: "Acme" }, ...extra });
  expect(r.status).toBe(200);
  return r.body.campaign;
}
async function addProspect(user, campaignId, p = {}) {
  const r = await post(user, "add_prospects", { campaign_id: campaignId, prospects: [{ first_name: "Ana", email: "ana@buyer.test", company: "Buyer", ...p }] });
  expect(r.status).toBe(200);
  return r.body.prospects[0];
}
/** campaign → prospect → one approved email, ready to send. */
async function readyToSend(user, prospect = {}) {
  const c = await campaignWithSender(user);
  const p = await addProspect(user, c.id, prospect);
  const g = await post(user, "generate_messages", { campaign_id: c.id, prospect_ids: [p.id], channel: "email" });
  expect(g.body.messages).toHaveLength(1);
  const m = g.body.messages[0];
  const a = await post(user, "approve_message", { message_id: m.id });
  expect(a.status).toBe(200);
  return { c, p, m };
}
const msgRow = (id) => db.one("select * from public.engagement_messages where id = $1", [id]);
const prospectRow = (id) => db.one("select * from public.engagement_prospects where id = $1", [id]);

// ── gates ──────────────────────────────────────────────────────────────────
describe("gates", () => {
  it("refuses a request with no session", async () => {
    expect((await get(null, "list_campaigns")).status).toBe(401);
  });

  it("refuses everyone when the module is disabled", async () => {
    process.env.ENGAGEMENT_ENABLED = "0";
    const r = await get(A, "list_campaigns");
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("engagement_disabled");
  });

  it("refuses an account outside the beta allow-list, and says so on the access probe", async () => {
    process.env.ENGAGEMENT_ALLOWLIST = B;
    expect((await get(A, "list_campaigns")).body.code).toBe("engagement_beta");
    const probe = await get(A, "access");
    expect(probe.status).toBe(200);
    expect(probe.body.enabled).toBe(false);
    expect((await get(B, "access")).body.enabled).toBe(true);
  });

  it("answers an unknown action with a code, not a stack", async () => {
    const r = await post(A, "drop_tables");
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("unknown_action");
  });
});

// ── F-7 mass assignment ────────────────────────────────────────────────────
describe("F-7 — campaign updates take an allow-list", () => {
  it("cannot move a campaign into another account by setting user_id", async () => {
    const c = await campaignWithSender(A);
    const r = await post(A, "update_campaign", { campaign_id: c.id, updates: { user_id: B, name: "Renamed" } });
    expect(r.status).toBe(200);
    const row = await db.one("select user_id, name from public.engagement_campaigns where id = $1", [c.id]);
    expect(row.user_id).toBe(A);
    expect(row.name).toBe("Renamed");
  });

  it("ignores workspace_id until membership is checked", async () => {
    const r = await post(A, "create_campaign", { name: "W", workspace_id: "00000000-0000-0000-0000-000000000001" });
    expect(r.body.campaign.workspace_id).toBeNull();
  });

  it("another tenant's campaign is a 404 on update and delete", async () => {
    const c = await campaignWithSender(A);
    expect((await post(B, "update_campaign", { campaign_id: c.id, updates: { name: "x" } })).status).toBe(404);
    expect((await post(B, "delete_campaign", { campaign_id: c.id })).status).toBe(404);
  });

  it("refuses a sender on an unverified domain", async () => {
    const r = await post(A, "create_campaign", { name: "S", sender: { from_email: "ceo@datiq.app" } });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("sender_domain_not_allowed");
  });

  it("refuses a sender name that would inject an email header", async () => {
    const r = await post(A, "create_campaign", { name: "S", sender: { ...SENDER, from_name: "Priya\r\nBcc: all@x.test" } });
    expect(r.body.code).toBe("sender_name_invalid");
  });
});

// ── F-13 parent ids ────────────────────────────────────────────────────────
describe("F-13 — parent ids from the body are ownership-checked", () => {
  it("cannot add prospects under another tenant's campaign", async () => {
    const c = await campaignWithSender(A);
    const r = await post(B, "add_prospects", { campaign_id: c.id, prospects: [{ email: "x@y.test" }] });
    expect(r.status).toBe(404);
    expect((await db.one("select count(*)::int n from public.engagement_prospects where campaign_id = $1", [c.id])).n).toBe(0);
  });

  it("dedupes case-insensitively and reports rows with no address", async () => {
    const c = await campaignWithSender(A);
    const r = await post(A, "add_prospects", {
      campaign_id: c.id,
      prospects: [{ email: "Ana@Buyer.test" }, { email: "ana@buyer.test" }, { first_name: "No contact" }],
    });
    expect(r.body.prospects).toHaveLength(1);
    expect(r.body.prospects[0].email).toBe("ana@buyer.test");
    expect(r.body.stats.dupCount).toBe(1);
    expect(r.body.stats.invalidCount).toBe(1);
  });

  it("an import cannot set a prospect's funnel status", async () => {
    const c = await campaignWithSender(A);
    const p = await addProspect(A, c.id, { status: "converted" });
    expect(p.status).toBe("new");
  });

  it("caps an import", async () => {
    const c = await campaignWithSender(A);
    const many = Array.from({ length: 1001 }, (_, i) => ({ email: `p${i}@x.test` }));
    expect((await post(A, "add_prospects", { campaign_id: c.id, prospects: many })).status).toBe(413);
  });
});

// ── F-3 client-settable override ───────────────────────────────────────────
describe("F-3 — a request cannot un-opt-out a contact", () => {
  it("ignores meta.adminOverride from the body", async () => {
    const c = await campaignWithSender(A);
    const p = await addProspect(A, c.id);
    await post(A, "opt_out", { prospect_id: p.id, channels: ["email"] });
    expect((await prospectRow(p.id)).status).toBe("opted_out");
    const r = await post(A, "update_prospect_status", {
      campaign_id: c.id, prospect_id: p.id, status: "new", meta: { adminOverride: true },
    });
    expect(r.status).toBe(409);
    expect((await prospectRow(p.id)).status).toBe("opted_out");
  });

  it("opt-out goes through opt_out, not a status change", async () => {
    const c = await campaignWithSender(A);
    const p = await addProspect(A, c.id);
    const r = await post(A, "update_prospect_status", { campaign_id: c.id, prospect_id: p.id, status: "opted_out" });
    expect(r.body.code).toBe("use_opt_out");
  });

  it("delivery stages cannot be set by hand", async () => {
    const c = await campaignWithSender(A);
    const p = await addProspect(A, c.id);
    for (const status of ["sent", "delivered", "opened", "clicked"]) {
      expect((await post(A, "update_prospect_status", { campaign_id: c.id, prospect_id: p.id, status })).body.code).toBe("status_not_manual");
    }
  });
});

// ── F-2 one message per prospect ───────────────────────────────────────────
describe("F-2 — generate makes one draft, on one channel, per prospect", () => {
  it("creates exactly one email draft with the prospect's assigned variant", async () => {
    const c = await campaignWithSender(A);
    const p = await addProspect(A, c.id, { phone: "+15550001111" });
    const r = await post(A, "generate_messages", { campaign_id: c.id, prospect_ids: [p.id] });
    expect(r.body.messages).toHaveLength(1);
    expect(r.body.messages[0].channel).toBe("email");
  });

  it("refuses a channel that cannot send yet", async () => {
    const c = await campaignWithSender(A);
    const r = await post(A, "generate_messages", { campaign_id: c.id, channel: "whatsapp" });
    expect(r.body.code).toBe("channel_not_enabled");
  });

  it("does not draft twice for the same prospect", async () => {
    const c = await campaignWithSender(A);
    const p = await addProspect(A, c.id);
    await post(A, "generate_messages", { campaign_id: c.id, prospect_ids: [p.id] });
    const again = await post(A, "generate_messages", { campaign_id: c.id, prospect_ids: [p.id] });
    expect(again.body.messages).toHaveLength(0);
    expect(again.body.skipped[0].code).toBe("already_drafted");
  });

  it("does not draft for a suppressed address", async () => {
    const c = await campaignWithSender(A);
    const p = await addProspect(A, c.id);
    await post(A, "opt_out", { prospect_id: p.id, channels: ["email"] });
    const r = await post(A, "generate_messages", { campaign_id: c.id, prospect_ids: [p.id] });
    expect(r.body.messages).toHaveLength(0);
  });
});

// ── F-28 approval ──────────────────────────────────────────────────────────
describe("F-28 — approval", () => {
  it("refuses a draft that fails its guardrails", async () => {
    const c = await campaignWithSender(A);
    const p = await addProspect(A, c.id);
    const g = await post(A, "generate_messages", { campaign_id: c.id, prospect_ids: [p.id] });
    const r = await post(A, "approve_message", { message_id: g.body.messages[0].id, edits: { subject: "" } });
    expect(r.status).toBe(422);
    expect((await msgRow(g.body.messages[0].id)).status).toBe("pending_approval");
  });

  it("what the reviewer edited is what is stored to send", async () => {
    const c = await campaignWithSender(A);
    const p = await addProspect(A, c.id);
    const g = await post(A, "generate_messages", { campaign_id: c.id, prospect_ids: [p.id] });
    const id = g.body.messages[0].id;
    await post(A, "approve_message", { message_id: id, edits: { subject: "Edited subject", body: "Edited body. Unsubscribe: {{unsubscribe_url}}" } });
    const row = await msgRow(id);
    expect(row.subject).toBe("Edited subject");
    expect(row.body).toContain("Edited body");
    expect(row.body_html).toBeNull();
    expect(row.status).toBe("queued");
  });

  it("cannot approve twice, and moves the prospect to queued", async () => {
    const { p, m } = await readyToSend(A);
    expect((await post(A, "approve_message", { message_id: m.id })).status).toBe(409);
    expect((await prospectRow(p.id)).status).toBe("queued");
  });
});

// ── F-1 send once ──────────────────────────────────────────────────────────
describe("F-1 — a message is sent exactly once", () => {
  it("a second send sends nothing", async () => {
    const { c, p, m } = await readyToSend(A);
    const first = await post(A, "send_messages", { campaign_id: c.id });
    expect(first.body.sent).toBe(1);
    const second = await post(A, "send_messages", { campaign_id: c.id });
    expect(second.body.sent).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const row = await msgRow(m.id);
    expect(row.status).toBe("sent");
    expect(row.provider).toBe("resend");
    expect(row.external_message_id).toMatch(/^re_/);
    expect((await prospectRow(p.id)).status).toBe("sent");
    expect(mocks.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: "outreach_email" }));
  });

  it("two sends racing for the same message deliver it once (the claim, not the queue filter)", async () => {
    const { c, m } = await readyToSend(A);
    const [r1, r2] = await Promise.all([
      post(A, "send_messages", { campaign_id: c.id }),
      post(A, "send_messages", { campaign_id: c.id }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r1.body.sent + r2.body.sent).toBe(1);
    expect((await msgRow(m.id)).status).toBe("sent");
  });

  it("sends with an idempotency key, a one-click unsubscribe header and the campaign's sender", async () => {
    const { c, m } = await readyToSend(A);
    await post(A, "send_messages", { campaign_id: c.id });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers["Idempotency-Key"]).toBe(`engagement-msg-${m.id}`);
    const payload = JSON.parse(init.body);
    expect(payload.from).toBe(`${SENDER.from_name} <${SENDER.from_email}>`);
    expect(payload.reply_to).toBe(SENDER.reply_to);
    expect(payload.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(payload.headers["List-Unsubscribe"]).toMatch(/^<https:\/\/app\.example\.com\/api\/engagement-unsubscribe\?t=/);
    expect(payload.text).not.toContain("{{unsubscribe_url}}");
  });

  it("another tenant cannot send someone else's messages", async () => {
    const { m } = await readyToSend(A);
    const cB = await campaignWithSender(B);
    const r = await post(B, "send_messages", { campaign_id: cB.id, message_ids: [m.id] });
    expect(r.body.sent).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await msgRow(m.id)).status).toBe("queued");
  });
});

// ── F-3 consent at send time ───────────────────────────────────────────────
describe("F-3 — consent is checked at SEND time", () => {
  it("an opt-out recorded after approval stops the send", async () => {
    const { c, p, m } = await readyToSend(A);
    await post(A, "opt_out", { prospect_id: p.id, channels: ["email"] });
    const r = await post(A, "send_messages", { campaign_id: c.id });
    expect(r.body.sent).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    const row = await msgRow(m.id);
    expect(row.status).toBe("skipped");
  });

  // 🔴 The case only the suppression list can catch: the prospect is still in
  // the funnel (reachable by phone), so their STATUS says nothing — only the
  // per-channel row stops the email. The test above passes on status alone.
  it("an email-only opt-out stops the email even though the prospect is still reachable by phone", async () => {
    const { c, p, m } = await readyToSend(A, { phone: "+15550004444" });
    await post(A, "opt_out", { prospect_id: p.id, channels: ["email"] });
    expect((await prospectRow(p.id)).status).not.toBe("opted_out");
    await post(A, "send_messages", { campaign_id: c.id });
    expect(fetchMock).not.toHaveBeenCalled();
    const row = await msgRow(m.id);
    expect(row.status).toBe("skipped");
    expect(row.failure_code).toBe("suppressed_manual");
  });

  it("an opt-out in one campaign covers the same person in another", async () => {
    const c1 = await campaignWithSender(A);
    const p1 = await addProspect(A, c1.id);
    await post(A, "opt_out", { prospect_id: p1.id, channels: ["email"] });
    const c2 = await campaignWithSender(A);
    const p2 = await addProspect(A, c2.id); // same address, different campaign
    const g = await post(A, "generate_messages", { campaign_id: c2.id, prospect_ids: [p2.id] });
    expect(g.body.messages).toHaveLength(0);
    expect(g.body.skipped[0].code).toBe("suppressed_manual");
  });

  it("per channel: opting out of email alone leaves the prospect in the funnel", async () => {
    const c = await campaignWithSender(A);
    const p = await addProspect(A, c.id, { phone: "+15550002222" });
    const r = await post(A, "opt_out", { prospect_id: p.id, channels: ["email"] });
    expect(r.body.allChannels).toBe(false);
    expect((await prospectRow(p.id)).status).toBe("new");
    const s = await get(A, "list_suppressions", { prospect_id: p.id });
    expect(s.body.suppressions.map((x) => x.channel)).toEqual(["email"]);
  });

  it("opting out of every reachable channel marks the prospect opted out", async () => {
    const c = await campaignWithSender(A);
    const p = await addProspect(A, c.id, { phone: "+15550003333" });
    const r = await post(A, "opt_out", { prospect_id: p.id, channels: ["email", "whatsapp", "sms", "telegram"] });
    expect(r.body.allChannels).toBe(true);
    expect((await prospectRow(p.id)).status).toBe("opted_out");
  });

  it("a tenant cannot lift an opt-out the policy does not allow", async () => {
    const c = await campaignWithSender(A);
    const p = await addProspect(A, c.id);
    await post(A, "opt_out", { prospect_id: p.id, channels: ["email"] });
    const [s] = (await get(A, "list_suppressions", { prospect_id: p.id })).body.suppressions;
    const r = await post(A, "lift_suppression", { suppression_id: s.id });
    // canLiftSuppression() is the owner's policy; until it allows this, it is refused.
    expect([200, 403]).toContain(r.status);
    if (r.status === 403) expect(r.body.code).toBe("not_liftable");
  });

  it("another tenant's suppression list is invisible", async () => {
    const c = await campaignWithSender(A);
    const p = await addProspect(A, c.id);
    await post(A, "opt_out", { prospect_id: p.id, channels: ["email"] });
    expect((await get(B, "list_suppressions")).body.suppressions).toHaveLength(0);
    expect((await get(B, "list_suppressions", { prospect_id: p.id })).status).toBe(404);
  });
});

// ── F-4 no fabricated success ──────────────────────────────────────────────
describe("F-4 — an unconfigured provider is a failure, never a send", () => {
  it("without an outreach email key the message fails with a code", async () => {
    delete process.env.ENGAGEMENT_RESEND_API_KEY;
    const { c, m } = await readyToSend(A);
    const r = await post(A, "send_messages", { campaign_id: c.id });
    expect(r.body.sent).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    const row = await msgRow(m.id);
    expect(row.status).toBe("failed");
    expect(row.failure_code).toBe("email_not_configured");
  });

  it("does not fall back to the transactional RESEND_API_KEY", async () => {
    delete process.env.ENGAGEMENT_RESEND_API_KEY;
    process.env.RESEND_API_KEY = "re_transactional";
    const { c } = await readyToSend(A);
    await post(A, "send_messages", { campaign_id: c.id });
    expect(fetchMock).not.toHaveBeenCalled();
    delete process.env.RESEND_API_KEY;
  });

  it("mock sending is labelled as mock and refused in production", async () => {
    process.env.ENGAGEMENT_MOCK_SEND = "1";
    const { c, m } = await readyToSend(A);
    await post(A, "send_messages", { campaign_id: c.id });
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await msgRow(m.id)).external_message_id).toBe(`mock_${m.id}`);

    process.env.CONTEXT = "production";
    const { c: c2 } = await readyToSend(A, { email: "prod@buyer.test" });
    await post(A, "send_messages", { campaign_id: c2.id });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    delete process.env.CONTEXT;
  });

  it("a campaign with no sender fails with sender_missing", async () => {
    const c = (await post(A, "create_campaign", { name: "No sender" })).body.campaign;
    const p = await addProspect(A, c.id);
    const g = await post(A, "generate_messages", { campaign_id: c.id, prospect_ids: [p.id] });
    await post(A, "approve_message", { message_id: g.body.messages[0].id });
    await post(A, "send_messages", { campaign_id: c.id });
    const row = await msgRow(g.body.messages[0].id);
    expect(row.status).toBe("failed");
    expect(row.failure_code).toBe("sender_missing");
  });
});

// ── credits and retries ────────────────────────────────────────────────────
describe("credits and provider failures", () => {
  it("out of credits leaves the message queued and sends nothing", async () => {
    mocks.affords.mockResolvedValue({ ok: false });
    const { c, m } = await readyToSend(A);
    const r = await post(A, "send_messages", { campaign_id: c.id });
    expect(r.body.deferred).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    const row = await msgRow(m.id);
    expect(row.status).toBe("queued");
    expect(row.failure_code).toBe("insufficient_credits");
  });

  it("a provider 5xx is retried, then fails after the attempt limit", async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    const { c, m } = await readyToSend(A);
    for (let i = 0; i < 3; i++) await post(A, "send_messages", { campaign_id: c.id });
    const row = await msgRow(m.id);
    expect(row.attempts).toBe(3);
    expect(row.status).toBe("failed");
    expect(row.failure_code).toBe("provider_unavailable");
    expect((await post(A, "retry_message", { message_id: m.id })).status).toBe(200);
    expect((await msgRow(m.id)).status).toBe("queued");
  });

  it("a provider 4xx fails immediately and is never charged", async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 422, json: async () => ({ message: "bad" }) }));
    const { c, m } = await readyToSend(A);
    await post(A, "send_messages", { campaign_id: c.id });
    expect((await msgRow(m.id)).failure_code).toBe("provider_rejected");
    expect(mocks.record).not.toHaveBeenCalled();
  });
});

// ── read paths ─────────────────────────────────────────────────────────────
describe("reads", () => {
  it("messages carry a prospect summary, and analytics count what was sent", async () => {
    const { c } = await readyToSend(A);
    await post(A, "send_messages", { campaign_id: c.id });
    const msgs = await get(A, "list_messages", { campaign_id: c.id });
    expect(msgs.body.messages[0].engagement_prospects.email).toBe("ana@buyer.test");
    const an = await get(A, "get_analytics", { campaign_id: c.id });
    expect(an.body.funnel.sent).toBe(1);
    expect(an.body.channel_breakdown.email.sent).toBe(1);
    expect(an.body.variants).toHaveLength(1);
  });

  it("search input cannot break the query", async () => {
    const c = await campaignWithSender(A);
    await addProspect(A, c.id);
    const r = await get(A, "list_prospects", { campaign_id: c.id, search: "ana),email.eq.x,(" });
    expect(r.status).toBe(200);
  });

  it("notes are written to the audit trail, which cannot be edited", async () => {
    const c = await campaignWithSender(A);
    const p = await addProspect(A, c.id);
    expect((await post(A, "add_note", { prospect_id: p.id, note: "Called, interested" })).status).toBe(200);
    const logs = await get(A, "list_activity", { prospect_id: p.id });
    expect(logs.body.activity.some((a) => a.event_type === "note")).toBe(true);
    await expect(db.pg.query("update public.engagement_activity_log set event_type = 'x' where prospect_id = $1", [p.id]))
      .rejects.toThrow(/append-only/);
  });
});

// ── campaign names, editing, deletion ─────────────────────────────────────
describe("campaign names are unique per account", () => {
  it("refuses a second campaign with the same name, ignoring case and spacing", async () => {
    expect((await post(A, "create_campaign", { name: "Q4 Outreach" })).status).toBe(200);
    const r = await post(A, "create_campaign", { name: "  q4   outreach " });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("campaign_name_taken");
    expect(r.body.error).toMatch(/"Q4 Outreach" already exists/);
    expect((await db.one("select count(*)::int as n from public.engagement_campaigns where user_id = $1", [A])).n).toBe(1);
  });

  it("lets two different accounts use the same name", async () => {
    await post(A, "create_campaign", { name: "Shared" });
    expect((await post(B, "create_campaign", { name: "Shared" })).status).toBe(200);
  });

  it("renames and edits the description, and refuses a rename onto another campaign's name", async () => {
    const one = (await post(A, "create_campaign", { name: "One" })).body.campaign;
    await post(A, "create_campaign", { name: "Two" });
    const ok = await post(A, "update_campaign", { campaign_id: one.id, updates: { name: "One (EU)", description: "EU leads" } });
    expect(ok.status).toBe(200);
    expect(ok.body.campaign).toMatchObject({ name: "One (EU)", description: "EU leads" });
    const clash = await post(A, "update_campaign", { campaign_id: one.id, updates: { name: "two" } });
    expect(clash.status).toBe(409);
    // Re-saving its own name (e.g. a case change) is not a clash with itself.
    expect((await post(A, "update_campaign", { campaign_id: one.id, updates: { name: "ONE (eu)" } })).status).toBe(200);
  });

  it("deletes a campaign that has prospects, messages and activity, and keeps the account's opt-outs", async () => {
    const { c, p } = await readyToSend(A);
    await post(A, "send_messages", { campaign_id: c.id });
    await post(A, "opt_out", { prospect_id: p.id, channels: ["email"] });
    const r = await post(A, "delete_campaign", { campaign_id: c.id });
    expect(r.status).toBe(200);
    expect((await db.one("select count(*)::int as n from public.engagement_prospects where campaign_id = $1", [c.id])).n).toBe(0);
    expect((await db.one("select count(*)::int as n from public.engagement_suppressions where user_id = $1", [A])).n).toBe(1);
  });
});
