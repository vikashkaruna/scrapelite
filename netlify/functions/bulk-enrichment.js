// netlify/functions/bulk-enrichment.js — PRD 3 Bulk Account Intelligence API.
//
// Supports:
//   GET  /api/bulk-enrichment?lists=1              → list all account lists
//   GET  /api/bulk-enrichment?listId=<id>          → single list with records
//   GET  /api/bulk-enrichment?rules=1&persona=<p>  → get ICP rules
//   GET  /api/bulk-enrichment?review=1             → get items needing review
//   POST /api/bulk-enrichment { action: "create", name, domains, persona }
//   POST /api/bulk-enrichment { action: "process_chunk", jobId }
//   POST /api/bulk-enrichment { action: "save_rules", persona, criteria, threshold }
//   POST /api/bulk-enrichment { action: "resolve_review", reviewId, action, resolvedValue }

import { authenticateBearer } from "./lib/supabaseServerClient.js";
import { resolveRequestEntitlement, checkCapability, denyResponse } from "./lib/requireEntitlement.js";
import {
  assertJobOwner,
  listLists,
  getList,
  createList,
  updateList,
  deleteList,
  updateRecord,
  deleteRecord,
  getIcpRules,
  saveIcpRules,
  processJobChunk,
  startJob,
  getReviewQueue,
  resolveReviewItem,
} from "./lib/bulkStore.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (status, body) => ({
  statusCode: status,
  headers: { ...CORS, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };

  try {
    if (event.httpMethod === "GET") return await handleGet(event);
    if (event.httpMethod === "POST") return await handlePost(event);
    return json(405, { error: "Method not allowed" });
  } catch (e) {
    console.error("[bulk-enrichment] unhandled error:", e);
    return json(500, { error: e.message || "Bulk enrichment failed." });
  }
};

async function handleGet(event) {
  const qs = event.queryStringParameters || {};
  // Auth failure refuses. Previously it fell through with userId=null and the
  // store ran an unfiltered service-key query — exposing every tenant's account
  // lists, ICP criteria and, worst of all, the review queue, which holds
  // unverified CONTACT data scraped from third-party sites.
  const auth = await authenticateBearer(event, { label: "bulk-enrichment" });
  if (!auth.ok) return json(auth.status, auth.body);
  const userId = auth.user.id;

  if (qs.listId) {
    const list = await getList(qs.listId, userId);
    if (!list) return json(404, { error: "List not found" });
    return json(200, { list });
  }

  if (qs.review) {
    const res = await getReviewQueue(userId, qs.filterListId);
    return json(200, res);
  }

  if (qs.rules) {
    const rules = await getIcpRules(userId, qs.persona || "default");
    return json(200, { rules });
  }

  // Default: list all lists
  const res = await listLists(userId);
  return json(200, res);
}

async function handlePost(event) {
  const auth = await authenticateBearer(event, { label: "bulk-enrichment" });
  if (!auth.ok) return json(auth.status, auth.body);
  const userId = auth.user.id;

  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body." });
  }

  const action = body.action || "create";

  if (action === "create") {
    const { name, description, domains, persona } = body;
    if (!domains || (Array.isArray(domains) && domains.length === 0)) {
      return json(400, { error: "Domains are required to create a list." });
    }

    // PRD 3 requires "usage cap and plan enforcement" before a job is accepted.
    // Gated on the row count the caller is asking us to crawl, checked BEFORE
    // the list is written so a refused request costs nothing — the same gate
    // ordering extract.js documents.
    const rowCount = Array.isArray(domains)
      ? domains.length
      : String(domains).split(/[\s,;]+/).filter(Boolean).length;
    const resolved = await resolveRequestEntitlement(event);
    const gate = checkCapability(resolved, "bulk.enrich", { rowCount });
    if (!gate.allowed) return denyResponse(gate, CORS);

    const res = await createList(userId, { name, description, domains, persona });
    if (res && res.ok === false) return json(res.status || 400, { error: res.reason });
    return json(201, res);
  }

  if (action === "process_chunk") {
    const { jobId } = body;
    if (!jobId) return json(400, { error: "jobId is required." });

    // The chunk runner is driven by a client POST, so ownership has to be
    // proven here: without it any signed-in user could advance — and spend the
    // credits of — another tenant's enrichment job.
    if (!(await assertJobOwner(jobId, userId))) {
      return json(404, { error: "Job not found" });
    }

    const res = await processJobChunk(jobId, 8000);
    return json(200, res);
  }

  if (action === "start_job") {
    const { listId } = body;
    if (!listId) return json(400, { error: "listId is required." });

    const res = await startJob(userId, listId);
    if (res && res.ok === false) return json(res.status || 400, { error: res.reason });
    return json(200, res);
  }

  if (action === "save_rules") {
    const { persona, name, criteria, threshold } = body;
    const res = await saveIcpRules(userId, { persona, name, criteria, threshold });
    if (res && res.ok === false) return json(res.status || 400, { error: res.reason });
    return json(200, res);
  }

  if (action === "update_list") {
    const { listId, name, description } = body;
    if (!listId) return json(400, { error: "listId is required." });
    const res = await updateList(userId, listId, { name, description });
    if (res && res.ok === false) return json(res.status || 400, { error: res.reason });
    return json(200, res);
  }

  if (action === "delete_list") {
    const { listId } = body;
    if (!listId) return json(400, { error: "listId is required." });
    const res = await deleteList(userId, listId);
    if (res && res.ok === false) return json(res.status || 400, { error: res.reason });
    return json(200, res);
  }

  if (action === "update_record") {
    const { recordId, updates } = body;
    if (!recordId) return json(400, { error: "recordId is required." });
    const res = await updateRecord(userId, recordId, updates || {});
    if (res && res.ok === false) return json(res.status || 400, { error: res.reason });
    return json(200, res);
  }

  if (action === "delete_record") {
    const { recordId } = body;
    if (!recordId) return json(400, { error: "recordId is required." });
    const res = await deleteRecord(userId, recordId);
    if (res && res.ok === false) return json(res.status || 400, { error: res.reason });
    return json(200, res);
  }

  if (action === "resolve_review") {
    const { reviewId, resolveAction, resolvedValue } = body;
    if (!reviewId) return json(400, { error: "reviewId is required." });
    const res = await resolveReviewItem(userId, {
      reviewId,
      action: resolveAction,
      resolvedValue,
    });
    return json(200, res);
  }

  return json(400, { error: `Unknown action: ${action}` });
}
