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
import {
  listLists,
  getList,
  createList,
  getIcpRules,
  saveIcpRules,
  processJobChunk,
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
  const auth = await authenticateBearer(event, { label: "bulk-enrichment" });
  const userId = auth.ok ? auth.user?.id : null;

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
  const userId = auth.ok ? auth.user?.id : null;

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

    const res = await createList(userId, { name, description, domains, persona });
    return json(201, res);
  }

  if (action === "process_chunk") {
    const { jobId } = body;
    if (!jobId) return json(400, { error: "jobId is required." });
    const res = await processJobChunk(jobId, 8000);
    return json(200, res);
  }

  if (action === "save_rules") {
    const { persona, name, criteria, threshold } = body;
    const res = await saveIcpRules(userId, { persona, name, criteria, threshold });
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
