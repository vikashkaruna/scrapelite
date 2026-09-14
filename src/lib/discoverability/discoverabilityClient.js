// discoverabilityClient.js — the browser's side of /api/discoverability/*.
//
// Kept separate from apiClient.js for one concrete reason: the report endpoints
// return markdown and CSV, and apiClient's `request()` always calls
// res.json(). It shares apiClient's auth token via getAuthToken(), so there is
// still exactly one place the session lives.
//
// ── ERRORS CARRY THEIR CODE ────────────────────────────────────────────────
// Every rejection carries `status`, `code` and the compliance/quota fields the
// server sent. Callers branch on the CODE, never on the prose. Matching prose
// is precisely how a deliberate robots.txt refusal once reached the error
// classifier as an unrecognised string and was reported to the user as
// "Something went wrong. An unexpected error occurred." with a stack trace.

import { getAuthToken } from "../apiClient.js";

const BASE = "/api/discoverability";

function authHeaders(extra = {}) {
  const h = { ...extra };
  const token = getAuthToken();
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function throwFromResponse(res, method, path) {
  let data = {};
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try { data = await res.json(); } catch { /* not JSON after all */ }
  }
  const e = new Error(data.error || `Discoverability ${method} ${path} failed (${res.status})`);
  e.status = res.status;
  if (data.code) e.code = data.code;
  if (data.host) e.host = data.host;
  if (data._complianceBlocked) e.complianceBlocked = true;
  // `overridable` distinguishes a robots.txt refusal — which a signed-in owner
  // may attest past — from the operator's host allowlist, which they may not.
  if (data.overridable !== undefined) e.overridable = data.overridable;
  // A duplicate relationship answers 409 and says whether the sighting was
  // recorded; the panel must not claim corroboration that did not happen.
  if (data.corroborated !== undefined) e.corroborated = data.corroborated;
  if (data.upgradeTo) e.upgradeTo = data.upgradeTo;
  if (data.remaining !== undefined) e.remaining = data.remaining;
  if (data.capability) e.capability = data.capability;
  if (data.lifecycle) e.lifecycle = true;
  throw e;
}

async function req(path, method = "GET", body) {
  const opts = {
    method,
    headers: authHeaders(body !== undefined ? { "Content-Type": "application/json" } : {}),
    credentials: "same-origin",
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  if (!res.ok) await throwFromResponse(res, method, path);
  return res.json();
}

/** For the report endpoints, which return markdown or CSV rather than JSON. */
async function reqText(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: authHeaders(),
    credentials: "same-origin",
  });
  if (!res.ok) await throwFromResponse(res, "GET", path);
  return res.text();
}

function withQuery(path, params = {}) {
  const q = new URLSearchParams(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ""),
  );
  return `${path}${q.toString() ? `?${q}` : ""}`;
}

function withWorkspace(body, workspaceId) {
  return workspaceId ? { ...body, workspace_id: workspaceId } : body;
}

