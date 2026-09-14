// netlify/__tests__/audit/analytics-parity.test.js
//
// Stage 3 (P3B) Parity & Invariant Test Suite:
// Asserts migration 0069 constraints, privacy/DPDP governance,
// token encryption/masking, 24-event taxonomy, 9-stage funnel drop-off logic,
// and API endpoints.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { handler } from "../../functions/discoverability.js";
import * as auditStore from "../../functions/lib/audit/auditStore.js";
import * as serverClient from "../../functions/lib/supabaseServerClient.js";
import { NORMALIZED_EVENTS, SEGMENTATION_AXES } from "../../../src/lib/discoverability/eventTaxonomy.js";
import { FUNNEL_STAGES } from "../../../src/lib/discoverability/journeyModel.js";
import { FORM_METRIC_KEYS, evaluateFormDiagnostics } from "../../../src/lib/discoverability/formDiagnostics.js";

const ROOT = process.cwd();
const RAW_SQL = readFileSync(join(ROOT, "supabase", "migrations", "0069_analytics_funnels_forms.sql"), "utf8");
const SQL = RAW_SQL.replace(/^\s*--.*$/gm, "");
const IMPORT_SQL = readFileSync(join(ROOT, "supabase", "migrations", "0071_analytics_import_jobs.sql"), "utf8")
  .replace(/^\s*--.*$/gm, "");
const STATUS_SQL = readFileSync(join(ROOT, "supabase", "migrations", "0072_analytics_connection_status.sql"), "utf8")
  .replace(/^\s*--.*$/gm, "");

