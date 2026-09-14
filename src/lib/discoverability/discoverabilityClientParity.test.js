// discoverabilityClientParity.test.js
//
// Parity test: Asserts that discoverabilityClient.js exposes all endpoints matching
// the Netlify discoverability function router, and verifies that all P2 UI panels
// are imported by production code.

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { discoverability, describeAuditError } from "./discoverabilityClient.js";

const ROOT = process.cwd();

/** Every .js/.jsx under a directory, excluding tests. */
function sources(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.(js|jsx)$/.test(name) && !/\.test\.(js|jsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe("discoverabilityClient parity — API surface completeness", () => {
  const expectedMethods = [
    // Audits & Results
    "runAudit", "listAudits", "getAudit", "getResults", "rerun", "deleteAudit", "compare",
    // Evidence panels
    "headings", "schema", "answers", "entities", "technical",
    // Reports
    "reportMarkdown", "reportCsv", "reportJson", "summary", "emailReport",
    // Recommendations
    "recommendations", "accept", "dismiss", "markDone", "reopen", "assign",
    // Targets & Trends
    "listTargets", "history", "trends",
    // Benchmarks
    "createBenchmark", "listBenchmarks", "getBenchmark", "deleteBenchmark",
    // Prompt sets
    "createPromptSet", "listPromptSets", "getPromptSet", "deletePromptSet",
    // Webhooks
    "createWebhook", "listWebhooks", "deleteWebhook",
    // Schedules
    "listSchedules", "createSchedule", "updateSchedule", "deleteSchedule",
    "profiles",
    // Business Truth (W9)
    "truthFields", "listTruthRecords", "createTruthRecord", "getTruthRecord", "archiveTruthRecord",
    "proposeTruthVersion", "getTruthVersion", "submitTruthVersion", "withdrawTruthVersion",
    "rejectTruthVersion", "promoteTruthVersion", "truthDiff", "truthConflicts", "resolveTruthConflict",
    // Entity Graph (W10)
    "graphSchema", "getGraph", "proposeEntity", "rejectEntity",
    "proposeRelationship", "approveRelationship", "rejectRelationship",
    "graphConflicts", "resolveGraphConflict",
    // Subject Scores (W11 / CP-1.1)
    "subjectScoreSchema", "listSubjects", "getSubject", "createEntitySubject",
    "listSubjectScores", "getSubjectScore", "scoreSubject",
    // Local Directory (W12)
    "localDirectorySchema", "listDirectoryListings", "upsertDirectoryListing", "deleteDirectoryListing",
    "runLocalCheck", "listLocalChecks", "getLocalCheck", "resolveLocalFinding",
    // Schema Trust (W13)
    "schemaRegistry", "listSchemaEntities", "saveSchemaEntity", "deleteSchemaEntity",
    "listTrustObservations", "saveTrustObservation",
    // Connectors dispatch (CP-1.2)
    "claimConnectorDispatch",
    // Search Experience Optimization (SXO) (P3A / Stage 2)
    "sxoSchema", "evaluateSxo", "listSxoRuns", "getSxoRun", "getSxoComposite",
    // Analytics, Funnels, Forms & Goals (P3B / Stage 3)
    "sxoJourney", "sxoFormDiagnostics", "importSxoEvents",
    "connectSxoIntegration", "listSxoIntegrations", "disconnectSxoIntegration",
    "purgeSxoAnalyticsData",
    "saveSxoConversionGoal", "listSxoConversionGoals",
    // Portfolio Rollups, Personas & Experiments (P3C / Stage 4)
    "createSxoExperiment", "listSxoExperiments", "getSxoExperiment", "evaluateSxoExperiment",
    "getSxoPortfolioRollups", "saveSxoPortfolioRollup", "validateSxoRecommendation",
  ];

  it("exposes all expected client methods as functions", () => {
    for (const method of expectedMethods) {
      expect(typeof discoverability[method], `Missing client method: ${method}`).toBe("function");
    }
  });

  it("describes all standard audit errors into user actionable format", () => {
    expect(describeAuditError({ code: "AUTH_REQUIRED" }).action).toBe("signin");
    expect(describeAuditError({ code: "robots_disallowed", overridable: true }).action).toBe("attest");
    expect(describeAuditError({ code: "QUOTA_EXCEEDED", upgradeTo: "growth" }).action).toBe("upgrade");
    expect(describeAuditError({ code: "STORAGE_UNAVAILABLE" }).action).toBe("retry");
  });
});

describe("discoverabilityClient workspace propagation", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
  });

  afterEach(() => vi.restoreAllMocks());

  it("scopes record-specific Business Truth reads with the active workspace", async () => {
    await discoverability.truthDiff("record-1", { workspaceId: "workspace-1" });
    expect(globalThis.fetch.mock.calls[0][0]).toBe(
      "/api/discoverability/business-truth/record-1/diff?workspace_id=workspace-1",
    );
  });

  it("scopes Business Truth governance writes with the active workspace", async () => {
    await discoverability.promoteTruthVersion(
      "record-1", "version-2", "Reviewed", { workspaceId: "workspace-1" },
    );
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toEqual({
      note: "Reviewed",
      workspace_id: "workspace-1",
    });
  });

  it("scopes Entity Graph relationship writes with the active workspace", async () => {
    await discoverability.proposeRelationship({
      subjectId: "entity-a",
      predicate: "owns",
      objectId: "entity-b",
      workspaceId: "workspace-1",
    });
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toMatchObject({
      subject_id: "entity-a",
      object_id: "entity-b",
      workspace_id: "workspace-1",
    });
  });

  it("scopes the complete audit report, comparison, and trend read path", async () => {
    await discoverability.getResults("audit-1", { workspaceId: "workspace-1" });
    await discoverability.compare("audit-1", "audit-0", { workspaceId: "workspace-1" });
    await discoverability.trends("target-1", 30, { workspaceId: "workspace-1" });
    expect(globalThis.fetch.mock.calls.map((call) => call[0])).toEqual([
      "/api/discoverability/audits/audit-1/results?workspace_id=workspace-1",
      "/api/discoverability/audits/audit-1/compare/audit-0?workspace_id=workspace-1",
      "/api/discoverability/targets/target-1/trends?limit=30&workspace_id=workspace-1",
    ]);
  });

  it("scopes report exports, summary generation, and workflow changes", async () => {
    await discoverability.reportMarkdown("audit-1", { constructs: true, workspaceId: "workspace-1" });
    await discoverability.summary("audit-1", { workspaceId: "workspace-1" });
    await discoverability.dismiss("rec-1", "Not relevant", { workspaceId: "workspace-1" });
    expect(globalThis.fetch.mock.calls[0][0]).toBe(
      "/api/discoverability/audits/audit-1/report?format=markdown&constructs=1&workspace_id=workspace-1",
    );
    expect(JSON.parse(globalThis.fetch.mock.calls[1][1].body)).toEqual({ workspace_id: "workspace-1" });
    expect(JSON.parse(globalThis.fetch.mock.calls[2][1].body)).toEqual({
      reason: "Not relevant", workspace_id: "workspace-1",
    });
  });
});

describe("P2 Panels — non-test importer wiring", () => {
  const p2Panels = [
    "BusinessTruthPanel.jsx",
    "EntityGraphPanel.jsx",
    "LocalDirectoryPanel.jsx",
    "SchemaTrustPanel.jsx",
    "SubjectScoresPanel.jsx",
  ];

  for (const panel of p2Panels) {
    it(`ensures ${panel} is imported by production code (e.g. Discoverability.jsx)`, () => {
      const allSources = sources(join(ROOT, "src"));
      const importers = allSources.filter((file) => {
        if (file.endsWith(panel)) return false;
        const content = readFileSync(file, "utf8");
        return content.includes(panel.replace(".jsx", ""));
      });

      expect(importers.length, `${panel} has no production importers`).toBeGreaterThan(0);
    });

    it(`uses the Toast context contract correctly in ${panel}`, () => {
      const content = readFileSync(join(ROOT, "src/components/discoverability", panel), "utf8");
      expect(content).not.toContain("const { showToast } = useToast()");
      expect(content).toContain("const showToast = useToast()");
    });
  }
});
