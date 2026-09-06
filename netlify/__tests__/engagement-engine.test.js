// netlify/__tests__/engagement-engine.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateBearer: vi.fn(),
}));

vi.mock("../functions/lib/supabaseServerClient.js", () => ({
  authenticateBearer: mocks.authenticateBearer,
}));

let handler;

beforeEach(async () => {
  vi.resetModules();
  mocks.authenticateBearer.mockReset();
  mocks.authenticateBearer.mockResolvedValue({
    ok: true,
    user: { id: "user_test_123" },
  });
  ({ handler } = await import("../functions/engagement-engine.js"));
});

afterEach(() => {
  vi.restoreAllMocks();
});

const invoke = (method, path = "", body = null, query = {}) =>
  handler({
    httpMethod: method,
    path: `/api/engagement${path}`,
    headers: { Authorization: "Bearer test_token" },
    queryStringParameters: query,
    body: body ? JSON.stringify(body) : null,
  });

describe("engagement-engine — authentication gate", () => {
  it("refuses unauthenticated requests with 401", async () => {
    mocks.authenticateBearer.mockResolvedValueOnce({
      ok: false,
      status: 401,
      body: { error: "unauthenticated" },
    });

    const res = await invoke("GET", "/campaigns", null, { action: "list_campaigns" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 for unknown action", async () => {
    const res = await invoke("POST", "", { action: "unknown_magic_action" });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when get_campaign lacks campaign_id", async () => {
    const res = await invoke("GET", "", null, { action: "get_campaign" });
    expect(res.statusCode).toBe(400);
  });
});

describe("engagement-engine — campaign operations", () => {
  it("creates a campaign with custom brand kit", async () => {
    const res = await invoke("POST", "", {
      action: "create_campaign",
      name: "Q4 Enterprise CI Outreach",
      description: "Automated competitor signals outreach",
      brand_kit: {
        company_name: "DatIQ",
        cta_url: "https://datiq.app/demo",
        value_prop: "automated competitive intelligence",
      },
      channel_priority: ["email", "whatsapp"],
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.ok).toBe(true);
    expect(data.campaign.name).toBe("Q4 Enterprise CI Outreach");
    expect(data.campaign.brand_kit.company_name).toBe("DatIQ");
  });

  it("lists existing campaigns for the user", async () => {
    const res = await invoke("GET", "", null, { action: "list_campaigns" });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.ok).toBe(true);
    expect(Array.isArray(data.campaigns)).toBe(true);
  });
});

describe("engagement-engine — prospects & deduplication", () => {
  let campaignId;

  beforeEach(async () => {
    const campRes = await invoke("POST", "", {
      action: "create_campaign",
      name: "Test Campaign for Prospects",
    });
    campaignId = JSON.parse(campRes.body).campaign.id;
  });

  it("adds prospects and deduplicates by email", async () => {
    const prospects = [
      { first_name: "Alice", email: "alice@example.com", company: "Example Inc" },
      { first_name: "Alice Dup", email: "alice@example.com", company: "Example Inc" }, // Duplicate
      { first_name: "Bob", email: "bob@example.com", company: "Bob Co" },
    ];

    const res = await invoke("POST", "", {
      action: "add_prospects",
      campaignId,
      prospects,
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.ok).toBe(true);
    expect(data.prospects.length).toBe(2);
    expect(data.duplicates.length).toBe(1);
    expect(data.stats.uniqueCount).toBe(2);
  });

  it("returns empty result when prospects array is empty", async () => {
    const res = await invoke("POST", "", {
      action: "add_prospects",
      campaignId,
      prospects: [],
    });
    
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.ok).toBe(true);
    expect(data.prospects.length).toBe(0);
  });
});

describe("engagement-engine — AI message generation & approval flow", () => {
  let campaignId;
  let prospectId;

  beforeEach(async () => {
    const campRes = await invoke("POST", "", {
      action: "create_campaign",
      name: "Outreach Flow Campaign",
      brand_kit: { company_name: "DatIQ", cta_url: "https://datiq.app" },
    });
    campaignId = JSON.parse(campRes.body).campaign.id;

    const prsRes = await invoke("POST", "", {
      action: "add_prospects",
      campaignId,
      prospects: [{ first_name: "Carol", email: "carol@fintech.test", company: "Fintech Co", role: "VP Tech" }],
    });
    prospectId = JSON.parse(prsRes.body).prospects[0].id;
  });

  it("generates multi-variant messages for target prospect", async () => {
    const genRes = await invoke("POST", "", {
      action: "generate_messages",
      campaignId,
      prospectIds: [prospectId],
    });

    expect(genRes.statusCode).toBe(200);
    const genData = JSON.parse(genRes.body);
    expect(genData.ok).toBe(true);
    expect(genData.messages.length).toBeGreaterThanOrEqual(2);

    const emailMsg = genData.messages.find((m) => m.channel === "email");
    expect(emailMsg.body).toContain("Carol");
    expect(emailMsg.status).toBe("pending_approval");
  });

  it("returns empty messages array when prospectIds do not match", async () => {
    const genRes = await invoke("POST", "", {
      action: "generate_messages",
      campaignId,
      prospectIds: ["non_existent_id"],
    });

    expect(genRes.statusCode).toBe(200);
    const data = JSON.parse(genRes.body);
    expect(data.ok).toBe(true);
    expect(data.messages.length).toBe(0);
  });

  it("approves message and advances prospect status to queued", async () => {
    // Generate
    const genRes = await invoke("POST", "", {
      action: "generate_messages",
      campaignId,
      prospectIds: [prospectId],
    });
    const messageId = JSON.parse(genRes.body).messages[0].id;

    // Approve
    const appRes = await invoke("POST", "", {
      action: "approve_message",
      messageId,
    });

    expect(appRes.statusCode).toBe(200);
    const appData = JSON.parse(appRes.body);
    expect(appData.message.approval_status).toBe("approved");

    // Dispatch
    const dispRes = await invoke("POST", "", {
      action: "dispatch_messages",
      campaignId,
      messageIds: [messageId],
    });

    expect(dispRes.statusCode).toBe(200);
    const dispData = JSON.parse(dispRes.body);
    expect(dispData.ok).toBe(true);
    expect(dispData.dispatches[0].status).toBe("sent");
  });

  it("computes campaign analytics and conversion funnels", async () => {
    const anRes = await invoke("GET", "", null, {
      action: "get_analytics",
      campaign_id: campaignId,
    });

    expect(anRes.statusCode).toBe(200);
    const anData = JSON.parse(anRes.body);
    expect(anData.ok).toBe(true);
    expect(anData.total_prospects).toBeGreaterThanOrEqual(1);
    expect(anData.funnel).toBeDefined();
    expect(anData.rates).toBeDefined();
  });

  it("executes check_stale_prospects SLA monitor", async () => {
    const res = await invoke("POST", "", {
      action: "check_stale_prospects",
      campaign_id: campaignId,
      followup_delay_days: 1,
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.ok).toBe(true);
    expect(typeof data.stale_count).toBe("number");
  });
});