export const discoverability = {
  // ── Audits ───────────────────────────────────────────────────────────────
  /**
   * Run an audit.
   *
   * `idempotency_key` is worth passing from any UI that can double-submit: the
   * server returns the ORIGINAL audit rather than spending a second credit, so
   * a double-clicked button costs one audit instead of two.
   */
  runAudit: (payload) => req("/audits", "POST", payload),

  listAudits: (params = {}) => {
    const q = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""),
    );
    return req(`/audits${q.toString() ? `?${q}` : ""}`);
  },

  getAudit: (id, { workspaceId = null } = {}) =>
    req(withQuery(`/audits/${encodeURIComponent(id)}`, { workspace_id: workspaceId })),
  getResults: (id, { workspaceId = null } = {}) =>
    req(withQuery(`/audits/${encodeURIComponent(id)}/results`, { workspace_id: workspaceId })),
  rerun: (id, payload = {}, { workspaceId = null } = {}) =>
    req(`/audits/${encodeURIComponent(id)}/rerun`, "POST", withWorkspace(payload, workspaceId)),
  deleteAudit: (id, { workspaceId = null } = {}) =>
    req(withQuery(`/audits/${encodeURIComponent(id)}`, { workspace_id: workspaceId }), "DELETE"),
  compare: (id, baselineId, { workspaceId = null } = {}) =>
    req(withQuery(`/audits/${encodeURIComponent(id)}/compare/${encodeURIComponent(baselineId)}`,
      { workspace_id: workspaceId })),

  // ── Evidence panels ──────────────────────────────────────────────────────
  headings: (id, { workspaceId = null } = {}) =>
    req(withQuery(`/audits/${encodeURIComponent(id)}/headings`, { workspace_id: workspaceId })),
  schema: (id, { workspaceId = null } = {}) =>
    req(withQuery(`/audits/${encodeURIComponent(id)}/schema`, { workspace_id: workspaceId })),
  answers: (id, { workspaceId = null } = {}) =>
    req(withQuery(`/audits/${encodeURIComponent(id)}/answers`, { workspace_id: workspaceId })),
  entities: (id, { workspaceId = null } = {}) =>
    req(withQuery(`/audits/${encodeURIComponent(id)}/entities`, { workspace_id: workspaceId })),
  technical: (id, { workspaceId = null } = {}) =>
    req(withQuery(`/audits/${encodeURIComponent(id)}/technical`, { workspace_id: workspaceId })),

  // ── Reports ──────────────────────────────────────────────────────────────
  reportMarkdown: (id, { constructs = false, workspaceId = null } = {}) =>
    reqText(withQuery(`/audits/${encodeURIComponent(id)}/report`, {
      format: "markdown", constructs: constructs ? "1" : null, workspace_id: workspaceId,
    })),
  /** rows: "all" | "scores" | "signals" | "issues" | "recommendations". */
  reportCsv: (id, rows = "all", { workspaceId = null } = {}) =>
    reqText(withQuery(`/audits/${encodeURIComponent(id)}/report`, {
      format: "csv", rows, workspace_id: workspaceId,
    })),
  reportJson: (id, { workspaceId = null } = {}) =>
    req(withQuery(`/audits/${encodeURIComponent(id)}/report`, {
      format: "json", workspace_id: workspaceId,
    })),

  /**
   * The audit's executive summary. Generated on first call and cached, so this
   * is safe to call on every report view — a second caller gets the stored one.
   * Resolves with `summary: null` when the model is unavailable; the header
   * degrades to the deterministic facts rather than showing an error.
   */
  summary: (id, { workspaceId = null } = {}) =>
    req(`/audits/${encodeURIComponent(id)}/summary`, "POST", withWorkspace({}, workspaceId)),

  // ── Recommendations ──────────────────────────────────────────────────────
  recommendations: (id, { workspaceId = null } = {}) =>
    req(withQuery(`/audits/${encodeURIComponent(id)}/recommendations`, { workspace_id: workspaceId })),
  accept: (recId, { workspaceId = null } = {}) =>
    req(`/recommendations/${encodeURIComponent(recId)}/accept`, "POST", withWorkspace({}, workspaceId)),
  /** A reason is REQUIRED; the server refuses a dismissal without one. */
  dismiss: (recId, reason, { workspaceId = null } = {}) =>
    req(`/recommendations/${encodeURIComponent(recId)}/dismiss`, "POST", withWorkspace({ reason }, workspaceId)),
  markDone: (recId, { workspaceId = null } = {}) =>
    req(`/recommendations/${encodeURIComponent(recId)}/done`, "POST", withWorkspace({}, workspaceId)),
  reopen: (recId, { workspaceId = null } = {}) =>
    req(`/recommendations/${encodeURIComponent(recId)}/reopen`, "POST", withWorkspace({}, workspaceId)),
  /**
   * Hand a recommendation to someone, or put it down with `null`.
   *
   * The server checks that the assignee shares a workspace with you; there is
   * deliberately no client-side membership list to bypass.
   */
  assign: (recId, assignee, { workspaceId = null } = {}) =>
    req(`/recommendations/${encodeURIComponent(recId)}/assign`, "POST",
      withWorkspace({ assignee: assignee ?? null }, workspaceId)),

  // ── Targets and trends ───────────────────────────────────────────────────
  listTargets: ({ workspaceId = null } = {}) =>
    req(withQuery("/targets", { workspace_id: workspaceId })),
  history: (targetId, { workspaceId = null } = {}) =>
    req(withQuery(`/targets/${encodeURIComponent(targetId)}/history`, { workspace_id: workspaceId })),
  trends: (targetId, limit = 30, { workspaceId = null } = {}) =>
    req(withQuery(`/targets/${encodeURIComponent(targetId)}/trends`, {
      limit, workspace_id: workspaceId,
    })),

  // ── Benchmarks ───────────────────────────────────────────────────────────
  createBenchmark: (payload) => req("/benchmarks", "POST", payload),
  listBenchmarks: () => req("/benchmarks"),
  getBenchmark: (id) => req(`/benchmarks/${encodeURIComponent(id)}`),
  deleteBenchmark: (id) => req(`/benchmarks/${encodeURIComponent(id)}`, "DELETE"),

  // ── Prompt sets ──────────────────────────────────────────────────────────
  createPromptSet: (payload) => req("/prompts/samples", "POST", payload),
  listPromptSets: () => req("/prompts/samples"),
  getPromptSet: (id) => req(`/prompts/samples/${encodeURIComponent(id)}`),
  deletePromptSet: (id) => req(`/prompts/samples/${encodeURIComponent(id)}`, "DELETE"),

  // ── Webhooks ─────────────────────────────────────────────────────────────
  /** The signing secret comes back HERE and nowhere else, ever. */
  createWebhook: (payload) => req("/webhooks", "POST", payload),
  listWebhooks: () => req("/webhooks"),
  deleteWebhook: (id) => req(`/webhooks/${encodeURIComponent(id)}`, "DELETE"),

  // ── Scheduled monitoring ─────────────────────────────────────────────────
  listSchedules: () => req("/schedules"),
  createSchedule: (payload) => req("/schedules", "POST", payload),
  updateSchedule: (id, payload) => req(`/schedules/${encodeURIComponent(id)}`, "PATCH", payload),
  deleteSchedule: (id) => req(`/schedules/${encodeURIComponent(id)}`, "DELETE"),

  profiles: () => req("/profiles"),

  /**
   * Email this audit report to yourself, with the file actually attached —
   * see netlify/functions/report-email.js. Not under BASE ("/api/discoverability")
   * since it's shared with extraction/batch reports; the recipient is always
   * the signed-in account's own email, resolved server-side, never something
   * this call can specify.
   */
  emailReport: (auditId, { format = "pdf", brandKit = null, workspaceId = null } = {}) =>
    emailReport({ kind: "discoverability", auditId, format, brandKit,
      ...(workspaceId ? { workspace_id: workspaceId } : {}) }),

  // ── Canonical Business Truth Record (W9) ─────────────────────────────────
  //
  // ⚠️ THERE IS NO `approveVersion` HERE, AND THERE MUST NOT BE.
  // Promotion is the only way a fact becomes canonical, because it is the only
  // path carrying the interlocks — a reviewer who is not the proposer, the two
  // identifying facts, and the three writes that must not separate. A second
  // client method that reached `approved` any other way would be the one that
  // forgets.
  truthFields: () => req("/business-truth/fields"),
  listTruthRecords: (params = {}) => {
    const q = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""),
    );
    return req(`/business-truth${q.toString() ? `?${q}` : ""}`);
  },
  createTruthRecord: (payload) => req("/business-truth", "POST", payload),
  getTruthRecord: (id, { workspaceId = null } = {}) =>
    req(withQuery(`/business-truth/${encodeURIComponent(id)}`, { workspace_id: workspaceId })),
  archiveTruthRecord: (id, { workspaceId = null } = {}) =>
    req(withQuery(`/business-truth/${encodeURIComponent(id)}`, { workspace_id: workspaceId }), "DELETE"),

  /**
   * Propose a version.
   *
   * `source` may only be `declared` or `inferred`. The server refuses
   * `observed` and `imported` from a client: those carry a warranty that
   * somebody could go and check, and this path has no evidence to attach.
   */
  proposeTruthVersion: (recordId, {
    fields, source = "declared", statedBy = null, workspaceId = null, workspace_id = null,
  }) =>
    req(`/business-truth/${encodeURIComponent(recordId)}/versions`, "POST",
      withWorkspace({ fields, source, stated_by: statedBy }, workspaceId || workspace_id)),

  getTruthVersion: (recordId, versionId, { workspaceId = null } = {}) =>
    req(withQuery(`/business-truth/${encodeURIComponent(recordId)}/versions/${encodeURIComponent(versionId)}`,
      { workspace_id: workspaceId })),

  submitTruthVersion: (recordId, versionId, { workspaceId = null } = {}) =>
    req(`/business-truth/${encodeURIComponent(recordId)}/versions/${encodeURIComponent(versionId)}/submit`, "POST",
      withWorkspace({}, workspaceId)),
  withdrawTruthVersion: (recordId, versionId, { workspaceId = null } = {}) =>
    req(`/business-truth/${encodeURIComponent(recordId)}/versions/${encodeURIComponent(versionId)}/withdraw`, "POST",
      withWorkspace({}, workspaceId)),
  /** `note` is REQUIRED — the server refuses a rejection without a reason. */
  rejectTruthVersion: (recordId, versionId, note, { workspaceId = null } = {}) =>
    req(`/business-truth/${encodeURIComponent(recordId)}/versions/${encodeURIComponent(versionId)}/reject`, "POST",
      withWorkspace({ note }, workspaceId)),
  promoteTruthVersion: (recordId, versionId, note = null, { workspaceId = null } = {}) =>
    req(`/business-truth/${encodeURIComponent(recordId)}/versions/${encodeURIComponent(versionId)}/promote`, "POST",
      withWorkspace({ note }, workspaceId)),

  truthDiff: (recordId, { from = null, to = null, workspaceId = null, workspace_id = null } = {}) => {
    const q = new URLSearchParams(
      Object.entries({ from, to, workspace_id: workspaceId || workspace_id }).filter(([, v]) => v),
    );
    return req(`/business-truth/${encodeURIComponent(recordId)}/diff${q.toString() ? `?${q}` : ""}`);
  },

  truthConflicts: (recordId, { workspaceId = null } = {}) =>
    req(withQuery(`/business-truth/${encodeURIComponent(recordId)}/conflicts`, { workspace_id: workspaceId })),
  /** resolution: "record_updated" | "page_updated" | "not_a_conflict". */
  resolveTruthConflict: (recordId, conflictId, resolution, { workspaceId = null } = {}) =>
    req(`/business-truth/${encodeURIComponent(recordId)}/conflicts/${encodeURIComponent(conflictId)}`,
      "POST", withWorkspace({ resolution }, workspaceId)),

  // ── Entity graph (W10) ───────────────────────────────────────────────────
  //
  // ⚠️ THERE IS NO METHOD THAT CREATES AN APPROVED ROW, and no PATCH that
  // reaches `approved`. `approveRelationship` is the only way in, because
  // approving an edge also approves its endpoints — an approved edge between
  // two unreviewed nodes is a half-built statement, and a second path would be
  // the one that forgets.
  graphSchema: () => req("/entity-graph/schema"),
  getGraph: (params = {}) => {
    const q = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""),
    );
    return req(`/entity-graph${q.toString() ? `?${q}` : ""}`);
  },

  /** `source` may only be `declared` or `inferred`; the server writes observed. */
  proposeEntity: (payload) => req("/entity-graph/entities", "POST", payload),
  /** `reason` is REQUIRED — the server refuses a rejection without one. */
  rejectEntity: (id, reason, { workspaceId = null } = {}) =>
    req(`/entity-graph/entities/${encodeURIComponent(id)}/reject`, "POST", withWorkspace({ reason }, workspaceId)),

  proposeRelationship: ({
    subjectId, predicate, objectId, source = "declared", note = null, workspaceId = null,
  }) =>
    req("/entity-graph/relationships", "POST",
      withWorkspace({ subject_id: subjectId, predicate, object_id: objectId, source, note }, workspaceId)),
  approveRelationship: (id, { note = null, truthRecordId = null, workspaceId = null } = {}) =>
    req(`/entity-graph/relationships/${encodeURIComponent(id)}/approve`, "POST",
      withWorkspace({ note, truth_record_id: truthRecordId }, workspaceId)),
  rejectRelationship: (id, reason, { workspaceId = null } = {}) =>
    req(`/entity-graph/relationships/${encodeURIComponent(id)}/reject`, "POST",
      withWorkspace({ reason }, workspaceId)),

  graphConflicts: (params = {}) => {
    const q = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""),
    );
    return req(`/entity-graph/conflicts${q.toString() ? `?${q}` : ""}`);
  },
  /** resolution: "relationship_removed" | "relationship_corrected" | "entity_merged" | "not_a_conflict". */
  resolveGraphConflict: (conflictId, resolution, { workspaceId = null } = {}) =>
    req(`/entity-graph/conflicts/${encodeURIComponent(conflictId)}/resolve`, "POST",
      withWorkspace({ resolution }, workspaceId)),

  // ── Subject scores (W11 / CP-1.1) ─────────────────────────────────────────
  subjectScoreSchema: () => req("/subject-score/schema"),
  listSubjects: (params = {}) => {
    const q = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""),
    );
    return req(`/subject-score/subjects${q.toString() ? `?${q}` : ""}`);
  },
  getSubject: (id, { workspaceId = null } = {}) =>
    req(withQuery(`/subject-score/subjects/${encodeURIComponent(id)}`, { workspace_id: workspaceId })),
  createEntitySubject: ({ subjectKind, entityId, workspaceId = null }) =>
    req("/subject-score/subjects", "POST", {
      subject_kind: subjectKind,
      entity_id: entityId,
      ...(workspaceId ? { workspace_id: workspaceId } : {}),
    }),
  listSubjectScores: (params = {}) => {
    const q = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""),
    );
    return req(`/subject-score/scores${q.toString() ? `?${q}` : ""}`);
  },
  getSubjectScore: (id, { workspaceId = null } = {}) =>
    req(withQuery(`/subject-score/scores/${encodeURIComponent(id)}`, { workspace_id: workspaceId })),
  scoreSubject: (payload) => req("/subject-score/scores", "POST", payload),

  // ── Local and directory intelligence (W12) ────────────────────────────────
  localDirectorySchema: () => req("/local-directory/schema"),
  listDirectoryListings: (params = {}) => {
    const q = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""),
    );
    return req(`/local-directory/listings${q.toString() ? `?${q}` : ""}`);
  },
  upsertDirectoryListing: (payload) => req("/local-directory/listings", "POST", payload),
  deleteDirectoryListing: (id, payload = {}) =>
    req(`/local-directory/listings/${encodeURIComponent(id)}`, "DELETE", payload),
  runLocalCheck: (payload) => req("/local-directory/check", "POST", payload),
  listLocalChecks: (params = {}) => {
    const q = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""),
    );
    return req(`/local-directory/checks${q.toString() ? `?${q}` : ""}`);
  },
  getLocalCheck: (id, params = {}) => {
    const q = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""),
    );
    return req(`/local-directory/checks/${encodeURIComponent(id)}${q.toString() ? `?${q}` : ""}`);
  },
  resolveLocalFinding: (id, resolution, payload = {}) =>
    req(`/local-directory/findings/${encodeURIComponent(id)}/resolve`, "POST", { resolution, ...payload }),

  // ── Schema intelligence & Trust proof (W13) ──────────────────────────────
  schemaRegistry: () => req("/schema-trust/schema-registry"),
  listSchemaEntities: (params = {}) => {
    const q = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""),
    );
    return req(`/schema-trust/schema${q.toString() ? `?${q}` : ""}`);
  },
  saveSchemaEntity: (payload) => req("/schema-trust/schema", "POST", payload),
  deleteSchemaEntity: (id, payload = {}) =>
    req(`/schema-trust/schema/${encodeURIComponent(id)}`, "DELETE", payload),
  listTrustObservations: (params = {}) => {
    const q = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""),
    );
    return req(`/schema-trust/trust${q.toString() ? `?${q}` : ""}`);
  },
  saveTrustObservation: (payload) => req("/schema-trust/trust", "POST", payload),

  // ── Connector dispatches (CP-1.2) ─────────────────────────────────────────
  claimConnectorDispatch: (payload) => req("/connectors/dispatch", "POST", payload),

  // ── Search Experience Optimization (SXO) (P3A / Stage 2) ────────────────
  sxoSchema: () => req("/sxo/schema"),
  evaluateSxo: (payload) => req("/sxo/evaluate", "POST", payload),
  listSxoRuns: (params = {}) => {
    const q = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""),
    );
    return req(`/sxo/runs${q.toString() ? `?${q}` : ""}`);
  },
  getSxoRun: (id, params = {}) => {
    const q = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""),
    );
    return req(`/sxo/runs/${encodeURIComponent(id)}${q.toString() ? `?${q}` : ""}`);
  },
  getSxoComposite: (auditId, { workspaceId = null } = {}) =>
    req(withQuery(`/sxo/composite/${encodeURIComponent(auditId)}`, { workspace_id: workspaceId })),

  // ── Analytics, Funnels, Forms & Goals (Stage 3 / P3B) ───────────────────
  sxoJourney: (auditId, params = {}) => {
    const q = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""),
    );
    return req(`/sxo/audits/${encodeURIComponent(auditId)}/journey${q.toString() ? `?${q}` : ""}`);
  },
  sxoFormDiagnostics: (auditId, params = {}) => {
    const q = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""),
    );
    return req(`/sxo/audits/${encodeURIComponent(auditId)}/form-diagnostics${q.toString() ? `?${q}` : ""}`);
  },
  importSxoEvents: (payload) => req("/sxo/events/import", "POST", payload),
  connectSxoIntegration: (provider, payload) =>
    req(`/sxo/integrations/${encodeURIComponent(provider)}/connect`, "POST", payload),
  listSxoIntegrations: (params = {}) => {
    const q = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""),
    );
    return req(`/sxo/integrations${q.toString() ? `?${q}` : ""}`);
  },
  disconnectSxoIntegration: (provider, params = {}) => {
    const q = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""),
    );
    return req(`/sxo/integrations/${encodeURIComponent(provider)}${q.toString() ? `?${q}` : ""}`, "DELETE");
  },
  purgeSxoAnalyticsData: (payload = {}) => req("/sxo/analytics/purge", "POST", payload),
  saveSxoConversionGoal: (payload) => req("/sxo/conversion-goals", "POST", payload),
  listSxoConversionGoals: (params = {}) => {
    const q = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""),
    );
    return req(`/sxo/conversion-goals${q.toString() ? `?${q}` : ""}`);
  },

  // ── Portfolio Rollups, Personas & Experiments (P3C / Stage 4) ─────────────
  createSxoExperiment: (payload) => req("/sxo/experiments", "POST", payload),
  listSxoExperiments: (params = {}) => {
    const q = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""),
    );
    return req(`/sxo/experiments${q.toString() ? `?${q}` : ""}`);
  },
  getSxoExperiment: (id, params = {}) => {
    const q = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""),
    );
    return req(`/sxo/experiments/${encodeURIComponent(id)}${q.toString() ? `?${q}` : ""}`);
  },
  evaluateSxoExperiment: (id, payload) =>
    req(`/sxo/experiments/${encodeURIComponent(id)}/evaluate`, "POST", payload),
  getSxoPortfolioRollups: (params = {}) => {
    const q = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""),
    );
    return req(`/sxo/portfolio/rollups${q.toString() ? `?${q}` : ""}`);
  },
  saveSxoPortfolioRollup: (payload) => req("/sxo/portfolio/rollups", "POST", payload),
  validateSxoRecommendation: (id, payload = {}) =>
    req(`/sxo/recommendations/${encodeURIComponent(id)}/validate`, "POST", payload),
};