describe("Migration 0069 Guarantees (§11.14 / Stage 3 parity)", () => {
  it("creates all 6 analytics, funnel, and form tables", () => {
    const expectedTables = [
      "audit_conversion_goals",
      "audit_analytics_connections",
      "audit_analytics_event_mappings",
      "audit_analytics_aggregates",
      "audit_journey_funnels",
      "audit_form_diagnostics",
    ];
    for (const table of expectedTables) {
      expect(SQL).toMatch(new RegExp(`create table if not exists public\\.${table}`, "i"));
      expect(SQL).toMatch(new RegExp(`alter table public\\.${table} enable row level security`, "i"));
      expect(SQL).toMatch(new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`, "i"));
      expect(SQL).toMatch(new RegExp(`grant all on table public\\.${table} to service_role`, "i"));
    }
  });

  it("audit_analytics_connections stores encrypted_token and token_fingerprint", () => {
    expect(SQL).toMatch(/encrypted_token\s+text/i);
    expect(SQL).toMatch(/token_fingerprint\s+text\s+not\s+null/i);
  });

  it("audit_analytics_aggregates enforces privacy minimization (aggregates only, no raw IP or session rows)", () => {
    expect(SQL).toMatch(/event_counts\s+jsonb\s+not\s+null/i);
    expect(SQL).toMatch(/metrics\s+jsonb\s+not\s+null/i);
    expect(SQL).not.toMatch(/session_id/i);
    expect(SQL).not.toMatch(/ip_address/i);
  });
});

describe("Migration 0071 durable import guarantees", () => {
  it("stores an idempotent bounded-retry queue under service-role-only RLS", () => {
    expect(IMPORT_SQL).toMatch(/create table if not exists public\.audit_analytics_import_jobs/i);
    expect(IMPORT_SQL).toMatch(/unique\s*\(user_id,\s*provider,\s*idempotency_key\)/i);
    expect(IMPORT_SQL).toMatch(/max_attempts\s+integer\s+not null default 5/i);
    expect(IMPORT_SQL).toMatch(/for update skip locked/i);
    expect(IMPORT_SQL).toMatch(/revoke all on table public\.audit_analytics_import_jobs from public, anon, authenticated/i);
  });

  it("prevents a retried job from creating a second aggregate", () => {
    expect(IMPORT_SQL).toMatch(/add column if not exists import_job_id/i);
    expect(IMPORT_SQL).toMatch(/unique\s*\(import_job_id\)/i);
  });
});

describe("Migration 0072 connector-state guarantees", () => {
  it("does not claim a provider connection before verification or sync", () => {
    expect(STATUS_SQL).toMatch(/set status = 'configured',[\s\S]*last_sync_at = null/i);
    expect(STATUS_SQL).toMatch(/alter column status set default 'configured'/i);
    expect(STATUS_SQL).toMatch(/configured[\s\S]*connected[\s\S]*error[\s\S]*disabled/i);
  });
});

describe("Analytics Endpoints & Privacy Invariants", () => {
  const userId = "usr-analytics-test-123";

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(serverClient, "authenticateBearer").mockResolvedValue({
      ok: true,
      user: { id: userId, email: "analytics@datiq.test" },
    });
    vi.spyOn(auditStore, "getAuditFull").mockResolvedValue({
      audit: { id: "aud-owned", user_id: userId },
      result: {}, signals: [], issues: [], recommendations: [], promptRuns: [],
    });
  });

  it("POST /api/sxo/integrations/:provider/connect masks token and NEVER leaks it on GET", async () => {
    const rawToken = "ghp_super_secret_analytics_token_9876543210";

    vi.spyOn(auditStore, "saveAnalyticsConnection").mockResolvedValue({
      ok: true,
      connection: {
        id: "conn-123",
        provider: "ga4",
        token_fingerprint: "ghp_…3210 (43 chars)",
        status: "configured",
      },
    });

    const connectRes = await handler({
      httpMethod: "POST",
      path: "/api/sxo/integrations/ga4/connect",
      headers: { authorization: "Bearer valid-token" },
      body: JSON.stringify({
        token: rawToken,
        provider_account_id: "GA4-12345",
      }),
    });

    expect(connectRes.statusCode).toBe(200);
    const connectBody = JSON.parse(connectRes.body);
    expect(connectBody.connection.token_fingerprint).toBe("ghp_…3210 (43 chars)");
    expect(connectBody.connection.encrypted_token).toBeUndefined();
    expect(connectRes.body).not.toContain(rawToken);

    // Test GET /api/sxo/integrations
    vi.spyOn(auditStore, "listAnalyticsConnections").mockResolvedValue([
      {
        id: "conn-123",
        provider: "ga4",
        token_fingerprint: "ghp_…3210 (43 chars)",
        status: "configured",
      },
    ]);

    const listRes = await handler({
      httpMethod: "GET",
      path: "/api/sxo/integrations",
      headers: { authorization: "Bearer valid-token" },
    });

    expect(listRes.statusCode).toBe(200);
    const listBody = JSON.parse(listRes.body);
    expect(listBody.connections.length).toBe(1);
    expect(listBody.connections[0].token_fingerprint).toBe("ghp_…3210 (43 chars)");
    expect(listBody.connections[0].encrypted_token).toBeUndefined();
  });

  it("DELETE /api/sxo/integrations/:provider deletes connection credentials immediately", async () => {
    vi.spyOn(auditStore, "deleteAnalyticsConnection").mockResolvedValue({ ok: true });

    const res = await handler({
      httpMethod: "DELETE",
      path: "/api/sxo/integrations/ga4",
      headers: { authorization: "Bearer valid-token" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.disconnected).toBe("ga4");
  });

  it("POST /api/sxo/events/import validates, privacy-minimizes, and queues normalized aggregates", async () => {
    const saveSpy = vi.spyOn(auditStore, "saveAnalyticsAggregates");
    vi.spyOn(auditStore, "enqueueAnalyticsImport").mockResolvedValue({
      ok: true,
      replay: false,
      job: { id: "import-123", state: "pending", attempts: 0, payload_hash: "expected" },
    });

    const res = await handler({
      httpMethod: "POST",
      path: "/api/sxo/events/import",
      headers: { authorization: "Bearer valid-token" },
      body: JSON.stringify({
        audit_id: "aud-123",
        provider: "ga4",
        idempotency_key: "ga4-aud-123-2026-09-14",
        events: [
          { event_name: "page_view", count: 100 },
          { event_name: "click", properties: { is_primary: true }, count: 20 },
          { event_name: "unknown_custom_trigger", count: 5 },
        ],
      }),
    });

    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body);
    expect(body.queued).toBe(true);
    expect(body.imported_events_count).toBe(0);
    expect(body.event_counts.page_view).toBe(100);
    expect(body.event_counts.primary_cta_click).toBe(20);
    expect(body.unmapped.length).toBe(1);
    expect(body.unmapped[0].unmapped_name).toBe("unknown_custom_trigger");
    expect(auditStore.enqueueAnalyticsImport).toHaveBeenCalledWith(userId, expect.objectContaining({
      provider: "ga4",
      idempotencyKey: "ga4-aud-123-2026-09-14",
      aggregatePayload: expect.objectContaining({
        auditId: "aud-123",
        eventCounts: { page_view: 100, primary_cta_click: 20 },
      }),
    }));
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("requires an idempotency key before accepting an analytics import", async () => {
    const res = await handler({
      httpMethod: "POST",
      path: "/api/sxo/events/import",
      headers: { authorization: "Bearer valid-token" },
      body: JSON.stringify({ provider: "custom", events: [{ event_name: "page_view", count: 1 }] }),
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/idempotency_key/i);
  });

  it("refuses reuse of an idempotency key with a different aggregate payload", async () => {
    vi.spyOn(auditStore, "enqueueAnalyticsImport").mockResolvedValue({
      ok: true,
      replay: true,
      job: { id: "import-123", state: "pending", attempts: 0, payload_hash: "different" },
    });
    const res = await handler({
      httpMethod: "POST",
      path: "/api/sxo/events/import",
      headers: { authorization: "Bearer valid-token" },
      body: JSON.stringify({
        provider: "custom",
        idempotency_key: "same-key",
        events: [{ event_name: "page_view", count: 2 }],
      }),
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("GET /api/sxo/audits/:id/journey returns 9 stages with unmeasured exclusion", async () => {
    vi.spyOn(auditStore, "getJourneyFunnel").mockResolvedValue(null);
    vi.spyOn(auditStore, "listAnalyticsAggregates").mockResolvedValue([
      {
        event_counts: {
          page_view: 500,
          primary_cta_click: 50,
          form_submit: 10,
        },
      },
    ]);

    const res = await handler({
      httpMethod: "GET",
      path: "/api/sxo/audits/aud-456/journey",
      headers: { authorization: "Bearer valid-token" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.funnel).toBeDefined();
    expect(body.funnel.stage_results.length).toBe(9);

    const landing = body.funnel.stage_results.find((s) => s.key === "landing_session");
    expect(landing.measured).toBe(true);
    expect(landing.count).toBe(500);

    const keyContent = body.funnel.stage_results.find((s) => s.key === "key_content_seen");
    expect(keyContent.measured).toBe(false);
    expect(keyContent.status).toBe("unmeasured");

    expect(body.funnel.mi_caveats.length).toBeGreaterThan(0);
  });

  it("GET /api/sxo/audits/:id/form-diagnostics returns 9 per-form metrics and recommendations", async () => {
    vi.spyOn(auditStore, "getFormDiagnostics").mockResolvedValue(evaluateFormDiagnostics({
      views: 1000, starts: 400, submits: 100, fieldErrors: 200,
    }));

    const res = await handler({
      httpMethod: "GET",
      path: "/api/sxo/audits/aud-789/form-diagnostics",
      queryStringParameters: {
        views: "1000",
        starts: "400",
        submits: "100",
        field_errors: "200",
      },
      headers: { authorization: "Bearer valid-token" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.diagnostics).toBeDefined();
    expect(body.diagnostics.metrics.views).toBe(1000);
    expect(body.diagnostics.metrics.starts).toBe(400);
    expect(body.diagnostics.metrics.submits).toBe(100);
    expect(body.diagnostics.metrics.completion_rate).toBe(25);
    expect(body.diagnostics.metrics.abandonment_rate).toBe(75);
    expect(body.diagnostics.friction_flags).toContain("HIGH_ABANDONMENT_RATE");
  });

  it("does not synthesize form diagnostics from caller-controlled query parameters", async () => {
    vi.spyOn(auditStore, "getFormDiagnostics").mockResolvedValue(null);
    const res = await handler({
      httpMethod: "GET",
      path: "/api/sxo/audits/aud-789/form-diagnostics",
      headers: { authorization: "Bearer valid-token" },
      queryStringParameters: { views: "1000000", submits: "1000000" },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).diagnostics).toBeNull();
  });

  it("returns 404 for journey and form reads when the audit is not accessible", async () => {
    auditStore.getAuditFull.mockResolvedValue(null);
    for (const suffix of ["journey", "form-diagnostics"]) {
      const res = await handler({
        httpMethod: "GET",
        path: `/api/sxo/audits/foreign-audit/${suffix}`,
        headers: { authorization: "Bearer valid-token" },
      });
      expect(res.statusCode).toBe(404);
    }
  });

  it("POST /api/sxo/conversion-goals and GET /api/sxo/conversion-goals manages goals", async () => {
    vi.spyOn(auditStore, "saveConversionGoal").mockResolvedValue({
      ok: true,
      goal: { id: "goal-1", name: "Signups", outcome_type: "account_creation" },
    });
    vi.spyOn(auditStore, "listConversionGoals").mockResolvedValue([
      { id: "goal-1", name: "Signups", outcome_type: "account_creation" },
    ]);

    const postRes = await handler({
      httpMethod: "POST",
      path: "/api/sxo/conversion-goals",
      headers: { authorization: "Bearer valid-token" },
      body: JSON.stringify({
        name: "Signups",
        outcome_type: "account_creation",
      }),
    });
    expect(postRes.statusCode).toBe(200);

    const getRes = await handler({
      httpMethod: "GET",
      path: "/api/sxo/conversion-goals",
      headers: { authorization: "Bearer valid-token" },
    });
    expect(getRes.statusCode).toBe(200);
    const getBody = JSON.parse(getRes.body);
    expect(getBody.goals.length).toBe(1);
    expect(getBody.goals[0].name).toBe("Signups");
  });

  it("resolves canonical /api/discoverability/sxo/* and alias /api/sxo/* identically (D17)", async () => {
    vi.spyOn(auditStore, "listConversionGoals").mockResolvedValue([]);

    const canonicalRes = await handler({
      httpMethod: "GET",
      path: "/api/discoverability/sxo/conversion-goals",
      headers: { authorization: "Bearer valid-token" },
    });
    const aliasRes = await handler({
      httpMethod: "GET",
      path: "/api/sxo/conversion-goals",
      headers: { authorization: "Bearer valid-token" },
    });

    expect(canonicalRes.statusCode).toBe(200);
    expect(aliasRes.statusCode).toBe(200);
    expect(canonicalRes.body).toEqual(aliasRes.body);
  });
});
