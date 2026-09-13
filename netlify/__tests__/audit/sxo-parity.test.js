// netlify/__tests__/audit/sxo-parity.test.js
//
// Stage 2 (P3A) Parity & Invariant Test Suite:
// Asserts migration 0068 constraints, route parity, D14/D15/D17 invariants,
// and API handler execution.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PAGE_TYPE_PACKS } from "../../../src/lib/discoverability/auditProfiles.js";
import { handler } from "../../functions/discoverability.js";
import * as auditStore from "../../functions/lib/audit/auditStore.js";
import * as serverClient from "../../functions/lib/supabaseServerClient.js";

const ROOT = process.cwd();
const RAW_SQL = readFileSync(join(ROOT, "supabase", "migrations", "0068_sxo_static_runs.sql"), "utf8");
const SQL = RAW_SQL.replace(/^\s*--.*$/gm, "");

describe("Migration 0068 Guarantees (§11.14 / Stage 2 parity)", () => {
  it("🔴 sxo_total_score is NULLABLE — unknown is never 0", () => {
    expect(SQL).toMatch(/sxo_total_score\s+numeric\(5,1\)\s+check/i);
    expect(SQL).not.toMatch(/sxo_total_score\s+numeric\(5,1\)\s+not\s+null/i);
  });

  it("🔴 coverage is NOT NULL — a score without coverage is a different measurement", () => {
    expect(SQL).toMatch(/coverage\s+numeric\(5,1\)\s+not\s+null/i);
  });

  it("⚠️ model_version has NO DEFAULT — forces explicit version stamping", () => {
    const m = SQL.match(/model_version\s+text\s+not\s+null([^,]*)/i);
    expect(m).toBeTruthy();
    expect(m[1]).not.toMatch(/default/i);
  });

  it("weight_set_id defaults to 'sxo_default_v1' (D15)", () => {
    expect(SQL).toMatch(/weight_set_id\s+text\s+not\s+null\s+default\s+'sxo_default_v1'/i);
  });

  it("is RLS-locked to service_role and revoked from anon and authenticated", () => {
    expect(SQL).toMatch(/alter table public\.audit_sxo_runs enable row level security/i);
    expect(SQL).toMatch(/revoke all on public\.audit_sxo_runs from anon, authenticated/i);
    expect(SQL).toMatch(/grant select, insert, update, delete on public\.audit_sxo_runs to service_role/i);
  });

  it("creates audit_intent_mappings and audit_page_templates tables with RLS", () => {
    expect(SQL).toMatch(/create table if not exists public\.audit_intent_mappings/i);
    expect(SQL).toMatch(/create table if not exists public\.audit_page_templates/i);
    expect(SQL).toMatch(/alter table public\.audit_intent_mappings enable row level security/i);
    expect(SQL).toMatch(/alter table public\.audit_page_templates enable row level security/i);
  });
});

describe("Page Type Templates 10–12 (§11.10)", () => {
  it("includes category_listing, case_study, and landing_page without renumbering", () => {
    expect(PAGE_TYPE_PACKS.category_listing).toBeDefined();
    expect(PAGE_TYPE_PACKS.case_study).toBeDefined();
    expect(PAGE_TYPE_PACKS.landing_page).toBeDefined();
    expect(PAGE_TYPE_PACKS.category_listing.label).toBe("Category / listing page");
    expect(PAGE_TYPE_PACKS.case_study.label).toBe("Case study");
    expect(PAGE_TYPE_PACKS.landing_page.label).toBe("Landing page");
  });
});

describe("SXO API Routes & Handler Execution", () => {
  const userId = "usr-sxo-test-123";

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(serverClient, "authenticateBearer").mockResolvedValue({
      ok: true,
      user: { id: userId, email: "sxo@datiq.test" },
    });
  });

  it("GET /api/discoverability/sxo/schema returns complete SXO metadata", async () => {
    const event = {
      httpMethod: "GET",
      path: "/api/discoverability/sxo/schema",
      headers: { authorization: "Bearer valid-token" },
    };

    const res = await handler(event);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.layers).toBeDefined();
    expect(body.layer_weights.td).toBe(0.20);
    expect(body.master_weights.sxo).toBe(0.35);
    expect(body.model_version).toBe("s1");
    expect(body.default_weight_set_id).toBe("sxo_default_v1");
  });

  it("GET /api/sxo/schema (alias route D17) reaches the SXO handler and returns 200", async () => {
    const event = {
      httpMethod: "GET",
      path: "/api/sxo/schema",
      headers: { authorization: "Bearer valid-token" },
    };

    const res = await handler(event);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.layers.td.code).toBe("TD");
  });

  it("POST /sxo/evaluate returns 400 when audit_id is missing", async () => {
    const event = {
      httpMethod: "POST",
      path: "/api/discoverability/sxo/evaluate",
      headers: { authorization: "Bearer valid-token" },
      body: JSON.stringify({}),
    };

    const res = await handler(event);
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toMatch(/audit_id/i);
  });

  it("POST /sxo/evaluate evaluates audit, computes master score, and persists run", async () => {
    const mockAudit = {
      audit: { id: "aud-123", subject_id: "subj-1", target_id: "tar-1" },
      result: {
        framework_scores: {
          seo: { score: 82 },
          aeo: { score: 78 },
          geo: { score: 74 },
        },
      },
      pillars: {
        technical_accessibility: { score: 85, coverage: 100 },
      },
      evidence: {
        heading_outline: [{ level: 1, text: "Best Web Scraping Tools" }],
        direct_answer_blocks: [{ text: "DatIQ is an AI enrichment platform." }],
      },
      facts: {
        content: { word_count: 500 },
        technical: { viewport_meta: true },
      },
    };

    vi.spyOn(auditStore, "getAuditFull").mockResolvedValue(mockAudit);
    vi.spyOn(auditStore, "saveSxoRun").mockResolvedValue({
      ok: true,
      run: { id: "sxo-run-456", sxo_total_score: 83.2, coverage: 95 },
    });

    const event = {
      httpMethod: "POST",
      path: "/api/discoverability/sxo/evaluate",
      headers: { authorization: "Bearer valid-token" },
      body: JSON.stringify({
        audit_id: "aud-123",
        intent_class: "informational",
        primary_outcome: "lead_capture",
      }),
    };

    const res = await handler(event);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.sxo.score).toBeGreaterThan(0);
    expect(body.sxo.layerScores.td).toBe(85); // TD agrees with T pillar
    expect(body.master.score).toBeGreaterThan(0);
    expect(body.run.id).toBe("sxo-run-456");
  });

  it("GET /sxo/composite/:id computes read-time master score", async () => {
    const mockAudit = {
      audit: { id: "aud-123" },
      result: {
        framework_scores: {
          seo: { score: 80 },
          aeo: { score: 80 },
          geo: { score: 80 },
        },
      },
    };

    vi.spyOn(auditStore, "getAuditFull").mockResolvedValue(mockAudit);
    vi.spyOn(auditStore, "getSxoForAudit").mockResolvedValue({
      id: "run-1",
      sxo_total_score: 80,
    });

    const event = {
      httpMethod: "GET",
      path: "/api/discoverability/sxo/composite/aud-123",
      headers: { authorization: "Bearer valid-token" },
    };

    const res = await handler(event);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.audit_id).toBe("aud-123");
    // All 4 frameworks are 80, so master is 80.0
    expect(body.master.score).toBe(80.0);
    expect(body.master.coverage).toBe(100);
  });
});