async function emailReport(payload) {
  const res = await fetch("/api/report-email", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    credentials: "same-origin",
    body: JSON.stringify(payload),
  });
  if (!res.ok) await throwFromResponse(res, "POST", "/report-email");
  return res.json();
}

/**
 * Turn a rejection into copy a person can act on.
 *
 * Branches on `code`, never on the message. Returns `{ title, body, action }`
 * where `action` names what the UI should offer — and crucially, a compliance
 * refusal offers an ATTESTATION rather than a "Try again" button, because
 * retrying a robots.txt decision changes nothing and offering it is how a
 * deliberate refusal came to look like a transient crash.
 */
export function describeAuditError(err) {
  const code = err?.code;

  if (code === "AUTH_REQUIRED") {
    return { title: "Sign in to run audits", body: "An audit's value is its history — the baseline, the trend, the proof your fix worked. That needs an account to hang off.", action: "signin" };
  }
  if (err?.complianceBlocked || code === "robots_disallowed") {
    return {
      title: "This site asks automated tools not to read this page",
      body: `${err.host || "The site"}'s robots.txt disallows it, and DatIQ honours that by default. If you own this site or have the owner's permission, you can record that and re-run.`,
      // NOT "retry": the decision cannot change on a retry.
      action: err.overridable === false ? "none" : "attest",
      host: err.host,
    };
  }
  if (code === "host_not_permitted") {
    return { title: "This host is not permitted", body: "Your operator's allowlist excludes this host. That is their decision, not the site's, so it cannot be overridden here.", action: "none" };
  }
  if (code === "QUOTA_EXCEEDED") {
    return { title: "You've used this month's audits", body: err.message, action: "upgrade", upgradeTo: err.upgradeTo };
  }
  if (code === "PLAN_REQUIRED") {
    return { title: "Not included in your plan", body: err.message, action: "upgrade", upgradeTo: err.upgradeTo };
  }
  if (err?.lifecycle) {
    return { title: "Your subscription needs attention", body: err.message, action: "renew" };
  }
  if (code === "INVALID_URL") {
    return { title: "That isn't a public web address", body: "Audits only run against pages a crawler could reach. Private, local and non-HTTP addresses are refused.", action: "edit" };
  }
  if (code === "STORAGE_UNAVAILABLE") {
    return { title: "Audit storage is unavailable", body: "Nothing was charged. Try again in a moment.", action: "retry" };
  }
  if (code === "AUDIT_FAILED") {
    return { title: "The audit couldn't finish", body: "The page could not be analysed. This is usually temporary.", action: "retry" };
  }
  return { title: "Something went wrong", body: err?.message || "The audit could not be started.", action: "retry" };
}
