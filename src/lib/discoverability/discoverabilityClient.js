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

  getAudit: (id) => req(`/audits/${encodeURIComponent(id)}`),
  getResults: (id) => req(`/audits/${encodeURIComponent(id)}/results`),
  rerun: (id, payload = {}) => req(`/audits/${encodeURIComponent(id)}/rerun`, "POST", payload),
  deleteAudit: (id) => req(`/audits/${encodeURIComponent(id)}`, "DELETE"),
  compare: (id, baselineId) =>
    req(`/audits/${encodeURIComponent(id)}/compare/${encodeURIComponent(baselineId)}`),

  // ── Evidence panels ──────────────────────────────────────────────────────
  headings: (id) => req(`/audits/${encodeURIComponent(id)}/headings`),
  schema: (id) => req(`/audits/${encodeURIComponent(id)}/schema`),
  answers: (id) => req(`/audits/${encodeURIComponent(id)}/answers`),
  entities: (id) => req(`/audits/${encodeURIComponent(id)}/entities`),
  technical: (id) => req(`/audits/${encodeURIComponent(id)}/technical`),

  // ── Reports ──────────────────────────────────────────────────────────────
  reportMarkdown: (id, { constructs = false } = {}) =>
    reqText(`/audits/${encodeURIComponent(id)}/report?format=markdown${constructs ? "&constructs=1" : ""}`),
  /** rows: "all" | "scores" | "signals" | "issues" | "recommendations". */
  reportCsv: (id, rows = "all") =>
    reqText(`/audits/${encodeURIComponent(id)}/report?format=csv&rows=${encodeURIComponent(rows)}`),
  reportJson: (id) => req(`/audits/${encodeURIComponent(id)}/report?format=json`),

  /**
   * The audit's executive summary. Generated on first call and cached, so this
   * is safe to call on every report view — a second caller gets the stored one.
   * Resolves with `summary: null` when the model is unavailable; the header
   * degrades to the deterministic facts rather than showing an error.
   */
  summary: (id) => req(`/audits/${encodeURIComponent(id)}/summary`, "POST", {}),

  // ── Recommendations ──────────────────────────────────────────────────────
  recommendations: (id) => req(`/audits/${encodeURIComponent(id)}/recommendations`),
  accept: (recId) => req(`/recommendations/${encodeURIComponent(recId)}/accept`, "POST", {}),
  /** A reason is REQUIRED; the server refuses a dismissal without one. */
  dismiss: (recId, reason) => req(`/recommendations/${encodeURIComponent(recId)}/dismiss`, "POST", { reason }),
  markDone: (recId) => req(`/recommendations/${encodeURIComponent(recId)}/done`, "POST", {}),
  reopen: (recId) => req(`/recommendations/${encodeURIComponent(recId)}/reopen`, "POST", {}),
  /**
   * Hand a recommendation to someone, or put it down with `null`.
   *
   * The server checks that the assignee shares a workspace with you; there is
   * deliberately no client-side membership list to bypass.
   */
  assign: (recId, assignee) =>
    req(`/recommendations/${encodeURIComponent(recId)}/assign`, "POST", { assignee: assignee ?? null }),

  // ── Targets and trends ───────────────────────────────────────────────────
  listTargets: () => req("/targets"),
  history: (targetId) => req(`/targets/${encodeURIComponent(targetId)}/history`),
  trends: (targetId, limit = 30) => req(`/targets/${encodeURIComponent(targetId)}/trends?limit=${limit}`),

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
  emailReport: (auditId, { format = "pdf", brandKit = null } = {}) =>
    emailReport({ kind: "discoverability", auditId, format, brandKit }),

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
  getTruthRecord: (id) => req(`/business-truth/${encodeURIComponent(id)}`),
  archiveTruthRecord: (id) => req(`/business-truth/${encodeURIComponent(id)}`, "DELETE"),

  /**
   * Propose a version.
   *
   * `source` may only be `declared` or `inferred`. The server refuses
   * `observed` and `imported` from a client: those carry a warranty that
   * somebody could go and check, and this path has no evidence to attach.
   */
  proposeTruthVersion: (recordId, { fields, source = "declared", statedBy = null }) =>
    req(`/business-truth/${encodeURIComponent(recordId)}/versions`, "POST",
      { fields, source, stated_by: statedBy }),

  getTruthVersion: (recordId, versionId) =>
    req(`/business-truth/${encodeURIComponent(recordId)}/versions/${encodeURIComponent(versionId)}`),

  submitTruthVersion: (recordId, versionId) =>
    req(`/business-truth/${encodeURIComponent(recordId)}/versions/${encodeURIComponent(versionId)}/submit`, "POST"),
  withdrawTruthVersion: (recordId, versionId) =>
    req(`/business-truth/${encodeURIComponent(recordId)}/versions/${encodeURIComponent(versionId)}/withdraw`, "POST"),
  /** `note` is REQUIRED — the server refuses a rejection without a reason. */
  rejectTruthVersion: (recordId, versionId, note) =>
    req(`/business-truth/${encodeURIComponent(recordId)}/versions/${encodeURIComponent(versionId)}/reject`, "POST", { note }),
  promoteTruthVersion: (recordId, versionId, note = null) =>
    req(`/business-truth/${encodeURIComponent(recordId)}/versions/${encodeURIComponent(versionId)}/promote`, "POST", { note }),

  truthDiff: (recordId, { from = null, to = null } = {}) => {
    const q = new URLSearchParams(
      Object.entries({ from, to }).filter(([, v]) => v),
    );
    return req(`/business-truth/${encodeURIComponent(recordId)}/diff${q.toString() ? `?${q}` : ""}`);
  },

  truthConflicts: (recordId) => req(`/business-truth/${encodeURIComponent(recordId)}/conflicts`),
  /** resolution: "record_updated" | "page_updated" | "not_a_conflict". */
  resolveTruthConflict: (recordId, conflictId, resolution) =>
    req(`/business-truth/${encodeURIComponent(recordId)}/conflicts/${encodeURIComponent(conflictId)}`,
      "POST", { resolution }),

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
  rejectEntity: (id, reason) =>
    req(`/entity-graph/entities/${encodeURIComponent(id)}/reject`, "POST", { reason }),

  proposeRelationship: ({ subjectId, predicate, objectId, source = "declared", note = null }) =>
    req("/entity-graph/relationships", "POST",
      { subject_id: subjectId, predicate, object_id: objectId, source, note }),
  approveRelationship: (id, { note = null, truthRecordId = null } = {}) =>
    req(`/entity-graph/relationships/${encodeURIComponent(id)}/approve`, "POST",
      { note, truth_record_id: truthRecordId }),
  rejectRelationship: (id, reason) =>
    req(`/entity-graph/relationships/${encodeURIComponent(id)}/reject`, "POST", { reason }),

  graphConflicts: (params = {}) => {
    const q = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""),
    );
    return req(`/entity-graph/conflicts${q.toString() ? `?${q}` : ""}`);
  },
  /** resolution: "relationship_removed" | "relationship_corrected" | "entity_merged" | "not_a_conflict". */
  resolveGraphConflict: (conflictId, resolution) =>
    req(`/entity-graph/conflicts/${encodeURIComponent(conflictId)}/resolve`, "POST", { resolution }),
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
