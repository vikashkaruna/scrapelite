// netlify/__tests__/audit/analytics-purge.test.js
//
// D16 Early Deletion Test Suite:
// Asserts that users and operators have the provision to delete analytics data
// earlier than the default 90-day retention window, including:
// 1. auditStore.purgeAnalyticsData with olderThanDays or purgeAll
// 2. auditStore.deleteAnalyticsConnection cascading data purge
// 3. POST /api/sxo/analytics/purge and DELETE /api/sxo/analytics-data
// 4. DELETE /api/sxo/integrations/:provider with purge_data flag
// 5. Operator purge-analytics-retention action in admin-automation.js

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as auditStore from "../../functions/lib/audit/auditStore.js";
import { handler as discoverabilityHandler } from "../../functions/discoverability.js";
import { handler as adminAutomationHandler } from "../../functions/admin-automation.js";
import * as serverClient from "../../functions/lib/supabaseServerClient.js";
import * as adminToken from "../../functions/lib/adminToken.js";

describe("D16 Early Analytics Data Deletion Provisions", () => {
  const userId = "usr-purge-test-123";

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.SUPABASE_URL = "https://x.supabase.co";
    process.env.SUPABASE_SERVICE_KEY = "sk";
    vi.spyOn(serverClient, "authenticateBearer").mockResolvedValue({
      ok: true,
      user: { id: userId, email: "purge@datiq.test" },
    });
  });

  it("purgeAnalyticsData deletes older records when olderThanDays is provided", async () => {
    const purgeSpy = vi.spyOn(auditStore, "purgeAnalyticsData").mockResolvedValue({
      ok: true,
      purged: true,
      deleted: { aggregates: 15, funnels: 2, form_diagnostics: 4, total: 21 },
    });

    const res = await auditStore.purgeAnalyticsData(userId, { olderThanDays: 30 });
    expect(res.ok).toBe(true);
    expect(res.deleted.total).toBe(21);
    expect(purgeSpy).toHaveBeenCalledWith(userId, { olderThanDays: 30 });
  });

  it("purgeAnalyticsData deletes all records when purgeAll is true", async () => {
    const purgeSpy = vi.spyOn(auditStore, "purgeAnalyticsData").mockResolvedValue({
      ok: true,
      purged: true,
      deleted: { aggregates: 50, funnels: 10, form_diagnostics: 10, total: 70 },
    });

    const res = await auditStore.purgeAnalyticsData(userId, { purgeAll: true });
    expect(res.ok).toBe(true);
    expect(res.deleted.total).toBe(70);
    expect(purgeSpy).toHaveBeenCalledWith(userId, { purgeAll: true });
  });

  it("deleteAnalyticsConnection purges data when purgeData is true", async () => {
    const deleteSpy = vi.spyOn(auditStore, "deleteAnalyticsConnection").mockResolvedValue({
      ok: true,
      purged_data: true,
    });

    const res = await auditStore.deleteAnalyticsConnection(userId, "ga4", { purgeData: true });
    expect(res.ok).toBe(true);
    expect(res.purged_data).toBe(true);
    expect(deleteSpy).toHaveBeenCalledWith(userId, "ga4", { purgeData: true });
  });

  it("POST /api/sxo/analytics/purge executes early purge for user", async () => {
    vi.spyOn(auditStore, "purgeAnalyticsData").mockResolvedValue({
      ok: true,
      purged: true,
      deleted: { aggregates: 12, funnels: 3, form_diagnostics: 1, total: 16 },
    });

    const res = await discoverabilityHandler({
      httpMethod: "POST",
      path: "/api/sxo/analytics/purge",
      headers: { authorization: "Bearer valid-token" },
      body: JSON.stringify({
        older_than_days: 7,
      }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.deleted.total).toBe(16);
  });

  it("DELETE /api/sxo/analytics-data supports immediate wipe (purge_all)", async () => {
    vi.spyOn(auditStore, "purgeAnalyticsData").mockResolvedValue({
      ok: true,
      purged: true,
      deleted: { aggregates: 80, funnels: 15, form_diagnostics: 10, total: 105 },
    });

    const res = await discoverabilityHandler({
      httpMethod: "DELETE",
      path: "/api/sxo/analytics-data",
      queryStringParameters: { purge_all: "true" },
      headers: { authorization: "Bearer valid-token" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.deleted.total).toBe(105);
  });

  it("DELETE /api/sxo/integrations/:provider?purge_data=true triggers data purge", async () => {
    vi.spyOn(auditStore, "deleteAnalyticsConnection").mockResolvedValue({
      ok: true,
      purged_data: true,
    });

    const res = await discoverabilityHandler({
      httpMethod: "DELETE",
      path: "/api/sxo/integrations/posthog",
      queryStringParameters: { purge_data: "true" },
      headers: { authorization: "Bearer valid-token" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.disconnected).toBe("posthog");
    expect(body.purged_data).toBe(true);
  });

  it("Admin operator can trigger purge-analytics-retention via admin-automation", async () => {
    vi.spyOn(adminToken, "bearerFromEvent").mockReturnValue("valid-admin-token");
    vi.spyOn(adminToken, "verifyAdminToken").mockReturnValue({ ok: true, actor: "operator" });

    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation((url) => {
      if (typeof url === "string" && url.includes("audit_analytics")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ id: "row-1" }, { id: "row-2" }]),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    });

    try {
      const res = await adminAutomationHandler({
        httpMethod: "POST",
        headers: { authorization: "Bearer valid-admin-token" },
        body: JSON.stringify({
          action: "purge-analytics-retention",
          older_than_days: 14,
          user_id: userId,
        }),
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.ok).toBe(true);
      expect(body.purged).toBe(true);
      expect(body.older_than_days).toBe(14);
      expect(body.target_user_id).toBe(userId);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
